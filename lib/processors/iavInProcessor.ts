import * as XLSX from 'xlsx';
import type {
  StatewisePL,
  IavInResult,
  IavInChannelSummary,
  UniwareSummarySheet,
  UniwareSummarySheetRow,
} from '../types';
import { readSheet, readTripleHeaderSheet, parseDate, safeNum } from '../utils/parser';

// ── Helpers ───────────────────────────────────────────────────────────────

function hIdx(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex(h => h.trim().toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

// ── Internal row type ─────────────────────────────────────────────────────

interface TallyRow {
  date:            Date | null;
  voucherNo:       string;
  channelLedger:   string;
  qty:             number;
  currency:        string;
  total:           number;
  discountAmount:  number;
  shipToState:     string;
  voucherTypeName: string;
}

// ── Sheet parser ──────────────────────────────────────────────────────────

/**
 * Parse an Export-Tally GST Report sheet (triple-header format).
 * Column spec (1-indexed): Date(1), Channel Ledger(5), Qty(8), Currency(10),
 * Total(12), Shipping Address State(18), Discount Amount(43), Voucher Type Name(49).
 * Header names used for lookup via readTripleHeaderSheet.
 */
function parseTallySheet(wb: XLSX.WorkBook, sheetName: string): TallyRow[] {
  if (!wb.Sheets[sheetName]) return [];

  const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

  const iDate        = hIdx(headers, 'Date');
  const iVoucherNo   = hIdx(headers, 'Voucher No', 'Voucher Number', 'Invoice No', 'Reference No');
  const iChannel     = hIdx(headers, 'Channel Ledger', 'Channel', 'Ledger');
  const iQty         = hIdx(headers, 'Qty', 'Quantity');
  const iCurrency    = hIdx(headers, 'Currency');
  const iTotal       = hIdx(headers, 'Total', 'Invoice Amount', 'Grand Total');
  const iDiscount    = hIdx(headers, 'Discount Amount', 'Disc Amount');
  const iState       = hIdx(headers, 'Shipping Address State', 'Ship To State', 'Shipping State', 'State');
  const iVoucherType = hIdx(headers, 'Voucher Type Name', 'Voucher Type', 'Type');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    date:            parseDate(g(row, iDate)),
    voucherNo:       String(g(row, iVoucherNo)    ?? '').trim(),
    channelLedger:   String(g(row, iChannel)      ?? '').trim(),
    qty:             safeNum(g(row, iQty)),
    currency:        String(g(row, iCurrency)     ?? '').trim().toUpperCase(),
    total:           safeNum(g(row, iTotal)),
    discountAmount:  safeNum(g(row, iDiscount)),
    shipToState:     String(g(row, iState)        ?? '').trim().toUpperCase(),
    voucherTypeName: String(g(row, iVoucherType)  ?? '').trim(),
  }));
}

// ── Channel + ledger classification ──────────────────────────────────────

type RowChannel = 'iavIn' | 'iavCom' | 'myntra' | 'flipkart' | 'other';

/**
 * Classify a row's channel ledger to a known channel.
 * Flipkart rows are explicitly identified so they can be skipped (handled by flipkartProcessor).
 */
function classifyChannel(row: TallyRow): RowChannel {
  const ledger = row.channelLedger.toUpperCase();
  const curr   = row.currency;

  if (ledger.includes('FLIPKART'))                                                 return 'flipkart';
  if (ledger === 'MYNTRAPPMP' || ledger.includes('MYNTRA'))                        return 'myntra';
  if (curr === 'USD' || ledger.includes('AMAZON_US') || ledger.includes('.COM'))   return 'iavCom';
  if (ledger.includes('INDIANARTVILLA') || ledger.includes('INDIAN ART VILLA'))    return 'iavIn';
  if (curr === 'INR')                                                              return 'iavIn';
  return 'other';
}

type LedgerRole = 'channel' | 'freight' | 'cod' | 'skip';

/**
 * Determine if a ledger row is a sales/channel row, a freight charge, a COD charge,
 * or should be skipped (tax pass-through ledgers).
 */
