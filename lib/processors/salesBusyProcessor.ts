import * as XLSX from 'xlsx';
import type { Channel, ChannelMap, SalesBusyResult, SalesBusyOrderCounts, PurchaseSplit, StockValues } from '../types';
import { CHANNELS, BUSY_ACCOUNT_TO_CHANNEL } from '../constants';
import { readSheet, parseDate, safeNum } from '../utils/parser';

// -- Helpers ---------------------------------------------------------------

function hIdx(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex(h => h.trim().toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

function makeChannelMap<T>(init: (ch: Channel) => T): ChannelMap<T> {
  return Object.fromEntries(CHANNELS.map(ch => [ch, init(ch)])) as ChannelMap<T>;
}

// -- Row structure helper --------------------------------------------------
// Row 0 = display headers, Row 1 = TRUE filter artifacts, Row 2 = real headers, Row 3+ = data

function readBusySheet(wb: XLSX.WorkBook, sheetName: string): { headers: string[]; rows: any[][] } {
  let all: any[][];
  try {
    all = readSheet(wb, sheetName, 0); // uses fuzzy matching (14B)
  } catch {
    return { headers: [], rows: [] }; // sheet not found
  }
  if (all.length < 3) return { headers: [], rows: [] };

  const headers = (all[2] as any[]).map(h => String(h ?? '').trim());
  const rows = all.slice(3).filter(row =>
    (row as any[]).some(c => c !== null && c !== '' && c !== true && c !== false),
  );
  return { headers, rows };
}

// -- "+" computation string evaluator (6B) --------------------------------

function sumPlusString(raw: any): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  if (s.includes('+')) {
    return s.split('+').reduce((acc, part) => acc + safeNum(part.trim()), 0);
  }
  return safeNum(raw);
}

// -- SALES BUSY row structure (6A: adds vchNo + type) ---------------------

interface BusyRow {
  date: Date | null;
  revisedAccount: string;
  /** Vch/Bill No   used for distinct order counting */
  vchNo: string;
  /** Voucher type label e.g. "Sale", "Credit Note" */
  type: string;
  netAmount: number;
  debit: number;
  credit: number;
}

function parseSalesBusyRows(wb: XLSX.WorkBook): BusyRow[] {
  const { headers, rows } = readBusySheet(wb, 'SALES BUSY');
  if (!headers.length) return [];

  const iDate    = hIdx(headers, 'Date');
  const iAccount = hIdx(headers, 'Revised Account', 'Revised Ledger', 'Account');
  const iVchNo   = hIdx(headers, 'Vch/Bill No', 'Vch No.', 'Vch No', 'Voucher No', 'Bill No', 'Voucher Number');
  const iType    = hIdx(headers, 'Type', 'Voucher Type', 'Transaction Type');
  const iNet     = hIdx(headers, 'Net Amount', 'Net');
  const iDebit   = hIdx(headers, 'Debit(Rs.)', 'Debit (Rs.)', 'Debit', 'Dr', 'Dr(Rs.)');
  const iCredit  = hIdx(headers, 'Credit(Rs.)', 'Credit (Rs.)', 'Credit', 'Cr', 'Cr(Rs.)');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    date:           parseDate(g(row, iDate)),
    revisedAccount: String(g(row, iAccount) ?? '').trim(),
    vchNo:          String(g(row, iVchNo)   ?? '').trim(),
    type:           String(g(row, iType)    ?? '').trim(),
    netAmount:      safeNum(g(row, iNet)),
    debit:          safeNum(g(row, iDebit)),
    credit:         safeNum(g(row, iCredit)),
  }));
}

// -- PURCHASE LEDGER row structure (6D: adds account) ---------------------

interface PurchaseRow {
  revisedLedger: string;
  /** Separate account/ledger name for keyword matching */
  account: string;
  type: string;
  debit: number;
}

