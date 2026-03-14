import * as XLSX from 'xlsx';
import type { Channel, ChannelMap, ExpenseRow } from '../types';
import { CHANNELS } from '../constants';
import { readSheet, safeNum } from '../utils/parser';

// ── Helpers ───────────────────────────────────────────────────────────────

export function buildEmptyChannelMap(): ChannelMap<number> {
  return Object.fromEntries(CHANNELS.map(c => [c, 0])) as ChannelMap<number>;
}

// Column index → Channel (0-based columns of EXP SHEET)
// Col 0=S.NO  1=PARTICULARS  2=TOTAL EXP BOOKS  3=DATA SOURCE  4=BASIS
// Col 5=AMAZON  6=FLIPKART  7=MYNTRA  8=IAV_IN  9=BULK_DOMESTIC  10=IAV_COM  11=BULK_EXPORT
const COL_TO_CHANNEL: Record<number, Channel> = {
  5:  'AMAZON',
  6:  'FLIPKART',
  7:  'MYNTRA',
  8:  'IAV_IN',
  9:  'BULK_DOMESTIC',
  10: 'IAV_COM',
  11: 'BULK_EXPORT',
};

const CHANNEL_COLS = Object.keys(COL_TO_CHANNEL).map(Number);

// ── Raw-cell error detector ────────────────────────────────────────────────

/**
 * Return true when the SheetJS cell at (row0, col0) is a formula error
 * (#VALUE!, #REF!, #DIV/0!, etc.).  These appear as `t === 'e'` in the raw
 * worksheet and are NOT the same as a blank cell (null) or a genuine zero.
 */
function isErrorCell(ws: XLSX.WorkSheet, row0: number, col0: number): boolean {
  const cell = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })];
  return cell != null && cell.t === 'e';
}

// ── Core allocation functions ─────────────────────────────────────────────

function allocateSalesRatio(totalBooks: number, netSales: ChannelMap<number>): ChannelMap<number> {
  const out   = buildEmptyChannelMap();
  const total = CHANNELS.reduce((s, ch) => s + (netSales[ch] ?? 0), 0);
  if (total === 0 || totalBooks === 0) return out;
  for (const ch of CHANNELS) {
    out[ch] = totalBooks * ((netSales[ch] ?? 0) / total);
  }
  return out;
}

function allocate7030(totalBooks: number): ChannelMap<number> {
  const out = buildEmptyChannelMap();
  if (totalBooks === 0) return out;
  out['AMAZON'] = totalBooks * 0.7;
  out['IAV_IN'] = totalBooks * 0.3;
  return out;
}

function allocateOnlyIavIn(totalBooks: number): ChannelMap<number> {
  const out = buildEmptyChannelMap();
  out['IAV_IN'] = totalBooks;
  return out;
}

/**
 * 7E: DIRECT allocation with #VALUE! fallback.
 *
 * Reads each channel column.  If the cell is a formula error, the channel is
 * marked as "unknown".  After summing valid columns, any remaining amount
 * (totalBooks − validSum) is distributed evenly across the error channels.
 */
function allocateDirectFallback(
  row: any[],
  ws: XLSX.WorkSheet,
  absRow0: number,
  totalBooks: number,
): ChannelMap<number> {
  const out = buildEmptyChannelMap();
  let validSum = 0;
  const errorChs: Channel[] = [];

  for (const col of CHANNEL_COLS) {
    const ch = COL_TO_CHANNEL[col];
    if (isErrorCell(ws, absRow0, col)) {
      errorChs.push(ch);
    } else {
      const v = safeNum(row[col]);
      out[ch] = v;
      validSum += v;
    }
  }

  if (errorChs.length > 0 && totalBooks > validSum) {
    const share = (totalBooks - validSum) / errorChs.length;
    for (const ch of errorChs) out[ch] = share;
  }

  return out;
}

/**
 * 7D: B2B FOR BULK & B2C WEBSITE allocation with #VALUE! fallback.
 *
 * Preferred: pre-filled values in col 8 (IAV_IN) and col 9 (BULK_DOMESTIC).
 * When those are formula errors the amount is split proportionally (by net
 * sales) between the relevant channel pair:
 *   - "Export" in the name → IAV_COM + BULK_EXPORT
 *   - Otherwise            → IAV_IN  + BULK_DOMESTIC
 */
