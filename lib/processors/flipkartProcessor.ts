import * as XLSX from 'xlsx';
import type {
  FlipkartSummary,
  FlipkartResult,
  FlipkartOrderCounts,
  FlipkartSummarySheet,
  FlipkartSummarySheetRow,
  FlipkartExpSheet,
  FlipkartExpFeeRow,
  StatewisePL,
} from '../types';
import { readSheet, readTripleHeaderSheet, parseDate, safeNum, cleanFlipkartSKU } from '../utils/parser';

// ── Helpers ───────────────────────────────────────────────────────────────

function hIdx(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex(h => h.trim().toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Safely convert a potentially-numeric Order Item ID to its full integer string.
 * Excel/xlsx may parse it as a float (e.g. 4.36761007535518e+17).
 */
function safeItemId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    return raw.toFixed(0);
  }
  const s = String(raw).trim();
  if (s.includes('e') || s.includes('E')) {
    return Math.round(parseFloat(s)).toFixed(0);
  }
  return s.replace(/\..*$/, '');
}

// ── Internal row types ────────────────────────────────────────────────────

interface SalesRow {
  eventType: 'Sale' | 'Return' | 'Cancellation' | 'Return Cancellation';
  orderId: string;
  orderItemId: string;
  orderDate: Date | null;
  sku: string;
  deliveryState: string;
  qty: number;
  sellerShare: number;
  finalInvoiceAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  tcsTotal: number;
  shippingCharges: number;
}

interface CashbackRow {
  orderId: string;
  documentType: 'Credit Note' | 'Debit Note';
  documentSubType: 'Sale' | 'Return';
  invoiceAmount: number;
  taxableValue: number;
  deliveryState: string;
}

// ── Sheet parsers ─────────────────────────────────────────────────────────

function parseSalesRows(wb: XLSX.WorkBook, sheetName: string): SalesRow[] {
  if (!wb.Sheets[sheetName]) return [];

  const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

  const iEvent    = hIdx(headers, 'Event Type', 'Type');
  const iOrder    = hIdx(headers, 'Order ID', 'Order Id');
  const iItem     = hIdx(headers, 'Order Item ID', 'Order Item Id');
  const iDate     = hIdx(headers, 'Order Date', 'Transaction Date');
  const iSku      = hIdx(headers, 'SKU', 'Listing SKU');
  const iState    = hIdx(headers, "Customer's Delivery State", 'Delivery State', 'State');
  const iQty      = hIdx(headers, 'Item Quantity', 'Quantity', 'Qty');
  const iShare    = hIdx(headers, "Seller's Share", 'Seller Share');
  const iInv      = hIdx(headers, 'Final Invoice Amount', 'Invoice Amount', 'Total');
  const iIgst     = hIdx(headers, 'IGST Amount', 'IGST');
  const iCgst     = hIdx(headers, 'CGST Amount', 'CGST');
  const iSgst     = hIdx(headers, 'SGST Amount', 'SGST');
  const iTcs      = hIdx(headers, 'TCS Total', 'Total TCS');
  const iShipChg  = hIdx(headers, 'Shipping Charges', 'Shipping');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  const normaliseEvent = (raw: string): SalesRow['eventType'] => {
    const lc = raw.toLowerCase();
    if (lc === 'sale')                               return 'Sale';
    if (lc === 'cancellation' || lc === 'cancel')    return 'Cancellation';
    if (lc === 'return cancellation')                return 'Return Cancellation';
    if (lc === 'customer_return' || lc === 'return') return 'Return';
    return 'Sale';
  };

  return rows.map(row => ({
    eventType:          normaliseEvent(String(g(row, iEvent) ?? '').trim()),
    orderId:            String(g(row, iOrder) ?? '').trim(),
    orderItemId:        safeItemId(g(row, iItem)),
    orderDate:          parseDate(g(row, iDate)),
    sku:                cleanFlipkartSKU(g(row, iSku)),
    deliveryState:      String(g(row, iState) ?? '').trim().toUpperCase(),
    qty:                safeNum(g(row, iQty)),
    sellerShare:        safeNum(g(row, iShare)),
    finalInvoiceAmount: safeNum(g(row, iInv)),
    igstAmount:         safeNum(g(row, iIgst)),
    cgstAmount:         safeNum(g(row, iCgst)),
    sgstAmount:         safeNum(g(row, iSgst)),
    tcsTotal:           safeNum(g(row, iTcs)),
    shippingCharges:    safeNum(g(row, iShipChg)),
  }));
}