function parsePurchaseRows(wb: XLSX.WorkBook): PurchaseRow[] {
  const { headers, rows } = readBusySheet(wb, 'PURCHASE LEDGER');
  if (!headers.length) return [];

  const iLedger  = hIdx(headers, 'Revised Ledger', 'Revised Account', 'Ledger', 'Account');
  const iAccount = hIdx(headers, 'Account', 'Ledger Name', 'Account Name', 'Party Name', 'Particular');
  const iType    = hIdx(headers, 'Type', 'Voucher Type', 'Transaction Type');
  const iDebit   = hIdx(headers, 'Debit(Rs.)', 'Debit (Rs.)', 'Debit', 'Dr', 'Dr(Rs.)');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    revisedLedger: String(g(row, iLedger)  ?? '').trim(),
    account:       String(g(row, iAccount) ?? '').trim(),
    type:          String(g(row, iType)    ?? '').trim(),
    debit:         safeNum(g(row, iDebit)),
  }));
}

// -- Sheet1 pivot cross-check ----------------------------------------------

function readPivotTotals(wb: XLSX.WorkBook): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!wb.Sheets['Sheet1']) return totals;

  const rows = readSheet(wb, 'Sheet1', 0);
  if (rows.length < 3) return totals;

  const headers = (rows[0] as any[]).map(h => String(h ?? '').trim().toLowerCase());
  const iLabel  = headers.findIndex(h => h.includes('row labels') || h.includes('label'));
  const iSum    = headers.findIndex(h => h.includes('sum of net') || h.includes('net amount'));

  for (const row of rows.slice(2)) {
    const label  = String(iLabel !== -1 ? row[iLabel] : row[0] ?? '').trim();
    const amount = safeNum(iSum  !== -1 ? row[iSum]   : row[1]);
    if (label && label.toLowerCase() !== 'grand total') {
      totals[label] = (totals[label] ?? 0) + amount;
    }
  }
  return totals;
}

// -- STOCK VALUE sheet parser (6B) -----------------------------------------

/**
 * Read stock value from a row using the 6B priority:
 *  1. col 3 (index 2) as number
 *  2. col 4 (index 3) as number
 *  3. col 6 (index 5) as "+" computation string
 */
function extractStockVal(row: any[]): number {
  const v2 = safeNum(row[2]);
  if (v2 !== 0) return v2;
  const v3 = safeNum(row[3]);
  if (v3 !== 0) return v3;
  return sumPlusString(row[5]);
}

/**
 * Parse STOCK VALUE sheet for opening and closing stock of Traded Goods and Packing Material.
 *
 * Row identification by keyword in col 0/1.
 * Per cell: try col 3/4 as direct number (6B), fallback col 6 for "+" computation string.
 * Ultimate fallback: IAV P&L sheet rows 28-37.
 */
function readStockValueSheet(wb: XLSX.WorkBook): StockValues {
  const zero: StockValues = {
    opening: { traded: 0, packing: 0 },
    closing: { traded: 0, packing: 0 },
  };

  if (wb.Sheets['STOCK VALUE']) {
    const { headers, rows } = readBusySheet(wb, 'STOCK VALUE');
    if (rows.length > 0) {
      // Prefer column-header-based lookup when Opening/Closing headers are present
      const iOp = hIdx(headers, 'Opening', 'Opening Stock', 'Opening Value', 'Op. Stock', 'Op Stock', 'Op.Stock');
      const iCl = hIdx(headers, 'Closing', 'Closing Stock', 'Closing Value', 'Cl. Stock', 'Cl Stock', 'Cl.Stock');

      const labelOf = (row: any[]) =>
        `${String(row[0] ?? '')} ${String(row[1] ?? '')}`.toLowerCase();

      const getFromRow = (row: any[], colIdx: number): number => {
        if (colIdx !== -1) {
          // Prefer explicit column; still apply "+" fallback on the raw cell value
          return sumPlusString(row[colIdx]) || safeNum(row[colIdx]);
        }
        return extractStockVal(row);
      };

      if (iOp !== -1 && iCl !== -1) {
        // Layout: one row per material type, columns distinguish opening vs closing
        for (const row of rows) {
          const lbl = labelOf(row);
          const op  = getFromRow(row, iOp);
          const cl  = getFromRow(row, iCl);
          if (lbl.includes('traded')) {
            zero.opening.traded = op;
            zero.closing.traded = cl;
          } else if (lbl.includes('packing')) {
            zero.opening.packing = op;
            zero.closing.packing = cl;
          }
        }
      } else {
        // Layout: one row per (material type   opening/closing)
        for (const row of rows) {
          const lbl = labelOf(row);
          const val = extractStockVal(row);
          if (lbl.includes('traded')) {
            if (lbl.includes('opening') || lbl.includes('op')) zero.opening.traded += val;
            else if (lbl.includes('closing') || lbl.includes('cl')) zero.closing.traded += val;
          } else if (lbl.includes('packing')) {
            if (lbl.includes('opening') || lbl.includes('op')) zero.opening.packing += val;
            else if (lbl.includes('closing') || lbl.includes('cl')) zero.closing.packing += val;
          }
        }
      }

      // If we found any non-zero values, return early
      const found =
        zero.opening.traded || zero.opening.packing ||
        zero.closing.traded || zero.closing.packing;
      if (found) return zero;
    }
  }

  // Fallback: IAV P&L sheet rows 28-37 (1-based ? indices 27-36)
  const plSheetName = wb.SheetNames.find(
    n => n.toLowerCase().includes('iav p&l') || n.toLowerCase().includes('iav pl'),
  );
  if (plSheetName) {
    const allRows = readSheet(wb, plSheetName, 0);
    for (let i = 27; i <= Math.min(36, allRows.length - 1); i++) {
      const row   = allRows[i] as any[];
      const label = String(row[0] ?? '').trim().toLowerCase();
      const val   = safeNum(row[1]) || safeNum(row[2]) || safeNum(row[3]);
      if (label.includes('opening') && label.includes('stock')) {
        zero.opening.traded = val;
      } else if (label.includes('closing') && label.includes('stock')) {
        zero.closing.traded = val;
      }
    }
  }

  return zero;
}

