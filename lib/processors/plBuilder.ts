import * as XLSX from 'xlsx';
import type {
  Channel, ChannelMap, PLOutput, PLRow, MonthlyAmazonRow, StatewisePL,
  AmazonSummary, AmazonFees, FlipkartSummary, FlipkartResult, AmazonResult,
  IavInResult, SalesBusyResult,
  IntermediateSheets, StatewiseSale,
  AmazonMonthlyPLRow, FiscalQuarter, QuarterlyRollup,
  ComparativePL, ComparativePLRow, CombinedOrders,
  OrdersSheet, KPISheet, AmazonStatewisePL,
} from '../types';
import { CHANNELS, normalizeStateName } from '../constants';
import { buildEmptyChannelMap } from './expenseAllocator';
import { processAmazon } from './amazonProcessor';
import { processFlipkart } from './flipkartProcessor';
import { processIavIn, DEFAULT_IAV_IN_RESULT } from './iavInProcessor';
import { processSalesBusy, DEFAULT_SALES_BUSY_RESULT } from './salesBusyProcessor';
import { allocateExpenses, resolveInterestExpense } from './expenseAllocator';
import { computeOrdersSheet, computeKPISheet, computeAmazonStatewisePL } from './outputSheets';
import { connectDB, Upload, PLResult, MonthlyData, StatewiseData, MonthlyPeriod, OrdersData, UploadRawSheet } from '../db';
import { readSheet, safeNum, parseDate } from '../utils/parser';

// ── Helpers ───────────────────────────────────────────────────────────────

// Re-export legacy helpers that other modules import from here
export { buildEmptyChannelMap };

export function buildEmptyPLRow(label: string): PLRow {
  return {
    label,
    total: 0,
    totalPct: 0,
    byChannel: buildEmptyChannelMap(),
    byChannelPct: buildEmptyChannelMap(),
  };
}

function makePLRow(label: string, byChannel: ChannelMap<number>, pctBase = 0): PLRow {
  const total      = CHANNELS.reduce((s, ch) => s + (byChannel[ch] ?? 0), 0);
  const totalPct   = pctBase > 0 ? (total / pctBase) * 100 : 0;
  const byChannelPct = Object.fromEntries(
    CHANNELS.map(ch => [ch, pctBase > 0 ? ((byChannel[ch] ?? 0) / pctBase) * 100 : 0]),
  ) as ChannelMap<number>;
  return { label, total, totalPct, byChannel, byChannelPct };
}

function zeroed(): ChannelMap<number> {
  return buildEmptyChannelMap();
}

function single(ch: Channel, val: number): ChannelMap<number> {
  const m = zeroed();
  m[ch] = val;
  return m;
}

// ── Default safe values ───────────────────────────────────────────────────

const DEFAULT_AMAZON_RESULT: AmazonResult = {
  summary: {
    grossSales: 0, cancellations: 0, courierReturns: 0,
    customerReturns: 0, totalReturns: 0, shippingReceived: 0,
    giftWrap: 0, discounts: 0, netSales: 0, byState: {},
    b2bGrossSales: 0, b2cGrossSales: 0,
    b2bCancellations: 0, b2cCancellations: 0,
    b2bNetSales: 0, b2cNetSales: 0,
  },
  fees: {
    advertisement: 0, longTermStorage: 0, storage: 0,
    fbaWeightHandling: 0, pickAndPack: 0, commission: 0,
    otherFees: 0, totalFees: 0,
  },
  statewise: [],
  orders: {
    totalOrders: 0, totalUnits: 0, b2bOrders: 0, b2bUnits: 0,
    b2cOrders: 0, b2cUnits: 0, cancelledOrders: 0, cancelledUnits: 0,
    fbaReturnOrders: 0, fbaReturnUnits: 0, merchantReturnOrders: 0,
    merchantReturnUnits: 0, freeReplacementOrders: 0,
  },
  summarySheet: { rows: [], byState: {} },
  expSheet: { states: [], fees: [] },
  returnClassification: { courier: 0, customer: 0 },
};

const DEFAULT_FLIPKART_SUMMARY: FlipkartSummary = {
  grossSales: 0, cancellations: 0, returns: 0,
  returnCancellations: 0, cashback: 0, shippingReceived: 0,
  discounts: 0, netSales: 0,
};

const DEFAULT_FLIPKART_RESULT: FlipkartResult = {
  summary: DEFAULT_FLIPKART_SUMMARY,
  fees: {},
  statewise: [],
  orders: {
    totalOrders: 0, totalUnits: 0, cancelledOrders: 0, cancelledUnits: 0,
    returnOrders: 0, returnUnits: 0, returnCancellationOrders: 0,
  },
  summarySheet: { rows: [], byState: {} },
  expSheet: { states: [], fees: [] },
  returnClassification: { courier: 0, customer: 0 },
};

// ── Monthly sheet parser ──────────────────────────────────────────────────