function allocateB2bB2cFallback(
  row: any[],
  ws: XLSX.WorkSheet,
  absRow0: number,
  particulars: string,
  totalBooks: number,
  netSales: ChannelMap<number>,
): ChannelMap<number> {
  const out = buildEmptyChannelMap();

  const col8Err = isErrorCell(ws, absRow0, 8);
  const col9Err = isErrorCell(ws, absRow0, 9);

  const iavInVal  = col8Err ? 0 : safeNum(row[8]);
  const bulkDomVal = col9Err ? 0 : safeNum(row[9]);

  if (iavInVal  > 0) out['IAV_IN']        = iavInVal;
  if (bulkDomVal > 0) out['BULK_DOMESTIC'] = bulkDomVal;

  // Apply fallback when the pre-filled columns resolved to zero / error
  if (totalBooks > 0 && out['IAV_IN'] === 0 && out['BULK_DOMESTIC'] === 0) {
    const nameUp = particulars.toUpperCase();
    if (nameUp.includes('EXPORT')) {
      const a = netSales['IAV_COM']      ?? 0;
      const b = netSales['BULK_EXPORT']  ?? 0;
      const t = a + b;
      out['IAV_COM']     = t > 0 ? totalBooks * (a / t) : totalBooks * 0.5;
      out['BULK_EXPORT'] = t > 0 ? totalBooks * (b / t) : totalBooks * 0.5;
    } else {
      const a = netSales['IAV_IN']       ?? 0;
      const b = netSales['BULK_DOMESTIC']?? 0;
      const t = a + b;
      out['IAV_IN']        = t > 0 ? totalBooks * (a / t) : totalBooks * 0.5;
      out['BULK_DOMESTIC'] = t > 0 ? totalBooks * (b / t) : totalBooks * 0.5;
    }
  }

  return out;
}

// ── Sub-table total scanner (7A / 7B / 7C) ────────────────────────────────

/**
 * Scan all rows of the raw EXP SHEET for the supplementary sub-tables that
 * hold the detailed breakdown of three compound expense lines:
 *   employee_benefit  → TOTAL row in the Employee Benefit Exp sub-table
 *   professional      → AVG MONTHLY EXP row in the Professional Charges sub-table
 *   subscription      → TOTAL row in the Subscription Exp (OTHERS) sub-table
 *
 * Values are read from col 2 first, then col 3 as fallback.
 */
function scanSubTableTotals(allRaw: any[][]): Record<string, number> {
  const result: Record<string, number> = {};
  let mode: string | null = null;

  for (const rawRow of allRaw) {
    const row = rawRow as any[];
    const c0 = String(row[0] ?? '').trim().toUpperCase();
    const c1 = String(row[1] ?? '').trim().toUpperCase();
    const label = c1 || c0;

    // Detect section headers
    if (label.includes('EMPLOYEE BENEFIT'))                                { mode = 'employee_benefit'; continue; }
    if (label.includes('PROFESSIONAL CHARGES') || label.includes('AUDIT AND PROFESSIONAL')) { mode = 'professional'; continue; }
    if ((c0.includes('SUBSCRIPTION') || c1.includes('SUBSCRIPTION')) && mode !== 'subscription') { mode = 'subscription'; continue; }

    if (!mode) continue;

    const val = safeNum(row[2]) || safeNum(row[3]);

    if (mode === 'employee_benefit' && (label === 'TOTAL' || label.startsWith('TOTAL'))) {
      if (val > 0) { result['employee_benefit'] = val; mode = null; }
    } else if (mode === 'professional' && label.includes('AVG MONTHLY')) {
      if (val > 0) { result['professional'] = val; mode = null; }
    } else if (mode === 'subscription' && (label === 'TOTAL' || label.startsWith('TOTAL'))) {
      if (val > 0) { result['subscription'] = val; mode = null; }
    }
  }

  return result;
}