// -- 6A: order counts -----------------------------------------------------

/**
 * Count distinct Vch/Bill No per channel for "Sale" and "Credit Note" voucher types.
 */
function computeOrderCounts(rows: BusyRow[]): ChannelMap<SalesBusyOrderCounts> {
  const saleVchs   = makeChannelMap<Set<string>>(() => new Set());
  const returnVchs = makeChannelMap<Set<string>>(() => new Set());

  for (const row of rows) {
    if (row.revisedAccount.toUpperCase() === 'INTERBRANCH TRANSFER') continue;

    const channel = BUSY_ACCOUNT_TO_CHANNEL[row.revisedAccount]
                 ?? BUSY_ACCOUNT_TO_CHANNEL[row.revisedAccount.trim()];
    if (!channel) continue;

    const t = row.type.toUpperCase();
    const isSale   = t.includes('SALE') && !t.includes('CREDIT');
    const isReturn = t.includes('CREDIT NOTE') || t === 'CR' || t === 'CREDIT';

    if (row.vchNo) {
      if (isSale)   saleVchs[channel].add(row.vchNo);
      if (isReturn) returnVchs[channel].add(row.vchNo);
    }
  }

  return makeChannelMap(ch => ({
    saleOrders:   saleVchs[ch].size,
    returnOrders: returnVchs[ch].size,
  }));
}

// -- 6D: purchase split ----------------------------------------------------

/**
 * Split PURCHASE LEDGER rows into accounting buckets:
 *  - stockTransfer: TYPE contains "STOCK TRANSFER"   excluded from total
 *  - packingMaterial: account / ledger contains "Packing"
 *  - freightInward: account / ledger contains "Freight"
 *  - traded: all remaining PURC / PURCHASES rows
 */
export function computePurchaseSplit(wb: XLSX.WorkBook): PurchaseSplit {
  const rows   = parsePurchaseRows(wb);
  const result: PurchaseSplit = {
    traded: 0, packingMaterial: 0, stockTransfer: 0, freightInward: 0, total: 0,
  };

  for (const row of rows) {
    const typeUp    = row.type.toUpperCase();
    const ledgerUp  = row.revisedLedger.toUpperCase();
    const accountUp = row.account.toUpperCase();

    // A   stock transfers: exclude entirely
    if (typeUp.includes('STOCK TRANSFER') || ledgerUp === 'STOCK TRANSFER') {
      result.stockTransfer += row.debit;
      continue;
    }

    // B   packing material by keyword
    if (accountUp.includes('PACKING') || ledgerUp.includes('PACKING')) {
      result.packingMaterial += row.debit;
      continue;
    }

    // C   freight inward by keyword
    if (accountUp.includes('FREIGHT') || ledgerUp.includes('FREIGHT')) {
      result.freightInward += row.debit;
      continue;
    }

    // D   traded goods (PURC / PURCHASES vouchers)
    if (typeUp === 'PURC' || typeUp === 'PURCHASES' || typeUp.includes('PURCH')) {
      result.traded += row.debit;
    }
  }

  result.total = result.traded + result.packingMaterial + result.freightInward;
  return result;
}

