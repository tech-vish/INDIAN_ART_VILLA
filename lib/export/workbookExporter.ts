/**
 * workbookExporter.ts
 * Generates a fully-formatted IAV Dashboard .xlsx workbook.
 *
 * Formatting supported by xlsx community edition (^0.18.5):
 *   - ws['!cols']   → column widths
 *   - ws['!merges'] → merged cells
 *   - ws['!rows']   → row heights
 *   - cell.z        → number format code
 *   (bold / fill colours require xlsx-pro / exceljs — not used here)
 */
import * as XLSX from 'xlsx';
import type {
  PLOutput,
  PLRow,
  ExpenseRow,
  IntermediateSheets,
  AmazonStatewisePL,
  AmazonStatewisePLRow,
  AmazonMonthlyPLRow,
  QuarterlyRollup,
  ComparativePL,
  ComparativePLRow,
  OrdersSheet,
  KPISheet,
  KPIChannelCol,
  AmazonSummarySheet,
  FlipkartSummarySheet,
  UniwareSummarySheet,
  AmazonExpSheet,
  FlipkartExpSheet,
  StatewiseSale,
  Channel,
} from '@/lib/types';
import { CHANNELS } from '@/lib/constants';

// ── Number format codes ──────────────────────────────────────────────────────
const INR = '#,##0';        // whole-rupee amounts (Indian thousands)
const PCT = '0.00';         // percentages stored as 0-100 plain numbers
const CNT = '#,##0';        // integer count display

// ── Channel display labels ───────────────────────────────────────────────────
const CH: Record<string, string> = {
  AMAZON:        'Amazon',
  FLIPKART:      'Flipkart',
  MEESHO:        'Meesho',
  MYNTRA:        'Myntra',
  IAV_IN:        'IAV.in',
  BULK_DOMESTIC: 'Bulk Dom',
  SHOWROOM:      'Showroom',
  IAV_COM:       'IAV.com',
  BULK_EXPORT:   'Bulk Export',
};

// ── Column layout constants ──────────────────────────────────────────────────
// IAV P&L: Particulars(0) + Total₹(1) + Total%(2) + 2 per channel × 9 = 21 cols
const N_PL_COLS = 1 + 2 + CHANNELS.length * 2; // 21

// Domestic: AMAZON→SHOWROOM = 7 channels (cols 3-16 in P&L sheet)
// International: IAV_COM, BULK_EXPORT = 2 channels (cols 17-20)
const DOM_LAST_COL  = 2 + 7 * 2;       // = 16
const INTL_FIRST_COL = 2 + 7 * 2 + 1;  // = 17
const INTL_LAST_COL  = N_PL_COLS - 1;  // = 20

// ── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  const x = Number(v);
  return isNaN(x) ? 0 : x;
}

function addSheet(wb: XLSX.WorkBook, name: string, ws: XLSX.WorkSheet): void {
  const safeName = name.slice(0, 31);
  if (!wb.SheetNames.includes(safeName)) {
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
}

function setCols(ws: XLSX.WorkSheet, widths: number[]): void {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

function setZ(ws: XLSX.WorkSheet, r: number, c: number, z: string): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (cell?.t === 'n') cell.z = z;
}

function fmtCol(ws: XLSX.WorkSheet, col: number, fromRow: number, toRow: number, z: string): void {
  for (let r = fromRow; r <= toRow; r++) setZ(ws, r, col, z);
}

function fmtRect(
  ws: XLSX.WorkSheet,
  r1: number, c1: number,
  r2: number, c2: number,
  z: string,
): void {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) setZ(ws, r, c, z);
  }
}

function addMerge(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number): void {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
}

/** PLRow → array: [label, total₹, total%, ch1₹, ch1%, ch2₹, ch2%, …] */
function plRowArr(row: PLRow): (string | number)[] {
  return [
    row.label,
    n(row.total),
    n(row.totalPct),
    ...CHANNELS.flatMap(c => [
      n((row.byChannel as Record<string, number>)[c]),
      n((row.byChannelPct as Record<string, number>)[c]),
    ]),
  ];
}