function parseCashbackRows(wb: XLSX.WorkBook, sheetName: string): CashbackRow[] {
  if (!wb.Sheets[sheetName]) return [];

  const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

  const iOrder   = hIdx(headers, 'Order ID', 'Order Id');
  const iDocType = hIdx(headers, 'Document Type');
  const iSubType = hIdx(headers, 'Document Sub Type', 'Sub Type');
  const iInv     = hIdx(headers, 'Invoice Amount', 'Total Amount');
  const iTaxable = hIdx(headers, 'Taxable Value', 'Taxable Amount');
  const iState   = hIdx(headers, "Customer's Delivery State", 'Delivery State', 'State');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    orderId:         String(g(row, iOrder)   ?? '').trim(),
    documentType:    String(g(row, iDocType) ?? '').trim() as 'Credit Note' | 'Debit Note',
    documentSubType: String(g(row, iSubType) ?? '').trim() as 'Sale' | 'Return',
    invoiceAmount:   safeNum(g(row, iInv)),
    taxableValue:    safeNum(g(row, iTaxable)),
    deliveryState:   String(g(row, iState)   ?? '').trim().toUpperCase(),
  }));
}

/**
 * 4A — Parse FLIPKART RETURN sheet.
 *
 * Layout (Excel rows):
 *   Row 1: column headers
 *   Row 2: TRUE/FALSE filter row
 *   Row 3: sparse sub-headers in cols 5/6/7 (Order ID / Order Item ID / Return Type)
 *   Row 4+: data
 *
 * Builds a single map keyed by BOTH Order ID and Order Item ID → classification.
 */
function parseReturnSheet(wb: XLSX.WorkBook): Map<string, 'Courier Return' | 'Customer Return'> {
  const map = new Map<string, 'Courier Return' | 'Customer Return'>();
  if (!wb.Sheets['FLIPKART RETURN']) return map;

  const allRows = readSheet(wb, 'FLIPKART RETURN', 0);
  if (allRows.length < 4) return map;

  // Row index 2 = Excel row 3 sub-headers
  const subHeaders = (allRows[2] as any[]).map(h => String(h ?? '').trim().toLowerCase());
  let colOrderId = subHeaders.findIndex(h => h.includes('order id') && !h.includes('item'));
  let colItemId  = subHeaders.findIndex(h => h.includes('order item id'));
  let colRetType = subHeaders.findIndex(h => h.includes('return type') || h.includes('type'));

  // Fallback to fixed columns 4/5/6 (0-indexed) per spec
  if (colOrderId === -1) colOrderId = 4;
  if (colItemId  === -1) colItemId  = 5;
  if (colRetType === -1) colRetType = 6;

  const classify = (raw: string): 'Courier Return' | 'Customer Return' =>
    raw.toLowerCase().includes('courier') ? 'Courier Return' : 'Customer Return';

  for (const row of allRows.slice(3)) {
    const r        = row as any[];
    const orderId  = String(r[colOrderId] ?? '').trim();
    const itemId   = safeItemId(r[colItemId]);
    const rawType  = String(r[colRetType] ?? '').trim();

    if (!rawType) continue;
    const kind = classify(rawType);
    if (orderId) map.set(orderId, kind);
    if (itemId)  map.set(itemId,  kind);
  }
  return map;
}

// ── Statewise builder ─────────────────────────────────────────────────────