function parseMonthlySheet(wb: XLSX.WorkBook): MonthlyAmazonRow[] {
  if (!wb.Sheets['MONTHWISE AMAZON CONSO P&L']) return [];
  const all = readSheet(wb, 'MONTHWISE AMAZON CONSO P&L', 0);
  if (all.length < 5) return [];

  const monthHeaderRow = all[2] as any[];
  const dataRows       = all.slice(4);

  const labelMap = new Map<string, number[]>();
  for (const row of dataRows) {
    const label = String(row[0] ?? '').trim().toLowerCase();
    if (!label) continue;
    labelMap.set(label, (row as any[]).slice(1).map((v: any) => safeNum(v)));
  }

  const find = (...terms: string[]): number[] => {
    for (const [key, vals] of labelMap) {
      if (terms.some(t => key.includes(t.toLowerCase()))) return vals;
    }
    return [];
  };

  const grossArr       = find('gross sales', 'gross sale');
  const cancelArr      = find('cancellation');
  const courierArr     = find('courier return');
  const customerArr    = find('customer return');
  const shippingArr    = find('shipping');
  const netArr         = find('net sales', 'net sale');
  const commissionArr  = find('commission', 'selling fee');
  const adsArr         = find('advertisement', 'sponsored', 'ads');
  const fbaArr         = find('fba', 'fulfilment', 'fulfillment');
  const otherFeeArr    = find('other fee', 'other exp');
  const totalExpArr    = find('total expense', 'total exp');
  const netEarningsArr = find('net earning', 'net profit');

  const months: MonthlyAmazonRow[] = [];
  for (let i = 0; i < monthHeaderRow.length - 1; i++) {
    const monthVal  = monthHeaderRow[i + 1];
    if (!monthVal) continue;
    const monthDate = parseDate(monthVal);
    if (!monthDate) continue;
    const g = (arr: number[]) => arr[i] ?? 0;
    months.push({
      month:            monthDate,
      grossSales:       g(grossArr),
      cancellations:    g(cancelArr),
      courierReturns:   g(courierArr),
      customerReturns:  g(customerArr),
      shippingReceived: g(shippingArr),
      netSales:         g(netArr),
      amazonCommission: g(commissionArr),
      amazonAds:        g(adsArr),
      fulfilmentFees:   g(fbaArr),
      otherFees:        g(otherFeeArr),
      totalExpenses:    g(totalExpArr),
      netEarnings:      g(netEarningsArr),
    });
  }
  return months;
}

// ── PLOutput builder helpers ──────────────────────────────────────────────

export function buildPLOutput(month: string): PLOutput {
  const row = (label: string) => buildEmptyPLRow(label);
  return {
    month,
    grossSales:        row('Gross Sales'),
    cancellations:     row('Cancellations'),
    courierReturns:    row('Courier Returns'),
    customerReturns:   row('Customer Returns'),
    shippingReceived:  row('Shipping Received'),
    netSales:          row('Net Sales'),
    openingStock:      row('Opening Stock'),
    purchases:         row('Purchases'),
    closingStock:      row('Closing Stock'),
    packingMaterial:   row('Packing Material'),
    freightInward:     row('Freight Inward'),
    cogs:              row('COGS'),
    grossProfit:       row('Gross Profit'),
    expenses:          [],
    totalDirectExp:    row('Total Direct Expenses'),
    totalAllocatedExp: row('Total Allocated Expenses'),
    netProfit:         row('Net Profit'),
    interestExpense:   0,
  };
}

function extractRawWorkbookSheets(wb: XLSX.WorkBook): Array<{
  sheetName: string;
  headers: string[];
  data: unknown[][];
  rowCount: number;
}> {
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = ws
      ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][])
      : [];
    const headerRow = rows[0] ?? [];
    const headers = headerRow.map((value) => String(value ?? ''));
    const data = rows.slice(1);

    return {
      sheetName,
      headers,
      data,
      rowCount: data.length,
    };
  });
}

export function plOutputToRows(pl: PLOutput): PLRow[] {
  return [
    pl.grossSales, pl.cancellations, pl.courierReturns, pl.customerReturns,
    pl.shippingReceived, pl.netSales, pl.openingStock, pl.purchases,
    pl.closingStock, pl.packingMaterial, pl.freightInward, pl.cogs,
    pl.grossProfit, pl.totalDirectExp, pl.totalAllocatedExp, pl.netProfit,
  ];
}

// ── 8B / 8C: Fiscal calendar + statewise helpers ──────────────────────────