/**
 * Return the sub-table fallback amount for a named expense row (7A / 7B / 7C).
 * Returns 0 when no match is found.
 */
function resolveExpenseTotal(
  particulars: string,
  subTotals: Record<string, number>,
): number {
  const up = particulars.toUpperCase();
  if (up.includes('EMPLOYEE BENEFIT'))                     return subTotals['employee_benefit'] ?? 0;
  if (up.includes('AUDIT') || up.includes('PROFESSIONAL')) return subTotals['professional']     ?? 0;
  if (up.includes('SUBSCRIPTION'))                         return subTotals['subscription']      ?? 0;
  return 0;
}

// ── 7F: Interest expense resolver ─────────────────────────────────────────

/**
 * Attempt to read "Interest on Bank & Other Loans" from the workbook.
 *
 * Priority:
 *  1. EXP SHEET  — scan for a row with "Interest" in PARTICULARS (col 1)
 *  2. SALES BUSY — scan for ledger entries with "Interest" in Revised Account
 *     on the debit side (expense payments)
 *  3. PURCHASE LEDGER — same keyword scan on debit side
 *  4. IAV P&L sheet   — scan every row label for "Interest"
 *  5. Fallback: 0
 */
export function resolveInterestExpense(wb: XLSX.WorkBook): number {
  // 1 — EXP SHEET
  if (wb.Sheets['EXP SHEET']) {
    const allRaw = XLSX.utils.sheet_to_json<any[]>(
      wb.Sheets['EXP SHEET'], { header: 1, defval: null, raw: true }) as any[][];
    for (const rawRow of allRaw) {
      const row = rawRow as any[];
      const p = String(row[1] ?? '').trim().toUpperCase();
      if (p.includes('INTEREST')) {
        const v = isErrorCell(wb.Sheets['EXP SHEET'], allRaw.indexOf(rawRow), 2)
          ? 0
          : safeNum(row[2]);
        if (v > 0) return v;
      }
    }
  }

  // Helper: scan a BUSY-format sheet for debit entries with "Interest" in account
  const scanBusyForInterest = (sheetName: string): number => {
    if (!wb.Sheets[sheetName]) return 0;
    const rows = readSheet(wb, sheetName, 0);
    if (rows.length < 3) return 0;
    const headers = (rows[2] as any[]).map(h => String(h ?? '').trim().toLowerCase());
    const iAccount = headers.findIndex(h => h.includes('account') || h.includes('ledger'));
    const iDebit   = headers.findIndex(h => h.includes('debit'));
    if (iAccount === -1 || iDebit === -1) return 0;
    let sum = 0;
    for (const rawRow of rows.slice(3)) {
      const row = rawRow as any[];
      const acct = String(row[iAccount] ?? '').toUpperCase();
      if (acct.includes('INTEREST')) sum += safeNum(row[iDebit]);
    }
    return sum;
  };

  // 2 — SALES BUSY
  const fromSales = scanBusyForInterest('SALES BUSY');
  if (fromSales > 0) return fromSales;

  // 3 — PURCHASE LEDGER
  const fromPurchase = scanBusyForInterest('PURCHASE LEDGER');
  if (fromPurchase > 0) return fromPurchase;

  // 4 — IAV P&L
  const plSheet = wb.SheetNames.find(
    n => n.toLowerCase().includes('iav p&l') || n.toLowerCase().includes('iav pl'),
  );
  if (plSheet) {
    const rows = readSheet(wb, plSheet, 0);
    for (const rawRow of rows) {
      const row = rawRow as any[];
      const label = String(row[0] ?? '').trim().toUpperCase();
      if (label.includes('INTEREST')) {
        const v = safeNum(row[1]) || safeNum(row[2]) || safeNum(row[3]);
        if (v > 0) return v;
      }
    }
  }

  return 0;
}

// ── Interface ─────────────────────────────────────────────────────────────