function buildStatewise(
  salesRows: SalesRow[],
  cashbackRows: CashbackRow[],
): StatewisePL[] {
  const stateMap = new Map<string, { gross: number; cancel: number; returns: number }>();
  const ensure   = (s: string) => {
    if (!stateMap.has(s)) stateMap.set(s, { gross: 0, cancel: 0, returns: 0 });
  };

  for (const row of salesRows) {
    const state = row.deliveryState || 'UNKNOWN';
    ensure(state);
    const s = stateMap.get(state)!;
    switch (row.eventType) {
      case 'Sale':               s.gross   += row.finalInvoiceAmount;         break;
      case 'Cancellation':       s.cancel  += Math.abs(row.finalInvoiceAmount); break;
      case 'Return':             s.returns += Math.abs(row.finalInvoiceAmount); break;
      case 'Return Cancellation': s.returns -= Math.abs(row.finalInvoiceAmount); break;
    }
  }

  for (const row of cashbackRows) {
    const state = row.deliveryState || 'UNKNOWN';
    ensure(state);
    const delta = row.documentType === 'Credit Note' ? row.invoiceAmount : -row.invoiceAmount;
    stateMap.get(state)!.gross += delta;
  }

  return Array.from(stateMap.entries())
    .map(([state, s]) => {
      const ret = Math.max(0, s.returns);
      const net = s.gross - s.cancel - ret;
      return { state, grossSales: s.gross, cancellations: s.cancel, returns: ret,
               netSales: net, expenseAllocation: 0, netEarnings: net };
    })
    .filter(r => r.grossSales !== 0 || r.cancellations !== 0 || r.returns !== 0)
    .sort((a, b) => b.netSales - a.netSales);
}

// ── 4C — FLIPKART SUMMRY SHEET ────────────────────────────────────────────

function computeSummarySheet(
  salesRows: SalesRow[],
  cashbackRows: CashbackRow[],
): FlipkartSummarySheet {
  let sGross = 0, sCancels = 0, sReturns = 0, sReturnCancel = 0, sShipping = 0;
  let cbCredit = 0, cbDebit = 0;

  const statesSales    = new Map<string, number>();
  const statesCashback = new Map<string, number>();
  const ensState       = (s: string) => {
    if (!statesSales.has(s))    statesSales.set(s, 0);
    if (!statesCashback.has(s)) statesCashback.set(s, 0);
  };

  for (const row of salesRows) {
    const state = row.deliveryState || 'UNKNOWN';
    ensState(state);
    switch (row.eventType) {
      case 'Sale':
        sGross        += row.finalInvoiceAmount;
        sShipping     += row.shippingCharges;
        statesSales.set(state, statesSales.get(state)! + row.finalInvoiceAmount);
        break;
      case 'Cancellation':
        sCancels      += Math.abs(row.finalInvoiceAmount);
        statesSales.set(state, statesSales.get(state)! - Math.abs(row.finalInvoiceAmount));
        break;
      case 'Return':
        sReturns      += Math.abs(row.finalInvoiceAmount);
        statesSales.set(state, statesSales.get(state)! - Math.abs(row.finalInvoiceAmount));
        break;
      case 'Return Cancellation':
        sReturnCancel += Math.abs(row.finalInvoiceAmount);
        statesSales.set(state, statesSales.get(state)! + Math.abs(row.finalInvoiceAmount));
        break;
    }
  }

  for (const row of cashbackRows) {
    const state = row.deliveryState || 'UNKNOWN';
    ensState(state);
    const delta = row.documentType === 'Credit Note' ? row.invoiceAmount : -row.invoiceAmount;
    if (delta >= 0) cbCredit += delta; else cbDebit += Math.abs(delta);
    statesCashback.set(state, statesCashback.get(state)! + delta);
  }

  const netSales = sGross - sCancels - sReturns + sReturnCancel + (cbCredit - cbDebit) + sShipping;

  const rows: FlipkartSummarySheetRow[] = [
    { basis: 'SALES', particulars: 'Gross Sales',         sales: sGross,        cashback: cbCredit,   total: sGross + cbCredit },
    { basis: 'SALES', particulars: 'Cancel Sales',        sales: -sCancels,     cashback: 0,          total: -sCancels },
    { basis: 'SALES', particulars: 'Sales Return',        sales: -sReturns,     cashback: 0,          total: -sReturns },
    { basis: 'SALES', particulars: 'Return Cancellation', sales: sReturnCancel, cashback: 0,          total: sReturnCancel },
    { basis: 'SALES', particulars: 'Shipping',            sales: sShipping,     cashback: 0,          total: sShipping },
    { basis: 'SALES', particulars: 'Debit Note (CB)',      sales: 0,            cashback: -cbDebit,   total: -cbDebit },
    { basis: 'SALES', particulars: 'Net Sale',            sales: sGross - sCancels - sReturns + sReturnCancel + sShipping,
                                                           cashback: cbCredit - cbDebit, total: netSales },
  ];

  const allStates = new Set([...statesSales.keys(), ...statesCashback.keys()]);
  const byState: FlipkartSummarySheet['byState'] = {};
  for (const state of allStates) {
    const sa = statesSales.get(state)    ?? 0;
    const ca = statesCashback.get(state) ?? 0;
    byState[state] = { sales: sa, cashback: ca, total: sa + ca };
  }

  return { rows, byState };
}