/** Normalise "Jan 2026" or "Jan-2026" or "Jan-26" → "Jan-26" */
function toShortMonth(month: string): string {
  const parts = month.trim().split(/[\s\-]+/);
  if (parts.length >= 2) {
    const yr = parts[parts.length - 1].length === 4
      ? parts[parts.length - 1].slice(2)
      : parts[parts.length - 1];
    return `${parts[0]}-${yr}`;
  }
  return month;
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function getFiscalInfo(month: string): { quarter: FiscalQuarter; fiscalYear: string; monthIndex: number } {
  const short  = toShortMonth(month);
  const [mName, yrStr] = short.split('-');
  const yr     = parseInt('20' + yrStr, 10);
  const mIdx   = MONTH_ABBR[mName.toLowerCase()] ?? 0;

  let quarter: FiscalQuarter;
  let fyStart: number;
  if      (mIdx >= 3 && mIdx <= 5)  { quarter = 'Q1'; fyStart = yr; }
  else if (mIdx >= 6 && mIdx <= 8)  { quarter = 'Q2'; fyStart = yr; }
  else if (mIdx >= 9 && mIdx <= 11) { quarter = 'Q3'; fyStart = yr; }
  else                               { quarter = 'Q4'; fyStart = yr - 1; }

  const fiscalYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;
  return { quarter, fiscalYear, monthIndex: mIdx };
}

const QUARTER_ORDER: FiscalQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

function getPreviousQuarter(quarter: FiscalQuarter, fiscalYear: string): { quarter: FiscalQuarter; fiscalYear: string } {
  const idx = QUARTER_ORDER.indexOf(quarter);
  if (idx === 0) {
    const fyStart = parseInt(fiscalYear.split('-')[0], 10) - 1;
    return { quarter: 'Q4', fiscalYear: `${fyStart}-${String(fyStart + 1).slice(2)}` };
  }
  return { quarter: QUARTER_ORDER[idx - 1], fiscalYear };
}

/** Build combined statewise sales from all processor results (8B) */
function buildStatewiseSale(
  amazonStatewise: StatewisePL[],
  flipkartStatewise: StatewisePL[],
  iavInResult: IavInResult,
): StatewiseSale {
  const channelData: Partial<Record<Channel, StatewisePL[]>> = {
    AMAZON:   amazonStatewise,
    FLIPKART: flipkartStatewise,
    IAV_IN:   iavInResult.statewise.iavIn,
    IAV_COM:  iavInResult.statewise.iavCom,
    MYNTRA:   iavInResult.statewise.myntra,
  };

  const stateMap = new Map<string, { grossSales: number; returns: number; netSales: number }>();
  for (const rows of Object.values(channelData)) {
    for (const row of (rows ?? [])) {
      const state = normalizeStateName(row.state); // 14F: normalise typos & case variants
      const existing = stateMap.get(state) ?? { grossSales: 0, returns: 0, netSales: 0 };
      stateMap.set(state, {
        grossSales: existing.grossSales + row.grossSales,
        returns:    existing.returns    + row.returns,
        netSales:   existing.netSales   + row.netSales,
      });
    }
  }

  return {
    byChannel: channelData,
    combined:  [...stateMap.entries()]
      .map(([state, v]) => ({ state, ...v }))
      .sort((a, b) => b.netSales - a.netSales),
  };
}

/** Parse detailed STOCK VALUE sheet rows for the Stock Value tab */
function parseStockValueSheet(wb: XLSX.WorkBook): IntermediateSheets['stockValueSheet'] {
  const empty: IntermediateSheets['stockValueSheet'] = { rows: [] };

  if (!wb.Sheets['STOCK VALUE']) return empty;

  let all: any[][];
  try {
    all = readSheet(wb, 'STOCK VALUE', 0);
  } catch {
    return empty;
  }
  if (!all.length) return empty;

  const findHeaderIdx = () => all.findIndex((row, i) => {
    if (i > 10) return false;
    const normalized = (row as any[]).map(c => String(c ?? '').trim().toLowerCase());
    const hasLocation = normalized.some(c => c.includes('location'));
    const hasOpening = normalized.some(c => c.includes('opening'));
    const hasClosing = normalized.some(c => c.includes('closing'));
    return hasLocation && hasOpening && hasClosing;
  });

  const headerIdx = findHeaderIdx();
  if (headerIdx === -1) return empty;

  const headers = (all[headerIdx] as any[]).map(h => String(h ?? '').trim().toLowerCase());
  const hIdx = (...names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));

  const iSno = hIdx('s.no', 'sr', 'sno');
  const iLoc = hIdx('location', 'particular', 'name');
  const iOp = hIdx('opening');
  const iCl = hIdx('closing');
  const iCh = hIdx('change');

  const rows = all
    .slice(headerIdx + 1)
    .map((row) => {
      const sno = String(iSno >= 0 ? row[iSno] ?? '' : row[0] ?? '').trim();
      const location = String(iLoc >= 0 ? row[iLoc] ?? '' : row[1] ?? '').trim();
      if (!sno && !location) return null;

      const opening = safeNum(iOp >= 0 ? row[iOp] : row[2]);
      const closing = safeNum(iCl >= 0 ? row[iCl] : row[3]);
      let changes = safeNum(iCh >= 0 ? row[iCh] : row[4]);
      if (changes === 0 && (opening !== 0 || closing !== 0)) {
        changes = closing - opening;
      }

      const notesRaw = [row[5], row[6], row[7]]
        .map(v => String(v ?? '').trim())
        .find(v => v && safeNum(v) === 0);
      const isTotal = /total\s+stock\s+value/i.test(location);

      return {
        sno,
        location,
        openingStockValue: opening,
        closingStockValue: closing,
        changes,
        notes: notesRaw || undefined,
        isTotal,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return { rows };
}

// ── 8D: Amazon monthly P&L row ────────────────────────────────────────────

const AMAZON_NUMERIC_KEYS: (keyof AmazonMonthlyPLRow)[] = [
  'grossSales', 'cancellations', 'courierReturns', 'customerReturns',
  'salesAfterReturn', 'shippingReceived', 'giftWrap', 'discounts', 'netSales',
  'openingStock', 'purchases', 'closingStock', 'packingMaterial', 'freightInward',
  'totalCOGS', 'grossProfit',
  'advertisement', 'inboundTransport', 'commission', 'paymentGateway',
  'shippingCourier', 'storage', 'exchangeDiff', 'subscription', 'employeeBenefit',
  'totalDirectExp', 'ebitAmazon',
];

const AMAZON_ROW_LABELS: Partial<Record<keyof AmazonMonthlyPLRow, string>> = {
  grossSales:       'Gross Sales',
  cancellations:    'Cancellations',
  courierReturns:   'Courier Returns',
  customerReturns:  'Customer Returns',
  salesAfterReturn: 'Sales After Return',
  shippingReceived: 'Shipping Received',
  discounts:        'Discounts',
  netSales:         'Net Sales',
  openingStock:     'Opening Stock',
  purchases:        'Purchases',
  closingStock:     'Closing Stock',
  packingMaterial:  'Packing Material',
  freightInward:    'Freight Inward',
  totalCOGS:        'Total COGS',
  grossProfit:      'Gross Profit',
  advertisement:    'Advertisement',
  inboundTransport: 'Inbound Transport',
  commission:       'Commission',
  paymentGateway:   'Payment Gateway',
  shippingCourier:  'Shipping / Courier',
  storage:          'Storage',
  exchangeDiff:     'Exchange Difference',
  subscription:     'Subscription',
  employeeBenefit:  'Employee Benefit',
  totalDirectExp:   'Total Direct Expenses',
  ebitAmazon:       'EBIT (Amazon)',
};

function buildAmazonMonthlyPLRow(
  month: string,
  amazonResult: AmazonResult,
  pl: PLOutput,
): AmazonMonthlyPLRow {
  const ch  = 'AMAZON' as Channel;
  const amz = amazonResult.summary;

  const getExp = (kwds: string[]): number => {
    const found = pl.expenses.find(e => {
      const lbl = e.particulars.toLowerCase();
      return kwds.some(k => lbl.includes(k));
    });
    return found?.allocated[ch] ?? 0;
  };

  const openingStock    = pl.openingStock.byChannel[ch]    ?? 0;
  const purchases       = pl.purchases.byChannel[ch]       ?? 0;
  const closingStock    = pl.closingStock.byChannel[ch]    ?? 0;
  const packingMaterial = pl.packingMaterial.byChannel[ch] ?? 0;
  const freightInward   = pl.freightInward.byChannel[ch]   ?? 0;
  const totalCOGS       = openingStock + purchases - closingStock + packingMaterial + freightInward;
  const grossProfit     = amz.netSales - totalCOGS;

  const advertisement    = getExp(['advertisement', 'sponsored', 'ads']);
  const inboundTransport = getExp(['inbound transport', 'inbound']);
  const commission       = getExp(['commission', 'selling fee', 'referral']);
  const paymentGateway   = getExp(['payment gateway', 'payment fee']);
  const shippingCourier  = getExp(['shipping', 'courier', 'fba', 'fulfil']);
  const storage          = getExp(['storage', 'inventory']);
  const exchangeDiff     = getExp(['exchange', 'forex']);
  const subscription     = getExp(['subscription']);
  const employeeBenefit  = getExp(['employee benefit', 'salary', 'esic', 'pf']);
  const totalDirectExp   = advertisement + inboundTransport + commission + paymentGateway
                         + shippingCourier + storage + exchangeDiff + subscription + employeeBenefit;
  const ebitAmazon       = grossProfit - totalDirectExp;

  return {
    month:            toShortMonth(month),
    grossSales:       amz.grossSales,
    cancellations:    amz.cancellations,
    courierReturns:   amz.courierReturns,
    customerReturns:  amz.customerReturns,
    salesAfterReturn: amz.grossSales - amz.cancellations - amz.courierReturns - amz.customerReturns,
    shippingReceived: amz.shippingReceived,
    giftWrap:         amz.giftWrap   ?? 0,
    discounts:        amz.discounts  ?? 0,
    netSales:         amz.netSales,
    openingStock, purchases, closingStock, packingMaterial, freightInward,
    totalCOGS, grossProfit,
    advertisement, inboundTransport, commission, paymentGateway,
    shippingCourier, storage, exchangeDiff, subscription, employeeBenefit,
    totalDirectExp, ebitAmazon,
  };
}

/** Sum a list of AmazonMonthlyPLRows, preserving first/last stock values */
function sumAmazonRows(rows: AmazonMonthlyPLRow[], summaryMonth: string): AmazonMonthlyPLRow {
  const result = Object.fromEntries(AMAZON_NUMERIC_KEYS.map(k => [k, 0])) as unknown as AmazonMonthlyPLRow;
  result.month = summaryMonth;

  for (const row of rows) {
    for (const key of AMAZON_NUMERIC_KEYS) {
      (result as any)[key] += (row as any)[key] ?? 0;
    }
  }

  if (rows.length > 0) {
    result.openingStock = rows[0].openingStock;
    result.closingStock = rows[rows.length - 1].closingStock;
    result.totalCOGS    = result.openingStock + result.purchases - result.closingStock
                        + result.packingMaterial + result.freightInward;
    result.grossProfit  = result.netSales - result.totalCOGS;
    result.ebitAmazon   = result.grossProfit - result.totalDirectExp;
  }
  return result;
}

// ── 8E: Quarterly rollup ──────────────────────────────────────────────────

async function computeQuarterlyRollup(
  currentRow: AmazonMonthlyPLRow,
  quarter: FiscalQuarter,
  fiscalYear: string,
): Promise<QuarterlyRollup> {
  const prevDocs = await PLResult
    .find({ fiscalQuarter: quarter, fiscalYear, amazonMonthlyRow: { $exists: true, $ne: {} } })
    .lean();

  const byMonth = new Map<string, AmazonMonthlyPLRow>();
  for (const doc of prevDocs) {
    const row = doc.amazonMonthlyRow as AmazonMonthlyPLRow | undefined;
    if (row?.month) byMonth.set(row.month, row);
  }
  byMonth.set(currentRow.month, currentRow); // current month always wins

  const sorted = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return {
    quarter,
    fiscalYear,
    months: sorted.map(r => r.month),
    amazon: sumAmazonRows(sorted, `${quarter} ${fiscalYear}`),
  };
}

// ── 8F: Comparative P&L ───────────────────────────────────────────────────

function makeComparativeRows(prev: AmazonMonthlyPLRow, curr: AmazonMonthlyPLRow): ComparativePLRow[] {
  return AMAZON_NUMERIC_KEYS.map(key => {
    const p = (prev as any)[key] as number ?? 0;
    const c = (curr as any)[key] as number ?? 0;
    return {
      label:     AMAZON_ROW_LABELS[key] ?? String(key),
      previous:  p,
      current:   c,
      change:    c - p,
      changePct: p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null,
    };
  });
}

async function buildAmazonHistory(limitMonths: number): Promise<{ label: string; values: Record<string, number> }[]> {
  const HISTORY_KEYS: (keyof AmazonMonthlyPLRow)[] =
    ['grossSales', 'netSales', 'grossProfit', 'totalDirectExp', 'ebitAmazon'];

  const docs = await PLResult
    .find({ amazonMonthlyRow: { $exists: true, $ne: {} } })
    .sort({ createdAt: -1 })
    .limit(limitMonths)
    .lean();

  return docs
    .map(d => {
      const row = d.amazonMonthlyRow as AmazonMonthlyPLRow | undefined;
      if (!row?.month) return null;
      const values: Record<string, number> = {};
      for (const key of HISTORY_KEYS) values[String(key)] = (row as any)[key] ?? 0;
      return { label: row.month, values };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .reverse();
}

async function buildComparativePLData(
  pl: PLOutput,
  currentAmazonRow: AmazonMonthlyPLRow,
  month: string,
  quarterlyRollup: QuarterlyRollup,
  previousMonthPLId?: string,
): Promise<ComparativePL[]> {

  const makeTotalRow = (label: string, prevPL: any, currPL: PLOutput, getter: (x: PLOutput) => number): ComparativePLRow => {
    const p = getter(prevPL as PLOutput);
    const c = getter(currPL);
    return { label, previous: p, current: c, change: c - p, changePct: p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null };
  };

  const result: ComparativePL[] = [];

  if (previousMonthPLId) {
    const prevDoc = await PLResult.findById(previousMonthPLId).lean();
    if (prevDoc) {
      const prevPL = prevDoc.data as PLOutput;

      // 1 — IAV GROUP MONTHLY COMPARATIVE
      result.push({
        type: 'group_monthly',
        currentLabel:  toShortMonth(month),
        previousLabel: toShortMonth(prevDoc.month),
        rows: [
          makeTotalRow('Gross Sales',        prevPL, pl, x => x.grossSales.total),
          makeTotalRow('Cancellations',       prevPL, pl, x => x.cancellations.total),
          makeTotalRow('Courier Returns',     prevPL, pl, x => x.courierReturns.total),
          makeTotalRow('Customer Returns',    prevPL, pl, x => x.customerReturns.total),
          makeTotalRow('Net Sales',           prevPL, pl, x => x.netSales.total),
          makeTotalRow('Gross Profit',        prevPL, pl, x => x.grossProfit.total),
          makeTotalRow('Total Direct Exp',    prevPL, pl, x => x.totalDirectExp.total),
          makeTotalRow('Total Allocated Exp', prevPL, pl, x => x.totalAllocatedExp.total),
          makeTotalRow('Net Profit',          prevPL, pl, x => x.netProfit.total),
          makeTotalRow('Interest Expense',    prevPL, pl, x => x.interestExpense ?? 0),
        ],
      });

      // 2 — AMAZON MONTHLY COMPARATIVE (with history)
      const prevAmazonRow = prevDoc.amazonMonthlyRow as AmazonMonthlyPLRow | undefined;
      if (prevAmazonRow?.month) {
        const history = await buildAmazonHistory(12).catch(() => []);
        result.push({
          type:          'amazon_monthly',
          currentLabel:  currentAmazonRow.month,
          previousLabel: prevAmazonRow.month,
          rows:          makeComparativeRows(prevAmazonRow, currentAmazonRow),
          history,
        });
      }
    }
  }

  // 3 — AMAZON QUARTERLY COMPARATIVE
  const { quarter, fiscalYear } = getFiscalInfo(month);
  const prevQ    = getPreviousQuarter(quarter, fiscalYear);
  const prevQDoc = await PLResult
    .findOne({ fiscalYear: prevQ.fiscalYear, fiscalQuarter: prevQ.quarter, quarterlyRollup: { $exists: true, $ne: {} } })
    .sort({ createdAt: -1 })
    .lean()
    .catch(() => null);

  if (prevQDoc?.quarterlyRollup) {
    const prevQR = prevQDoc.quarterlyRollup as QuarterlyRollup;
    result.push({
      type:          'amazon_quarterly',
      currentLabel:  `${quarterlyRollup.quarter} ${quarterlyRollup.fiscalYear}`,
      previousLabel: `${prevQR.quarter} ${prevQR.fiscalYear}`,
      rows:          makeComparativeRows(prevQR.amazon, quarterlyRollup.amazon),
    });
  }

  return result;
}

// ── Master orchestrator ───────────────────────────────────────────────────

/**
 * 8A: Updated buildPL signature.
 *
 * Fourth param can be either:
 *  - a plain string (legacy: monthlyPeriodId) — kept for backward compatibility
 *  - an options object (new preferred form)
 */
export async function buildPL(
  wb: XLSX.WorkBook,
  fileName: string,
  month: string,
  optionsOrId?: string | {
    monthlyPeriodId?: string;
    previousMonthPLId?: string;
    forceReprocess?: boolean;
  },
): Promise<{ uploadId: string; pl: PLOutput; errors: string[]; intermediates: IntermediateSheets; ordersSheet: OrdersSheet; kpiSheet: KPISheet; amazonStatewisePL: AmazonStatewisePL }> {

  // Normalise the overloaded 4th param
  const monthlyPeriodId  = typeof optionsOrId === 'string' ? optionsOrId : optionsOrId?.monthlyPeriodId;
  let   previousMonthPLId = typeof optionsOrId === 'object' ? optionsOrId?.previousMonthPLId : undefined;

  // STEP 1 — connect and load period carry-forward data
  await connectDB();

  let periodOpeningStock = { tradedGoods: 0, packingMaterial: 0 };
  if (monthlyPeriodId) {
    const period = await MonthlyPeriod.findById(monthlyPeriodId).lean();
    if (period?.openingStock) {
      periodOpeningStock = period.openingStock;
    }
    // 8C: auto-resolve previousMonthPLId from period chain when not supplied directly
    if (!previousMonthPLId && period?.previousMonthId) {
      const prevPeriod = await MonthlyPeriod.findById(period.previousMonthId).lean();
      if (prevPeriod?.plResultId) {
        previousMonthPLId = prevPeriod.plResultId.toString();
      }
    }
    await MonthlyPeriod.findByIdAndUpdate(monthlyPeriodId, { status: 'processing' });
  }

  const upload = await Upload.create({
    fileName,
    month,
    status: 'processing',
    sheetsDetected: wb.SheetNames,
  });
  const uploadId = upload._id.toString();

  // Pre-compute fiscal info (needed during save)
  const { quarter, fiscalYear } = getFiscalInfo(month);

  try {
    const errors: string[] = [];

    // STEP 2 — run all processors individually
    let amazonResult = DEFAULT_AMAZON_RESULT;
    let amazonStatewise: StatewisePL[] = [];
    let amazonFees = DEFAULT_AMAZON_RESULT.fees;
    try {
      amazonResult    = processAmazon(wb);
      amazonStatewise = amazonResult.statewise;
      amazonFees      = amazonResult.fees;
    } catch (err) {
      errors.push(`Amazon (AMAZON): ${err instanceof Error ? err.message : String(err)}`);
    }
    const amazonSummary = amazonResult.summary;

    let flipkartResult = DEFAULT_FLIPKART_RESULT;
    try {
      flipkartResult = processFlipkart(wb);
    } catch (err) {
      errors.push(`Flipkart (FLIPKART): ${err instanceof Error ? err.message : String(err)}`);
    }
    const flipkartSummary = flipkartResult.summary;

    let iavInResult: IavInResult = DEFAULT_IAV_IN_RESULT;
    try {
      iavInResult = processIavIn(wb);
    } catch (err) {
      errors.push(`IAV / Tally (IAV_IN, IAV_COM, MYNTRA): ${err instanceof Error ? err.message : String(err)}`);
    }

    let salesBusyResult: SalesBusyResult = DEFAULT_SALES_BUSY_RESULT;
    try {
      salesBusyResult = processSalesBusy(wb, periodOpeningStock);
    } catch (err) {
      errors.push(`Sales Busy / Purchases (MEESHO, BULK, SHOWROOM): ${err instanceof Error ? err.message : String(err)}`);
    }
    const salesByChannel = salesBusyResult.byChannel;
    const purchaseSplit  = salesBusyResult.purchases;
    const stockValues    = salesBusyResult.stock;

    // STEP 3 — assemble net sales map
    const netSalesMap: ChannelMap<number> = {
      AMAZON:        amazonSummary.netSales,
      FLIPKART:      flipkartSummary.netSales,
      MEESHO:        salesByChannel['MEESHO']?.net ?? 0,
      MYNTRA:        iavInResult.myntra.netSales,
      IAV_IN:        iavInResult.iavIn.netSales,
      BULK_DOMESTIC: salesByChannel['BULK_DOMESTIC']?.net ?? 0,
      SHOWROOM:      salesByChannel['SHOWROOM']?.net ?? 0,
      IAV_COM:       iavInResult.iavCom.netSales,
      BULK_EXPORT:   salesByChannel['BULK_EXPORT']?.net ?? 0,
    };

    // STEP 4 — expense allocation
    let expenses: ReturnType<typeof allocateExpenses> = [];
    try {
      expenses = allocateExpenses({ netSales: netSalesMap, wb });
    } catch (err) {
      errors.push(`Expense Allocator: ${err instanceof Error ? err.message : String(err)}`);
    }

    // STEP 5 — assemble PLOutput
    const grossSalesByChannel: ChannelMap<number> = {
      AMAZON:        amazonSummary.grossSales,
      FLIPKART:      flipkartSummary.grossSales,
      MEESHO:        salesByChannel['MEESHO']?.sales ?? 0,
      MYNTRA:        iavInResult.myntra.grossSales,
      IAV_IN:        iavInResult.iavIn.grossSales,
      BULK_DOMESTIC: salesByChannel['BULK_DOMESTIC']?.sales ?? 0,
      SHOWROOM:      salesByChannel['SHOWROOM']?.sales ?? 0,
      IAV_COM:       iavInResult.iavCom.grossSales,
      BULK_EXPORT:   salesByChannel['BULK_EXPORT']?.sales ?? 0,
    };

    const cancellationsByChannel: ChannelMap<number> = {
      ...zeroed(), AMAZON: amazonSummary.cancellations, FLIPKART: flipkartSummary.cancellations,
    };
    const courierReturnsByChannel: ChannelMap<number> = {
      ...zeroed(),
      AMAZON:   amazonSummary.courierReturns,
      FLIPKART: flipkartResult.returnClassification.courier,
      IAV_IN:   iavInResult.iavIn.courierReturn,
    };
    const customerReturnsByChannel: ChannelMap<number> = {
      ...zeroed(),
      AMAZON:   amazonSummary.customerReturns,
      FLIPKART: flipkartResult.returnClassification.customer,
      IAV_IN:   iavInResult.iavIn.customerReturn,
      MYNTRA:   iavInResult.myntra.returns,
    };
    const shippingByChannel: ChannelMap<number> = {
      ...zeroed(),
      AMAZON:  amazonSummary.shippingReceived,
      FLIPKART: flipkartSummary.shippingReceived,
      IAV_IN:  iavInResult.iavIn.shipping,
      IAV_COM: iavInResult.iavCom.shipping,
      MYNTRA:  iavInResult.myntra.shipping,
    };

    const grossSalesRow  = makePLRow('Gross Sales',      grossSalesByChannel);
    const pctBase        = grossSalesRow.total;
    const cancelRow      = makePLRow('Cancellations',    cancellationsByChannel,   pctBase);
    const courierRow     = makePLRow('Courier Returns',  courierReturnsByChannel,  pctBase);
    const customerRow    = makePLRow('Customer Returns', customerReturnsByChannel, pctBase);
    const shippingRow    = makePLRow('Shipping Received', shippingByChannel,       pctBase);
    const netSalesRow    = makePLRow('Net Sales',        netSalesMap,              pctBase);

    const purchasesRow   = makePLRow('Purchases',        single('AMAZON', purchaseSplit.traded),          pctBase);
    const packingRow     = makePLRow('Packing Material', single('AMAZON', purchaseSplit.packingMaterial), pctBase);
    const freightRow     = makePLRow('Freight Inward',   single('AMAZON', purchaseSplit.freightInward),   pctBase);

    const cogsMap = Object.fromEntries(
      CHANNELS.map(ch => [
        ch,
        (purchasesRow.byChannel[ch] ?? 0) +
        (packingRow.byChannel[ch]   ?? 0) +
        (freightRow.byChannel[ch]   ?? 0),
      ]),
    ) as ChannelMap<number>;
    const cogsRow        = makePLRow('COGS',         cogsMap, pctBase);

    const grossProfitMap = Object.fromEntries(
      CHANNELS.map(ch => [ch, (netSalesMap[ch] ?? 0) - (cogsMap[ch] ?? 0)]),
    ) as ChannelMap<number>;
    const grossProfitRow = makePLRow('Gross Profit', grossProfitMap, pctBase);

    const directExp    = expenses.filter(e => e.allocationBasis === 'DIRECT' || e.allocationBasis === 'ONLY INDIANARTVILLA.IN');
    const allocatedExp = expenses.filter(e => e.allocationBasis !== 'DIRECT' && e.allocationBasis !== 'ONLY INDIANARTVILLA.IN');

    const sumExpGroup = (group: typeof expenses) => {
      const m = zeroed();
      for (const row of group) for (const ch of CHANNELS) m[ch] += row.allocated[ch] ?? 0;
      return m;
    };

    const totalDirectExpRow    = makePLRow('Total Direct Expenses',    sumExpGroup(directExp),    pctBase);
    const totalAllocatedExpRow = makePLRow('Total Allocated Expenses', sumExpGroup(allocatedExp), pctBase);

    const netProfitMap = Object.fromEntries(
      CHANNELS.map(ch => [
        ch,
        (grossProfitMap[ch] ?? 0) -
        (totalDirectExpRow.byChannel[ch]    ?? 0) -
        (totalAllocatedExpRow.byChannel[ch] ?? 0),
      ]),
    ) as ChannelMap<number>;
    const netProfitRow = makePLRow('Net Profit', netProfitMap, pctBase);

    const openingStockRow = makePLRow('Opening Stock', single('AMAZON', stockValues.opening.traded), pctBase);
    const closingStockRow = makePLRow('Closing Stock', single('AMAZON', stockValues.closing.traded), pctBase);

    let interestExpense = 0;
    try { interestExpense = resolveInterestExpense(wb); } catch { /* leave as 0 */ }

    const pl: PLOutput = {
      month,
      grossSales:        grossSalesRow,
      cancellations:     cancelRow,
      courierReturns:    courierRow,
      customerReturns:   customerRow,
      shippingReceived:  shippingRow,
      netSales:          netSalesRow,
      openingStock:      openingStockRow,
      purchases:         purchasesRow,
      closingStock:      closingStockRow,
      packingMaterial:   packingRow,
      freightInward:     freightRow,
      cogs:              cogsRow,
      grossProfit:       grossProfitRow,
      expenses,
      totalDirectExp:    totalDirectExpRow,
      totalAllocatedExp: totalAllocatedExpRow,
      netProfit:         netProfitRow,
      interestExpense,
    };

    // STEP 5b — build enhanced intermediate data (8B / 8D / 8E / 8F)
    const intermediates: IntermediateSheets = {
      amazonSummary:    amazonResult.summarySheet,
      flipkartSummary:  flipkartResult.summarySheet,
      uniwareSummary:   iavInResult.summarySheet,
      amazonExpSheet:   amazonResult.expSheet,
      flipkartExpSheet: flipkartResult.expSheet,
      statewiseSale:    buildStatewiseSale(amazonStatewise, flipkartResult.statewise, iavInResult),
      stockValueSheet:  parseStockValueSheet(wb),
    };

    // 8D: Amazon monthly P&L row for this period
    const amazonMonthlyRow = buildAmazonMonthlyPLRow(month, amazonResult, pl);

    // 8C: Combined orders sheet
    const combinedOrders: CombinedOrders = {
      amazon:   amazonResult.orders,
      flipkart: flipkartResult.orders,
      iavIn:    iavInResult.orders,
      busy:     salesBusyResult.orders,
    };

    // 9A: Orders sheet
    const ordersSheet = computeOrdersSheet(amazonResult, flipkartResult, iavInResult, salesBusyResult);

    // 9B: KPI / % sheet
    const kpiSheet = computeKPISheet(pl);

    // 9C: Amazon statewise P&L
    const amazonStatewisePL = computeAmazonStatewisePL(amazonResult, pl, interestExpense);

    // 8E: Quarterly rollup (queries MongoDB for earlier months in same quarter)
    const quarterlyRollup = await computeQuarterlyRollup(amazonMonthlyRow, quarter, fiscalYear)
      .catch((): QuarterlyRollup => ({
        quarter, fiscalYear,
        months: [amazonMonthlyRow.month],
        amazon: amazonMonthlyRow,
      }));

    // 8F: Comparative P&L views (monthly + quarterly)
    const comparativePL = await buildComparativePLData(
      pl, amazonMonthlyRow, month, quarterlyRollup, previousMonthPLId,
    ).catch((): ComparativePL[] => []);

    const rawWorkbookSheets = extractRawWorkbookSheets(wb);

    // STEP 6 — parse workbook monthwise sheet (kept for backward compat)
    let monthlyRows: MonthlyAmazonRow[] = [];
    try { monthlyRows = parseMonthlySheet(wb); } catch { /* non-fatal — monthwise sheet is optional */ }

    // STEP 7 — save to MongoDB
    const monthlyRowsForDB = monthlyRows.map(r => ({
      ...r,
      month: r.month instanceof Date
        ? r.month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(' ', '-')
        : String(r.month),
    }));

    const plDoc = await PLResult.create({
      uploadId:         upload._id,
      month,
      fiscalQuarter:    quarter,
      fiscalYear,
      data:             pl,
      processingErrors: errors,
      intermediates,
      amazonMonthlyRow,
      comparativePL,
      quarterlyRollup,
      ordersSheet,
      kpiSheet,
      amazonStatewisePL,
    });

    const periodUpdateFields = {
      uploadId:   upload._id,
      plResultId: plDoc._id,
      status:     'complete',
    };

    const saveRawSheetsTask = rawWorkbookSheets.length > 0
      ? UploadRawSheet.insertMany(
          rawWorkbookSheets.map((sheet) => ({ ...sheet, uploadId: upload._id })),
        ).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Raw sheets snapshot not saved: ${msg}`);
          return null;
        })
      : Promise.resolve(null);

    await Promise.all([
      MonthlyData.create({ uploadId: upload._id, rows: monthlyRowsForDB }),
      StatewiseData.create({ uploadId: upload._id, rows: amazonStatewise }),
      OrdersData.create({ uploadId: upload._id, month, data: combinedOrders }),
      saveRawSheetsTask,
      monthlyPeriodId
        ? MonthlyPeriod.findByIdAndUpdate(monthlyPeriodId, periodUpdateFields)
        : Promise.resolve(),
    ]);

    // STEP 8 — mark upload complete
    await Upload.findByIdAndUpdate(upload._id, { status: 'complete' });

    return { uploadId, pl, errors, intermediates, ordersSheet, kpiSheet, amazonStatewisePL };

  } catch (e: any) {
    try {
      await Promise.all([
        Upload.findByIdAndUpdate(upload._id, {
          status:       'error',
          errorMessage: e?.message ?? String(e),
        }),
        monthlyPeriodId
          ? MonthlyPeriod.findByIdAndUpdate(monthlyPeriodId, { status: 'error' })
          : Promise.resolve(),
      ]);
    } catch { /* ignore update failure */ }
    throw e;
  }
}