function emptyPLRow(): string[] {
  return new Array(N_PL_COLS).fill('');
}

function sectionRow(label: string): (string | number)[] {
  return [label, ...new Array(N_PL_COLS - 1).fill('')];
}

// ── Sheet 1: IAV P&L ─────────────────────────────────────────────────────────

function buildIAVPLSheet(pl: PLOutput, month: string): XLSX.WorkSheet {
  const rows: (string | number)[][] = [];

  // Row 0 — title
  const titleRow = new Array(N_PL_COLS).fill('') as (string | number)[];
  titleRow[0] = `IAV GROUP P&L — ${month}`;
  rows.push(titleRow);

  // Row 1 — channel group labels
  const grpRow = new Array(N_PL_COLS).fill('') as (string | number)[];
  grpRow[3]              = 'DOMESTIC CHANNELS';
  grpRow[INTL_FIRST_COL] = 'INTERNATIONAL CHANNELS';
  rows.push(grpRow);

  // Row 2 — column headers
  const colHdr: string[] = [
    'Particulars', 'Total ₹', 'Total %',
    ...CHANNELS.flatMap(c => [`${CH[c] ?? c} ₹`, '%`']),
  ];
  // Fix the backtick typo from the template literal
  const correctedHdr = colHdr.map(h => h.replace('%`', '%'));
  rows.push(correctedHdr);

  // Row 3 — "REVENUE" section
  rows.push(sectionRow('REVENUE'));                         // 3
  rows.push(plRowArr(pl.grossSales));                       // 4
  rows.push(plRowArr(pl.cancellations));                    // 5
  rows.push(plRowArr(pl.courierReturns));                   // 6
  rows.push(plRowArr(pl.customerReturns));                  // 7
  rows.push(plRowArr(pl.shippingReceived));                 // 8
  rows.push(plRowArr(pl.netSales));                         // 9
  rows.push(emptyPLRow());                                  // 10

  // Row 11 — "COST OF GOODS SOLD" section
  rows.push(sectionRow('COST OF GOODS SOLD'));              // 11
  rows.push(plRowArr(pl.openingStock));                     // 12
  rows.push(plRowArr(pl.purchases));                        // 13
  rows.push(plRowArr(pl.closingStock));                     // 14
  rows.push(plRowArr(pl.packingMaterial));                  // 15
  rows.push(plRowArr(pl.freightInward));                    // 16
  rows.push(plRowArr(pl.cogs));                             // 17
  rows.push(emptyPLRow());                                  // 18

  // Row 19 — "GROSS PROFIT"
  rows.push(sectionRow('GROSS PROFIT'));                    // 19
  rows.push(plRowArr(pl.grossProfit));                      // 20
  rows.push(emptyPLRow());                                  // 21

  // Row 22 — "EXPENSES"
  rows.push(sectionRow('EXPENSES'));                        // 22
  rows.push(plRowArr(pl.totalDirectExp));                   // 23
  rows.push(plRowArr(pl.totalAllocatedExp));                // 24
  rows.push(emptyPLRow());                                  // 25

  // Row 26 — "NET PROFIT"
  rows.push(sectionRow('NET PROFIT'));                      // 26
  rows.push(plRowArr(pl.netProfit));                        // 27
  rows.push(emptyPLRow());                                  // 28

  // Row 29 — Interest Expense
  const intRow = emptyPLRow() as (string | number)[];
  intRow[0] = 'Interest Expense (Total)';
  intRow[1] = n(pl.interestExpense);
  rows.push(intRow);                                        // 29

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const totalRows = rows.length; // 30

  // Column widths: Particulars | Total₹ | Total% | (Ch₹ | Ch%) × 9
  setCols(ws, [
    36, 14, 8,
    ...CHANNELS.flatMap(() => [13, 8]),
  ]);

  // Merges
  addMerge(ws, 0, 0, 0, N_PL_COLS - 1);           // title row, full width
  addMerge(ws, 1, 3, 1, DOM_LAST_COL);             // DOMESTIC CHANNELS
  addMerge(ws, 1, INTL_FIRST_COL, 1, INTL_LAST_COL); // INTERNATIONAL CHANNELS
  // Section header merges (full width)
  for (const r of [3, 11, 19, 22, 26]) {
    addMerge(ws, r, 0, r, N_PL_COLS - 1);
  }

  // Number formats
  // Currency cols: 1, 3, 5, 7, … (odd indices ≥ 1)
  // Percent cols:  2, 4, 6, 8, … (even indices ≥ 2)
  const DATA_START = 4; // first actual data row (grossSales)
  const DATA_END   = totalRows - 1;
  for (let c = 1; c < N_PL_COLS; c++) {
    const z = (c % 2 === 1) ? INR : PCT;
    fmtCol(ws, c, DATA_START, DATA_END, z);
  }

  // Row heights: title & section header rows taller
  ws['!rows'] = Array.from({ length: totalRows }, (_, i) => {
    if (i === 0) return { hpt: 22 };
    if ([3, 11, 19, 22, 26].includes(i)) return { hpt: 16 };
    return { hpt: 14 };
  });

  return ws;
}