// ── 4D — FLIPKART EXP SHEET ───────────────────────────────────────────────

function computeExpSheet(salesRows: SalesRow[], wb: XLSX.WorkBook): FlipkartExpSheet {
  const stateFees = new Map<string, number>();

  for (const row of salesRows) {
    if (row.eventType !== 'Sale') continue;
    const fee = row.finalInvoiceAmount - row.sellerShare - row.shippingCharges;
    if (fee === 0) continue;
    const state = row.deliveryState || 'UNKNOWN';
    stateFees.set(state, (stateFees.get(state) ?? 0) + fee);
  }

  if (stateFees.size === 0) return readExpSheetFallback(wb);

  const sorted    = Array.from(stateFees.entries()).sort((a, b) => b[1] - a[1]);
  const topStates = sorted.slice(0, 9).map(([s]) => s);
  const states    = [...topStates, 'OTHER'];
  const otherTotal = sorted.slice(9).reduce((acc, [, v]) => acc + v, 0);

  const byState: Record<string, number> = {};
  for (const st of topStates) byState[st] = stateFees.get(st) ?? 0;
  byState['OTHER'] = otherTotal;

  return {
    states,
    fees: [{
      feeLabel: 'Platform Commission',
      byState,
      total: Array.from(stateFees.values()).reduce((a, v) => a + v, 0),
    }],
  };
}

function readExpSheetFallback(wb: XLSX.WorkBook): FlipkartExpSheet {
  if (!wb.Sheets['FLIPKART EXP SHEET']) return { states: [], fees: [] };

  const allRows = readSheet(wb, 'FLIPKART EXP SHEET', 0);
  if (allRows.length < 4) return { states: [], fees: [] };

  const headerRow  = (allRows[0] as any[]).map(h => String(h ?? '').trim());
  const statesCols = headerRow.slice(1).filter(h => h && !/^total$/i.test(h));
  const iTotalCol  = headerRow.findIndex(h => /^(total|grand total)$/i.test(h));
  const rowSum     = (row: any[]) =>
    iTotalCol !== -1 ? safeNum(row[iTotalCol])
      : (row as any[]).slice(1).reduce((acc: number, v: any) => acc + safeNum(v), 0);

  const fees: FlipkartExpFeeRow[] = [];
  for (const row of allRows.slice(3)) {
    const label = String(row[0] ?? '').trim();
    if (!label) continue;
    const byState: Record<string, number> = {};
    statesCols.forEach((st, idx) => { byState[st] = safeNum((row as any[])[idx + 1]); });
    fees.push({ feeLabel: label, byState, total: rowSum(row) });
  }

  return { states: statesCols, fees };
}

// ── 4E — Order counts ─────────────────────────────────────────────────────

function computeOrderCounts(salesRows: SalesRow[]): FlipkartOrderCounts {
  const saleIds         = new Set<string>();
  const cancelIds       = new Set<string>();
  const returnIds       = new Set<string>();
  const returnCancelIds = new Set<string>();
  let totalUnits = 0, cancelledUnits = 0, returnUnits = 0;

  for (const row of salesRows) {
    switch (row.eventType) {
      case 'Sale':               saleIds.add(row.orderId);         totalUnits     += row.qty; break;
      case 'Cancellation':       cancelIds.add(row.orderId);       cancelledUnits += row.qty; break;
      case 'Return':             returnIds.add(row.orderId);       returnUnits    += row.qty; break;
      case 'Return Cancellation': returnCancelIds.add(row.orderId); break;
    }
  }

  return {
    totalOrders:              saleIds.size,
    totalUnits,
    cancelledOrders:          cancelIds.size,
    cancelledUnits,
    returnOrders:             returnIds.size,
    returnUnits,
    returnCancellationOrders: returnCancelIds.size,
  };
}