// -- Default result --------------------------------------------------------

export const DEFAULT_SALES_BUSY_RESULT: SalesBusyResult = {
  byChannel: Object.fromEntries(
    CHANNELS.map(ch => [ch, { sales: 0, returns: 0, net: 0 }]),
  ) as ChannelMap<{ sales: number; returns: number; net: number }>,
  orders: Object.fromEntries(
    CHANNELS.map(ch => [ch, { saleOrders: 0, returnOrders: 0 }]),
  ) as ChannelMap<SalesBusyOrderCounts>,
  purchases: { traded: 0, packingMaterial: 0, stockTransfer: 0, freightInward: 0, total: 0 },
  stock: { opening: { traded: 0, packing: 0 }, closing: { traded: 0, packing: 0 } },
};

// -- Main export -----------------------------------------------------------

/**
 * Process SALES BUSY sheet into a full SalesBusyResult.
 *
 * - 6A: Distinct Vch/Bill No order counts per channel (Sale vs Credit Note)
 * - 6B: STOCK VALUE sheet with smart column / computation-string detection
 * - 6C: If periodOpeningStock is provided (carry-forward), opening stock bypasses the sheet read
 * - 6D: PURCHASE LEDGER split into traded / packing / freight / stock-transfer buckets
 *
 * @param periodOpeningStock - Previous month's closing stock (carry-forward).  When supplied,
 *   this overrides the opening stock read from the STOCK VALUE sheet.
 */
export function processSalesBusy(
  wb: XLSX.WorkBook,
  periodOpeningStock?: { tradedGoods: number; packingMaterial: number },
): SalesBusyResult {
  // -- Channel sales / returns -------------------------------------------
  const byChannel = makeChannelMap(() => ({ sales: 0, returns: 0, net: 0 }));
  const busyRows  = parseSalesBusyRows(wb);

  for (const row of busyRows) {
    if (row.revisedAccount.toUpperCase() === 'INTERBRANCH TRANSFER') continue;

    const channel = BUSY_ACCOUNT_TO_CHANNEL[row.revisedAccount]
                 ?? BUSY_ACCOUNT_TO_CHANNEL[row.revisedAccount.trim()];
    if (!channel) continue;

    if (row.credit > 0 && row.debit === 0) {
      byChannel[channel].sales += row.credit;
    } else if (row.debit > 0 && row.credit === 0) {
      byChannel[channel].returns += row.debit;
    }
  }
  for (const ch of CHANNELS) {
    byChannel[ch].net = byChannel[ch].sales - byChannel[ch].returns;
  }

  // -- 6A: order counts -------------------------------------------------
  const orders = computeOrderCounts(busyRows);

  // -- 6D: purchase split ------------------------------------------------
  const purchases = computePurchaseSplit(wb);

  // -- 6B + 6C: stock values ---------------------------------------------
  const stockFromSheet = readStockValueSheet(wb);
  const stock: StockValues = {
    opening: periodOpeningStock
      ? { traded: periodOpeningStock.tradedGoods, packing: periodOpeningStock.packingMaterial }
      : stockFromSheet.opening,
    closing: stockFromSheet.closing,
  };

  // Pivot cross-check available for debugging
  void readPivotTotals(wb);

  return { byChannel, orders, purchases, stock };
}

/**
 * @deprecated Use `processSalesBusy(wb).purchases.total` instead.
 * Kept for backward compatibility with any callers outside plBuilder.
 */
export function processPurchases(wb: XLSX.WorkBook): number {
  return computePurchaseSplit(wb).total;
}