export interface AllocatorInput {
  netSales: ChannelMap<number>;
  wb: XLSX.WorkBook;
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Read EXP SHEET and allocate each expense row across channels.
 *
 * Sheet layout (0-based row index in raw sheet):
 *   r=0: title row (ignored)
 *   r=1: column headers
 *   r=2: NET SALES summary row (skipped — not an expense)
 *   r=3+: expense rows
 *
 * Column layout (0-based):
 *   0=S.NO  1=PARTICULARS  2=TOTAL EXP BOOKS  3=DATA SOURCE  4=ALLOC BASIS
 *   5=AMAZON  6=FLIPKART  7=MYNTRA  8=IAV_IN  9=BULK_DOMESTIC
 *   10=IAV_COM  11=BULK_EXPORT
 *
 * 7A: Employee Benefit Exp totalBooks resolved from sub-table TOTAL row
 * 7B: Professional Charges monthly avg resolved from sub-table AVG MONTHLY EXP row
 * 7C: Subscription Exp (OTHERS) resolved from sub-table TOTAL row
 * 7D: B2B/B2C allocation falls back to proportional split when cols 8/9 are errors
 * 7E: DIRECT rows distribute remainder to #VALUE! channel columns
 */
export function allocateExpenses(input: AllocatorInput): ExpenseRow[] {
  const { netSales, wb } = input;

  if (!wb.Sheets['EXP SHEET']) return [];

  const ws     = wb.Sheets['EXP SHEET'];
  const allRaw = XLSX.utils.sheet_to_json<any[]>(
    ws, { header: 1, defval: null, raw: true }) as any[][];
  if (allRaw.length < 3) return [];

  // Pre-scan sub-tables for 7A / 7B / 7C fallback totals
  const subTotals = scanSubTableTotals(allRaw);

  const result: ExpenseRow[] = [];

  // Expense rows start at r=3 (workbook row 4)
  for (let absRow = 3; absRow < allRaw.length; absRow++) {
    const row = allRaw[absRow] as any[];
    if (!row || !row.some(c => c !== null && c !== '')) continue;

    try {
      const snoRaw     = row[0];
      const sno        = snoRaw != null ? (safeNum(snoRaw) || null) : null;
      const particulars = String(row[1] ?? '').trim();
      if (!particulars) continue;

      const basisRaw = String(row[4] ?? '').trim();

      // Skip sub-table detail rows: they have no S.NO AND no allocation basis
      if (sno === null && basisRaw === '') continue;

      // totalBooks: try direct read; fall back to sub-table scan for known compound rows
      let totalBooks = isErrorCell(ws, absRow, 2) ? 0 : safeNum(row[2]);
      if (totalBooks === 0) {
        const fallback = resolveExpenseTotal(particulars, subTotals);
        if (fallback > 0) totalBooks = fallback;
      }

      const dataSource = String(row[3] ?? '').trim();

      // Normalise allocation basis
      type AllocationBasis = ExpenseRow['allocationBasis'];
      let basis: AllocationBasis = 'DIRECT';
      const basisUp = basisRaw.toUpperCase();
      if      (basisUp.includes('SALES RATIO'))                               basis = 'SALES RATIO';
      else if (basisUp.includes('70') && basisUp.includes('30'))              basis = '70%-30%';
      else if (basisUp.includes('ONLY') && basisUp.includes('INDIAN'))        basis = 'ONLY INDIANARTVILLA.IN';
      else if (basisUp.includes('B2B') && basisUp.includes('B2C'))            basis = 'B2B FOR BULK & B2C WEBSITE';

      let allocated: ChannelMap<number>;
      switch (basis) {
        case 'SALES RATIO':
          allocated = allocateSalesRatio(totalBooks, netSales);
          break;
        case '70%-30%':
          allocated = allocate7030(totalBooks);
          break;
        case 'ONLY INDIANARTVILLA.IN':
          allocated = allocateOnlyIavIn(totalBooks);
          break;
        case 'B2B FOR BULK & B2C WEBSITE':
          allocated = allocateB2bB2cFallback(row, ws, absRow, particulars, totalBooks, netSales);
          break;
        case 'DIRECT':
        default:
          allocated = allocateDirectFallback(row, ws, absRow, totalBooks);
          break;
      }

      result.push({ sno, particulars, totalBooks, dataSource, allocationBasis: basis, allocated });
    } catch {
      // Skip malformed rows silently
    }
  }

  return result;
}