function getLedgerRole(ledger: string): LedgerRole {
  const up = ledger.toUpperCase();
  // Tax pass-through — skip
  if (up.includes('IGST') || up.includes('CGST') || up.includes('SGST') ||
      up.includes(' TCS') || up.includes('CESS') || up.includes('OUTPUT TAX'))  return 'skip';
  // Freight / courier charges
  if (up.includes('FREIGHT') || up.includes('COURIER CHARGE') ||
      up.includes('SHIPPING CHARGE') || up.includes('DELIVERY CHARGE'))          return 'freight';
  // COD
  if (up.includes('COD') || up.includes('CASH ON DELIVERY'))                     return 'cod';
  return 'channel';
}

/** Return true if the voucher type represents a return (not a forward sale). */
function isReturnVoucher(voucherTypeName: string): boolean {
  const lc = voucherTypeName.toLowerCase();
  return lc.includes('credit note') || lc.includes('sales return') || lc.includes('return');
}

/**
 * 5A + 5B — Classify a return as Courier or Customer.
 * "Sales Return" vouchers in Tally represent physical goods returned (courier-style).
 * "Credit Note" vouchers represent accounting adjustments (customer-initiated).
 */
function classifyReturnKind(voucherTypeName: string): 'courier' | 'customer' {
  return voucherTypeName.toLowerCase().includes('sales return') ? 'courier' : 'customer';
}

// ── Accumulators ──────────────────────────────────────────────────────────

interface ChannelAcc {
  grossSales:    number;
  returns:       number;
  courierReturn: number;
  customerReturn: number;
  shipping:      number;
  codCharges:    number;
  discount:      number;
  stateGross:    Map<string, number>;
  stateReturns:  Map<string, number>;
  orderNos:      Set<string>;
}

function makeAcc(): ChannelAcc {
  return {
    grossSales: 0, returns: 0, courierReturn: 0, customerReturn: 0,
    shipping: 0, codCharges: 0, discount: 0,
    stateGross: new Map(), stateReturns: new Map(), orderNos: new Set(),
  };
}

/**
 * Accumulate rows into per-channel buckets.
 * @param forceReturn - true for the Return GST Report (all rows are returns regardless of voucherType)
 */
function accumulate(
  rows: TallyRow[],
  acc: Record<'iavIn' | 'iavCom' | 'myntra', ChannelAcc>,
  forceReturn: boolean,
): void {
  for (const row of rows) {
    const role = getLedgerRole(row.channelLedger);
    if (role === 'skip') continue;

    const ch = classifyChannel(row);
    if (ch === 'flipkart' || ch === 'other') continue;

    const a     = acc[ch];
    const state = row.shipToState || 'UNKNOWN';

    if (role === 'freight') {
      a.shipping += Math.abs(row.total);
      continue;
    }
    if (role === 'cod') {
      a.codCharges += Math.abs(row.total);
      continue;
    }

    // role === 'channel'
    const isReturn = forceReturn || isReturnVoucher(row.voucherTypeName);

    if (isReturn) {
      const amt  = Math.abs(row.total);
      const kind = classifyReturnKind(row.voucherTypeName);
      a.returns += amt;
      if (kind === 'courier') a.courierReturn  += amt;
      else                    a.customerReturn += amt;
      a.stateReturns.set(state, (a.stateReturns.get(state) ?? 0) + amt);
    } else {
      a.grossSales += row.total;
      a.discount   += row.discountAmount;
      a.stateGross.set(state, (a.stateGross.get(state) ?? 0) + row.total);
      if (row.voucherNo) a.orderNos.add(row.voucherNo);
    }
  }
}

// ── 5D — Statewise builder ────────────────────────────────────────────────