// ── Main export ───────────────────────────────────────────────────────────

export function processFlipkart(wb: XLSX.WorkBook): FlipkartResult {
  const salesRows    = parseSalesRows(wb, 'Flipkart Sales Report Main');
  const cashbackRows = parseCashbackRows(wb, 'Flipkart Cash Back Report Main');
  const returnMap    = parseReturnSheet(wb);   // 4A

  // Core summary with 4B return classification
  let grossSales          = 0;
  let cancellations       = 0;
  let courierReturns      = 0;
  let customerReturns     = 0;
  let returnCancellations = 0;
  let shippingReceived    = 0;
  const discounts         = 0;

  for (const row of salesRows) {
    switch (row.eventType) {
      case 'Sale':
        grossSales       += row.finalInvoiceAmount;
        shippingReceived += Math.max(0, row.shippingCharges);
        break;
      case 'Cancellation':
        cancellations    += row.finalInvoiceAmount;
        break;
      case 'Return': {
        const absAmt = Math.abs(row.finalInvoiceAmount);
        // Order Item ID is more specific; fall back to Order ID, then default
        const kind   = returnMap.get(row.orderItemId) ?? returnMap.get(row.orderId) ?? 'Customer Return';
        if (kind === 'Courier Return') courierReturns  += absAmt;
        else                           customerReturns += absAmt;
        break;
      }
      case 'Return Cancellation':
        returnCancellations += row.finalInvoiceAmount;
        break;
    }
  }

  let cashback = 0;
  for (const row of cashbackRows) {
    cashback += row.documentType === 'Credit Note' ? row.invoiceAmount : -row.invoiceAmount;
  }

  const totalReturns = courierReturns + customerReturns;
  const netSales     = grossSales + cancellations - totalReturns + returnCancellations + cashback + shippingReceived;

  const summary: FlipkartSummary = {
    grossSales, cancellations, returns: totalReturns,
    returnCancellations, cashback, shippingReceived, discounts, netSales,
  };

  return {
    summary,
    fees:               extractFeesRecord(wb),
    statewise:          buildStatewise(salesRows, cashbackRows),
    orders:             computeOrderCounts(salesRows),           // 4E
    summarySheet:       computeSummarySheet(salesRows, cashbackRows), // 4C
    expSheet:           computeExpSheet(salesRows, wb),          // 4D
    returnClassification: { courier: courierReturns, customer: customerReturns },
  };
}

// ── Fee record extraction (backward compat) ───────────────────────────────

function extractFeesRecord(wb: XLSX.WorkBook): Record<string, number> {
  const fees: Record<string, number> = {};
  if (!wb.Sheets['FLIPKART EXP SHEET']) return fees;

  const allRows = readSheet(wb, 'FLIPKART EXP SHEET', 0);
  if (allRows.length < 4) return fees;

  const headers   = (allRows[0] as any[]).map(h => String(h ?? '').trim().toLowerCase());
  const iTotalCol = headers.findIndex(h => h === 'total' || h === 'grand total');
  const rowSum    = (row: any[]) =>
    iTotalCol !== -1 ? safeNum(row[iTotalCol])
      : (row as any[]).slice(1).reduce((acc: number, v: any) => acc + safeNum(v), 0);

  for (const row of allRows.slice(3)) {
    const label = String(row[0] ?? '').trim();
    if (!label) continue;
    const total = rowSum(row);
    if (total !== 0) fees[label] = (fees[label] ?? 0) + total;
  }
  return fees;
}

// ── Backward-compatible thin wrappers ─────────────────────────────────────

export function getFlipkartFees(wb: XLSX.WorkBook): Record<string, number> {
  return processFlipkart(wb).fees;
}

export function getFlipkartStatewise(wb: XLSX.WorkBook): StatewisePL[] {
  return processFlipkart(wb).statewise;
}