// ── Sheet 2: EXP SHEET ───────────────────────────────────────────────────────

function buildExpSheet(pl: PLOutput): XLSX.WorkSheet {
  const expenses: ExpenseRow[] = pl.expenses ?? [];
  const header: (string | number)[] = [
    'S.No', 'Particulars', 'Total (Books)', 'Data Source', 'Allocation Basis',
    ...CHANNELS.map(c => CH[c] ?? c),
  ];

  // NET SALES reference row (for ratio/context, all values pre-computed)
  const nsRow: (string | number)[] = [
    '', 'NET SALES (reference)', n(pl.netSales.total), '', '',
    ...CHANNELS.map(c => n((pl.netSales.byChannel as Record<string, number>)[c])),
  ];

  const dataRows: (string | number)[][] = expenses.map(e => [
    e.sno ?? '',
    e.particulars ?? '',
    n(e.totalBooks),
    e.dataSource ?? '',
    e.allocationBasis ?? '',
    ...CHANNELS.map(c => n((e.allocated as Record<string, number>)?.[c])),
  ]);

  // Totals row
  const totRow: (string | number)[] = [
    '', 'TOTAL EXPENSES',
    expenses.reduce((s, e) => s + n(e.totalBooks), 0),
    '', '',
    ...CHANNELS.map(c =>
      expenses.reduce((s, e) => s + n((e.allocated as Record<string, number>)?.[c]), 0),
    ),
  ];

  const aoa = [header, nsRow, ...dataRows, totRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: S.No(5) | Particulars(36) | Books(14) | Source(20) | Basis(24) | channels(13 each)
  setCols(ws, [5, 36, 14, 20, 24, ...CHANNELS.map(() => 13)]);

  const lastRow = aoa.length - 1;
  // Total (Books) col = 2 → INR
  fmtCol(ws, 2, 1, lastRow, INR);
  // Channel cols = 5 to 5+len(CHANNELS)-1 → INR
  for (let c = 5; c < 5 + CHANNELS.length; c++) {
    fmtCol(ws, c, 1, lastRow, INR);
  }

  return ws;
}

// ── Sheet 3: ORDERS SHEET ────────────────────────────────────────────────────

function buildOrdersSheet(data: OrdersSheet): XLSX.WorkSheet {
  if (!data?.rows?.length) return XLSX.utils.aoa_to_sheet([['No orders data']]);

  const header = [
    'Label',
    'Total Orders', 'Total Units', 'Total %',
    'Amazon Orders', 'Amazon Units',
    'Flipkart Orders', 'Flipkart Units',
    'Myntra Orders', 'Myntra Units',
    'IAV.in Orders', 'IAV.in Units',
    'Busy Orders', 'Busy Units',
  ];

  const dataRows = data.rows.map(r => [
    r.label,
    n(r.total?.orders), n(r.total?.units), n(r.total?.pct),
    n(r.amazon?.orders), n(r.amazon?.units),
    n(r.flipkart?.orders), n(r.flipkart?.units),
    n(r.myntra?.orders), n(r.myntra?.units),
    n((r as { iavIn?: { orders?: number; units?: number } }).iavIn?.orders),
    n((r as { iavIn?: { orders?: number; units?: number } }).iavIn?.units),
    n((r as { bulkDomestic?: { orders?: number; units?: number } }).bulkDomestic?.orders),
    n((r as { bulkDomestic?: { orders?: number; units?: number } }).bulkDomestic?.units),
  ]);

  // Return breakdown rows
  const rb = data.returnBreakdown;
  const sepRow = new Array(header.length).fill('');
  const rbRows: (string | number)[][] = rb ? [
    sepRow,
    ['Return Breakdown', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Courier Returns', n(rb.courierReturn?.orders), n(rb.courierReturn?.units), n(rb.courierReturn?.pct)],
    ['Customer Returns', n(rb.customerReturn?.orders), n(rb.customerReturn?.units), n(rb.customerReturn?.pct)],
    ['Total Returns', n(rb.totalReturn?.orders), n(rb.totalReturn?.units), n(rb.totalReturn?.pct)],
  ] : [];

  const aoa = [header, ...dataRows, ...rbRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [22, 12, 10, 8, 12, 10, 14, 12, 12, 10, 12, 10, 10, 8]);

  // Orders & Units cols → CNT, % col (index 3) → PCT
  const lastR = aoa.length - 1;
  fmtRect(ws, 1, 1, lastR, 3, CNT);  // total cols
  fmtRect(ws, 1, 4, lastR, 13, CNT); // channel count cols

  return ws;
}

// ── Sheet 4: % Sheet (KPI) ───────────────────────────────────────────────────

const KPI_METRICS: [string, keyof KPIChannelCol][] = [
  ['Share in Net Sale %',    'shareInNetSale'],
  ['Advertisement %',        'advertisement'],
  ['Inbound Transport %',    'inboundTransport'],
  ['Commission %',           'commission'],
  ['Payment Gateway %',      'paymentGateway'],
  ['Shipping / Courier %',   'shippingCourier'],
  ['Storage %',              'storage'],
  ['Exchange Diff %',        'exchangeDiff'],
  ['Subscription %',         'subscription'],
  ['Employee Benefit %',     'employeeBenefit'],
  ['Total Exp %',            'totalExpPct'],
  ['Margin %',               'marginPct'],
  ['Net Sales ₹',            'salesRs'],
  ['Margin ₹',               'marginRs'],
  ['Cancellation %',         'salesCancellationPct'],
  ['Return %',               'salesReturnPct'],
  ['Discount %',             'discountPct'],
];

function buildKpiSheet(data: KPISheet): XLSX.WorkSheet {
  const channels = Object.keys(data?.byChannel ?? {}) as Channel[];
  const header = [
    'Metric',
    'Group',
    ...channels.map(c => CH[c] ?? c),
  ];

  const rows = KPI_METRICS.map(([label, key]) => {
    const groupVal = key === 'marginPct' ? n(data?.groupMarginPct) : '';
    return [
      label,
      groupVal,
      ...channels.map(c => n((data?.byChannel?.[c] as Record<string, number> | undefined)?.[key])),
    ];
  });

  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [26, 12, ...channels.map(() => 13)]);

  const lastR = aoa.length - 1;
  const monetaryRows = [12, 13]; // 0-based data indices: salesRs, marginRs → rows 13, 14 (hdr = 0)
  for (let r = 1; r <= lastR; r++) {
    const metricIdx = r - 1; // 0-based METRIC index
    const isMonetary = metricIdx === 12 || metricIdx === 13; // salesRs, marginRs
    const z = isMonetary ? INR : PCT;
    for (let c = 1; c < header.length; c++) {
      setZ(ws, r, c, z);
    }
  }

  return ws;
}

// ── Sheet 5: AMAZON STATEWISE P&L ───────────────────────────────────────────

const STATEWISE_FIELDS: [string, keyof AmazonStatewisePLRow][] = [
  ['State',                'state'],
  ['Gross Sales',          'grossSales'],
  ['Cancellations',        'cancellations'],
  ['Courier Returns',      'courierReturns'],
  ['Customer Returns',     'customerReturns'],
  ['Total Returns',        'totalReturns'],
  ['Sales After Return',   'salesAfterReturn'],
  ['Shipping Received',    'shippingReceived'],
  ['Discounts',            'discounts'],
  ['Net Sales',            'netSales'],
  ['Share in Net Sale %',  'shareInNetSalePct'],
  ['Total COGS',           'totalCOGS'],
  ['Contribution',         'contribution'],
  ['Advertisement',        'advertisement'],
  ['Inbound Transport',    'inboundTransport'],
  ['Commission',           'commission'],
  ['Shipping/Courier',     'shippingCourier'],
  ['Storage',              'storage'],
  ['Employee Benefit',     'employeeBenefit'],
  ['Total Direct Exp',     'totalDirectExp'],
  ['Earnings Before Alloc','earningsBeforeAlloc'],
  ['Allocated Exp',        'allocatedExp'],
  ['EBIT',                 'ebit'],
  ['Interest Exp',         'interestExp'],
  ['EBT',                  'ebt'],
];

function buildStatewiseSheet(data: AmazonStatewisePL): XLSX.WorkSheet {
  const states: AmazonStatewisePLRow[] = [
    ...(data?.states ?? []),
    ...(data?.total ? [data.total] : []),
  ];

  const header = STATEWISE_FIELDS.map(([label]) => label);
  const dataRows = states.map(row =>
    STATEWISE_FIELDS.map(([, key]) =>
      key === 'state'
        ? String(row[key] ?? '')
        : n(row[key as keyof AmazonStatewisePLRow]),
    ),
  );

  const aoa = [header, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Narrow state col + wide numeric cols
  setCols(ws, [20, ...STATEWISE_FIELDS.slice(1).map(() => 14)]);

  const lastR = aoa.length - 1;
  // All numeric cols (1–24): differentiate ₹ vs %
  for (let ci = 1; ci < STATEWISE_FIELDS.length; ci++) {
    const key = STATEWISE_FIELDS[ci][1];
    const z = key === 'shareInNetSalePct' ? PCT : INR;
    fmtCol(ws, ci, 1, lastR, z);
  }

  return ws;
}

// ── Sheet 6: STATEWISE SALE ──────────────────────────────────────────────────

function buildStatewiseSaleSheet(data: StatewiseSale): XLSX.WorkSheet {
  if (!data?.combined?.length) return XLSX.utils.aoa_to_sheet([['No statewise sale data']]);
  const header = ['State', 'Gross Sales', 'Returns', 'Net Sales'];
  const rows = data.combined.map(r => [r.state, n(r.grossSales), n(r.returns), n(r.netSales)]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [22, 14, 14, 14]);
  const lastR = aoa.length - 1;
  fmtRect(ws, 1, 1, lastR, 3, INR);
  return ws;
}

// ── Sheet 7: MONTHWISE AMAZON CONSO P&L ────────────────────────────────────

const MONTHWISE_COLS: [string, keyof AmazonMonthlyPLRow][] = [
  ['Month',              'month'],
  ['Gross Sales',        'grossSales'],
  ['Cancellations',      'cancellations'],
  ['Courier Returns',    'courierReturns'],
  ['Customer Returns',   'customerReturns'],
  ['Sales After Return', 'salesAfterReturn'],
  ['Shipping Received',  'shippingReceived'],
  ['Gift Wrap',          'giftWrap'],
  ['Discounts',          'discounts'],
  ['Net Sales',          'netSales'],
  ['Opening Stock',      'openingStock'],
  ['Purchases',          'purchases'],
  ['Closing Stock',      'closingStock'],
  ['Packing Material',   'packingMaterial'],
  ['Freight Inward',     'freightInward'],
  ['Total COGS',         'totalCOGS'],
  ['Gross Profit',       'grossProfit'],
  ['Advertisement',      'advertisement'],
  ['Inbound Transport',  'inboundTransport'],
  ['Commission',         'commission'],
  ['Payment Gateway',    'paymentGateway'],
  ['Shipping/Courier',   'shippingCourier'],
  ['Storage',            'storage'],
  ['Exchange Diff',      'exchangeDiff'],
  ['Subscription',       'subscription'],
  ['Employee Benefit',   'employeeBenefit'],
  ['Total Direct Exp',   'totalDirectExp'],
  ['EBIT Amazon',        'ebitAmazon'],
];

function buildMonthwiseSheet(history: AmazonMonthlyPLRow[]): XLSX.WorkSheet {
  if (!history?.length) return XLSX.utils.aoa_to_sheet([['No monthwise data']]);

  const header = MONTHWISE_COLS.map(([label]) => label);
  const rows = history.map(r =>
    MONTHWISE_COLS.map(([, key]) =>
      key === 'month' ? String(r[key] ?? '') : n(r[key]),
    ),
  );

  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [12, ...MONTHWISE_COLS.slice(1).map(() => 14)]);

  const lastR = aoa.length - 1;
  // All numeric cols (1–27) → INR
  fmtRect(ws, 1, 1, lastR, MONTHWISE_COLS.length - 1, INR);

  return ws;
}

// ── Sheet 8: QTRLY AMAZON CONSO P&L ────────────────────────────────────────

function buildQuarterlySheet(data: QuarterlyRollup): XLSX.WorkSheet {
  if (!data?.amazon) return XLSX.utils.aoa_to_sheet([['No quarterly data']]);

  const { quarter, fiscalYear, months, amazon } = data;

  const metaRows: (string | number)[][] = [
    ['Quarter',     quarter ?? ''],
    ['Fiscal Year', fiscalYear ?? ''],
    ['Months',      (months ?? []).join(', ')],
    [],
    ['Metric', 'Value'],
  ];

  const dataRows: (string | number)[][] = MONTHWISE_COLS.slice(1).map(([label, key]) => [
    label,
    n((amazon as unknown as Record<string, number>)[key]),
  ]);

  const aoa = [...metaRows, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [26, 16]);

  const lastR = aoa.length - 1;
  // Data starts at row 5 (after 4 meta rows + header row)
  fmtCol(ws, 1, 5, lastR, INR);

  return ws;
}

// ── Sheets 9-11: Comparative P&L ────────────────────────────────────────────

function buildComparativeSheet(comp: ComparativePL): XLSX.WorkSheet {
  if (!comp) return XLSX.utils.aoa_to_sheet([['No comparative data']]);

  const header: (string | number)[] = [
    'Particulars',
    comp.previousLabel ?? 'Previous',
    comp.currentLabel  ?? 'Current',
    'Change (₹)',
    'Change (%)',
  ];

  const dataRows: (string | number)[][] = (comp.rows ?? []).map((r: ComparativePLRow) => [
    r.label,
    n(r.previous),
    n(r.current),
    n(r.change),
    r.changePct !== null && r.changePct !== undefined ? n(r.changePct) : '',
  ]);

  const aoa: (string | number)[][] = [header, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [36, 14, 14, 14, 10]);

  const lastMainRow = aoa.length - 1;
  // Cols 1-3 → INR, col 4 → PCT
  fmtRect(ws, 1, 1, lastMainRow, 3, INR);
  fmtCol(ws, 4, 1, lastMainRow, PCT);

  // Append rolling history table (amazon_monthly type)
  if (comp.history?.length) {
    const histStartRow = aoa.length + 2; // gap of 2 blank rows
    const histKeys = Object.keys(comp.history[0]?.values ?? {});
    const histHeader = ['Month', ...histKeys.map(k => k.replace(/([A-Z])/g, ' $1').trim())];
    const histDataRows = comp.history.map(h => [
      h.label ?? '',
      ...histKeys.map(k => n(h.values?.[k])),
    ]);
    XLSX.utils.sheet_add_aoa(ws, [[], [], histHeader, ...histDataRows], {
      origin: { r: aoa.length, c: 0 },
    });
    const histLastRow = histStartRow + histDataRows.length;
    // Numeric cols in history → INR (cols 1 onwards)
    fmtRect(ws, histStartRow, 1, histLastRow, histHeader.length - 1, INR);
  }

  return ws;
}

// ── Sheet 12: AMAZON SUMMRY SHEET ───────────────────────────────────────────

function buildAmazonSummarySheet(data: AmazonSummarySheet): XLSX.WorkSheet {
  if (!data?.rows?.length) return XLSX.utils.aoa_to_sheet([['No Amazon summary data']]);
  const header = ['Basis', 'Particulars', 'B2B', 'B2C', 'Total'];
  const rows = data.rows.map(r => [r.basis ?? '', r.particulars ?? '', n(r.b2b), n(r.b2c), n(r.total)]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [12, 30, 14, 14, 14]);
  fmtRect(ws, 1, 2, aoa.length - 1, 4, INR);
  return ws;
}

// ── Sheet 13: AMAZON EXP SHEET ──────────────────────────────────────────────

function buildAmazonExpSheet(data: AmazonExpSheet): XLSX.WorkSheet {
  if (!data?.fees?.length) return XLSX.utils.aoa_to_sheet([['No Amazon expense data']]);
  const states = data.states ?? [];
  const header = ['Fee Label', ...states, 'Total Invoice', 'Total Credit', 'Total Net'];
  const rows = data.fees.map(f => [
    f.feeLabel ?? '',
    ...states.map(s => {
      const entry = f.byState?.[s] as { net?: number; invoice?: number } | number | undefined;
      if (entry === null || entry === undefined) return 0;
      if (typeof entry === 'number') return n(entry);
      return n(entry?.net);
    }),
    n(f.totalInvoice),
    n(f.totalCreditNote),
    n(f.totalNet),
  ]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [22, ...states.map(() => 12), 14, 14, 14]);
  const numCols = header.length - 1;
  fmtRect(ws, 1, 1, aoa.length - 1, numCols, INR);
  return ws;
}

// ── Sheet 14: FLIPKART SUMMRY SHEET ─────────────────────────────────────────

function buildFlipkartSummarySheet(data: FlipkartSummarySheet): XLSX.WorkSheet {
  if (!data?.rows?.length) return XLSX.utils.aoa_to_sheet([['No Flipkart summary data']]);
  const header = ['Basis', 'Particulars', 'Sales', 'Cashback', 'Total'];
  const rows = data.rows.map(r => [r.basis ?? '', r.particulars ?? '', n(r.sales), n(r.cashback), n(r.total)]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [12, 30, 14, 14, 14]);
  fmtRect(ws, 1, 2, aoa.length - 1, 4, INR);
  return ws;
}

// ── Sheet 15: FLIPKART EXP SHEET ────────────────────────────────────────────

function buildFlipkartExpSheet(data: FlipkartExpSheet): XLSX.WorkSheet {
  if (!data?.fees?.length) return XLSX.utils.aoa_to_sheet([['No Flipkart expense data']]);
  const states = data.states ?? [];
  const header = ['Fee Label', ...states, 'Total'];
  const rows = data.fees.map(f => [
    f.feeLabel ?? '',
    ...states.map(s => n((f.byState?.[s] as number | undefined))),
    n(f.total),
  ]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [22, ...states.map(() => 12), 14]);
  fmtRect(ws, 1, 1, aoa.length - 1, header.length - 1, INR);
  return ws;
}

// ── Sheet 16: UNIWARE SUMMRY SHEET ──────────────────────────────────────────

function buildUniwareSummarySheet(data: UniwareSummarySheet): XLSX.WorkSheet {
  if (!data?.rows?.length) return XLSX.utils.aoa_to_sheet([['No Uniware summary data']]);
  const header = [
    'Row Type',
    'Myntra — Principal', 'Myntra — Shipping', 'Myntra — COD', 'Myntra — Discount',
    'IAV.in — Principal', 'IAV.in — Shipping', 'IAV.in — COD', 'IAV.in — Discount',
  ];
  const rows = data.rows.map(r => [
    r.rowType ?? '',
    n(r.myntra?.principalBasics), n(r.myntra?.shipping),
    n(r.myntra?.codCharges),      n(r.myntra?.discount),
    n(r.iavIn?.principalBasics),  n(r.iavIn?.shipping),
    n(r.iavIn?.codCharges),       n(r.iavIn?.discount),
  ]);
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  setCols(ws, [18, 16, 14, 12, 12, 16, 14, 12, 12]);
  fmtRect(ws, 1, 1, aoa.length - 1, 8, INR);
  return ws;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ExportInput {
  pl:              PLOutput;
  month:           string;
  intermediates:   IntermediateSheets;
  comparative:     ComparativePL[];
  ordersSheet:     OrdersSheet;
  kpiSheet:        KPISheet;
  amazonStatewise: AmazonStatewisePL;
  quarterly:       QuarterlyRollup;
  amazonHistory:   AmazonMonthlyPLRow[];
}

/**
 * Assembles all 16 sheets and returns an .xlsx Buffer.
 * Sheet order matches the original IAV workbook convention.
 */
export function exportWorkbook(input: ExportInput): Buffer {
  const {
    pl, month, intermediates, comparative,
    ordersSheet, kpiSheet, amazonStatewise, quarterly, amazonHistory,
  } = input;

  const wb = XLSX.utils.book_new();

  // ① IAV P&L
  addSheet(wb, `IAV P&L ${month}`, buildIAVPLSheet(pl, month));

  // ② EXP SHEET — all values pre-computed (no #VALUE!)
  addSheet(wb, 'EXP SHEET', buildExpSheet(pl));

  // ③ ORDERS SHEET
  addSheet(wb, 'ORDERS SHEET', buildOrdersSheet(ordersSheet));

  // ④ % Sheet (KPI)
  addSheet(wb, '% Sheet', buildKpiSheet(kpiSheet));

  // ⑤ AMAZON STATEWISE P&L
  addSheet(wb, 'AMAZON STATEWISE P&L', buildStatewiseSheet(amazonStatewise));

  // ⑥ STATEWISE SALE
  if (intermediates?.statewiseSale) {
    addSheet(wb, 'STATEWISE SALE', buildStatewiseSaleSheet(intermediates.statewiseSale));
  }

  // ⑦ MONTHWISE AMAZON CONSO P&L
  addSheet(wb, 'MONTHWISE AMAZON CONSO P&L', buildMonthwiseSheet(amazonHistory));

  // ⑧ QTRLY AMAZON CONSO P&L
  addSheet(wb, 'QTRLY AMAZON CONSO P&L', buildQuarterlySheet(quarterly));

  // ⑨–⑪ Comparative sheets
  const groupComp   = comparative?.find(c => c.type === 'group_monthly');
  const monthlyComp = comparative?.find(c => c.type === 'amazon_monthly');
  const qtrComp     = comparative?.find(c => c.type === 'amazon_quarterly');

  if (groupComp)   addSheet(wb, 'IAV GROUP COMPARATIVE P&L',   buildComparativeSheet(groupComp));
  if (monthlyComp) addSheet(wb, 'AMAZON MONTHLY COMPARATIVE',  buildComparativeSheet(monthlyComp));
  if (qtrComp)     addSheet(wb, 'AMAZON QUARTERLY COMPARATIVE', buildComparativeSheet(qtrComp));

  // ⑫–⑯ Intermediate sheets
  if (intermediates?.amazonSummary)
    addSheet(wb, 'AMAZON SUMMRY SHEET',    buildAmazonSummarySheet(intermediates.amazonSummary));
  if (intermediates?.amazonExpSheet)
    addSheet(wb, 'AMAZON EXP SHEET',       buildAmazonExpSheet(intermediates.amazonExpSheet));
  if (intermediates?.flipkartSummary)
    addSheet(wb, 'FLIPKART SUMMRY SHEET',  buildFlipkartSummarySheet(intermediates.flipkartSummary));
  if (intermediates?.flipkartExpSheet)
    addSheet(wb, 'FLIPKART EXP SHEET',     buildFlipkartExpSheet(intermediates.flipkartExpSheet));
  if (intermediates?.uniwareSummary)
    addSheet(wb, 'UNIWARE SUMMRY SHEET',   buildUniwareSummarySheet(intermediates.uniwareSummary));

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