/** Build StatewisePL[] directly from accumulated Tally row data (more reliable than sheet). */
function toStatewise(a: ChannelAcc): StatewisePL[] {
  const states = new Set([...a.stateGross.keys(), ...a.stateReturns.keys()]);
  return Array.from(states)
    .map(state => {
      const gross = a.stateGross.get(state)   ?? 0;
      const ret   = a.stateReturns.get(state) ?? 0;
      const net   = gross - ret;
      return { state, grossSales: gross, cancellations: 0, returns: ret,
               netSales: net, expenseAllocation: 0, netEarnings: net };
    })
    .filter(r => r.grossSales !== 0 || r.returns !== 0)
    .sort((a, b) => b.netSales - a.netSales);
}

// ── 5C — UNIWARE SUMMRY SHEET builder ────────────────────────────────────

function computeSummarySheet(iavIn: ChannelAcc, myntra: ChannelAcc): UniwareSummarySheet {
  type Side = UniwareSummarySheetRow['iavIn'];

  const buildSide = (ch: ChannelAcc, rowType: UniwareSummarySheetRow['rowType']): Side => {
    switch (rowType) {
      case 'SALES':
        return { principalBasics: ch.grossSales, shipping: ch.shipping, codCharges: ch.codCharges, discount: ch.discount };
      case 'RETURN_COURIER':
        return { principalBasics: ch.courierReturn,  shipping: 0, codCharges: 0, discount: 0 };
      case 'RETURN_CUSTOMER':
        return { principalBasics: ch.customerReturn, shipping: 0, codCharges: 0, discount: 0 };
      case 'CANCEL':
        return { principalBasics: 0, shipping: 0, codCharges: 0, discount: 0 };
      case 'NET_SALES': {
        const net = ch.grossSales - ch.returns + ch.shipping + ch.codCharges - ch.discount;
        return { principalBasics: net, shipping: ch.shipping, codCharges: ch.codCharges, discount: ch.discount };
      }
    }
  };

  const ROW_TYPES: UniwareSummarySheetRow['rowType'][] =
    ['SALES', 'RETURN_COURIER', 'RETURN_CUSTOMER', 'CANCEL', 'NET_SALES'];

  const rows: UniwareSummarySheetRow[] = ROW_TYPES.map(rowType => ({
    rowType,
    myntra: buildSide(myntra, rowType),
    iavIn:  buildSide(iavIn,  rowType),
  }));

  // Combined domestic (IAV_IN + Myntra) per-state breakdown
  const allStates = new Set([
    ...iavIn.stateGross.keys(), ...iavIn.stateReturns.keys(),
    ...myntra.stateGross.keys(), ...myntra.stateReturns.keys(),
  ]);
  const byState: UniwareSummarySheet['byState'] = {};
  for (const state of allStates) {
    const sales   = (iavIn.stateGross.get(state)   ?? 0) + (myntra.stateGross.get(state)   ?? 0);
    const returns = (iavIn.stateReturns.get(state) ?? 0) + (myntra.stateReturns.get(state) ?? 0);
    byState[state] = { sales, returns, net: sales - returns };
  }

  return { rows, byState };
}

// ── Fallback: UNIWARE SUMMRY SHEET net override ───────────────────────────

/**
 * If the Tally report sheets are missing, fall back to reading computed net sales
 * from the pre-built UNIWARE SUMMRY SHEET in the workbook.
 */
function readUniwareNetFallback(wb: XLSX.WorkBook): { uninetMyntra: number; uninetIavIn: number } {
  if (!wb.Sheets['UNIWARE SUMMRY SHEET']) return { uninetMyntra: 0, uninetIavIn: 0 };

  let uninetMyntra = 0;
  let uninetIavIn  = 0;
  const rows = readSheet(wb, 'UNIWARE SUMMRY SHEET', 0);
  for (const row of rows) {
    const label = String(row[0] ?? '').trim().toUpperCase();
    if (label === 'NET SALES') {
      uninetMyntra = safeNum(row[2]);   // col 2: PRINCIPAL BASICS for Myntra
      uninetIavIn  = safeNum(row[10]);  // col 10: PRINCIPAL BASICS for IAV.IN
      break;
    }
  }
  return { uninetMyntra, uninetIavIn };
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_IAV_IN_RESULT: IavInResult = {
  iavIn:  { grossSales: 0, returns: 0, courierReturn: 0, customerReturn: 0, shipping: 0, codCharges: 0, discount: 0, netSales: 0 },
  iavCom: { grossSales: 0, returns: 0, shipping: 0, discount: 0, netSales: 0 },
  myntra: { grossSales: 0, returns: 0, shipping: 0, discount: 0, netSales: 0 },
  statewise: { iavIn: [], iavCom: [], myntra: [] },
  summarySheet: { rows: [], byState: {} },
  orders: { iavIn: 0, iavCom: 0, myntra: 0 },
};

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Full IAV / Tally pipeline.
 *
 * - 5A: Process Export-Tally Return GST Report (all rows are returns, classified by voucherType)
 * - 5B: Full gross sales breakdown per channel (grossSales, returns split, shipping, COD, discount)
 * - 5C: Compute UNIWARE SUMMRY SHEET from accumulated data
 * - 5D: Build statewise data from Tally rows (more accurate than STATEWISE SALE sheet)
 *
 * Fallback: if Tally sheets are absent, reads pre-built net values from UNIWARE SUMMRY SHEET.
 */
export function processIavIn(wb: XLSX.WorkBook): IavInResult {
  const salesRows  = parseTallySheet(wb, 'Export-Tally GST Report-indiana');
  const returnRows = parseTallySheet(wb, 'Export-Tally Return GST Report-');

  const acc: Record<'iavIn' | 'iavCom' | 'myntra', ChannelAcc> = {
    iavIn:  makeAcc(),
    iavCom: makeAcc(),
    myntra: makeAcc(),
  };

  accumulate(salesRows,  acc, false);  // let voucherTypeName drive return detection in sales sheet
  accumulate(returnRows, acc, true);   // 5A: force all rows as returns

  const a = acc.iavIn;
  const c = acc.iavCom;
  const m = acc.myntra;

  // 5B: net = gross - returns + shipping + COD - discount
  const iavInNet  = a.grossSales - a.returns + a.shipping + a.codCharges - a.discount;
  const iavComNet = c.grossSales - c.returns + c.shipping - c.discount;
  const myntraNet = m.grossSales - m.returns + m.shipping - m.discount;

  // Fallback to UNIWARE SUMMRY SHEET pre-built values if Tally sheets were absent
  const { uninetMyntra, uninetIavIn } = readUniwareNetFallback(wb);
  const finalIavInNet  = a.grossSales === 0 && uninetIavIn  !== 0 ? uninetIavIn  : iavInNet;
  const finalMyntraNet = m.grossSales === 0 && uninetMyntra !== 0 ? uninetMyntra : myntraNet;

  const iavInSummary: IavInChannelSummary = {
    grossSales:    a.grossSales,
    returns:       a.returns,
    courierReturn: a.courierReturn,
    customerReturn: a.customerReturn,
    shipping:      a.shipping,
    codCharges:    a.codCharges,
    discount:      a.discount,
    netSales:      finalIavInNet,
  };

  return {
    iavIn:  iavInSummary,
    iavCom: { grossSales: c.grossSales, returns: c.returns, shipping: c.shipping, discount: c.discount, netSales: iavComNet },
    myntra: { grossSales: m.grossSales, returns: m.returns, shipping: m.shipping, discount: m.discount, netSales: finalMyntraNet },
    statewise: {
      iavIn:  toStatewise(a),   // 5D
      iavCom: toStatewise(c),
      myntra: toStatewise(m),
    },
    summarySheet: computeSummarySheet(a, m),  // 5C
    orders: {
      iavIn:  a.orderNos.size,
      iavCom: c.orderNos.size,
      myntra: m.orderNos.size,
    },
  };
}

// ── Backward-compatible thin wrappers ─────────────────────────────────────

/** Returns IAV.IN net sales per state as Record<STATE, netSales>. */
export function getIavInStatewise(wb: XLSX.WorkBook): Record<string, number> {
  const statewise = processIavIn(wb).statewise.iavIn;
  return Object.fromEntries(statewise.map(r => [r.state, r.netSales]));
}
