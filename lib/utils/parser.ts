import * as XLSX from 'xlsx';

// ── Sheet lookup (14B: fuzzy matching) ───────────────────────────────────

/**
 * Finds a worksheet using progressive fuzzy matching:
 * 1. Exact match on `name`
 * 2. Exact match on any `aliases`
 * 3. Case-insensitive trimmed match on `name` or any alias
 *
 * Returns `undefined` if no match is found.
 */
export function findSheet(wb: XLSX.WorkBook, name: string, aliases?: string[]): XLSX.WorkSheet | undefined {
  // 1. Exact match
  if (wb.Sheets[name]) return wb.Sheets[name];
  // 2. Alias exact matches
  if (aliases) {
    for (const a of aliases) {
      if (wb.Sheets[a]) return wb.Sheets[a];
    }
  }
  // 3. Case-insensitive trimmed match across all sheet names
  const targets = [name, ...(aliases ?? [])].map(n => n.trim().toLowerCase());
  for (const sn of wb.SheetNames) {
    if (targets.includes(sn.trim().toLowerCase())) return wb.Sheets[sn];
  }
  return undefined;
}

// Reads a workbook sheet to an array of row arrays (raw values).
// skipRows: how many leading rows to skip before headers.
// aliases: optional alternate sheet names tried via fuzzy match.
export function readSheet(wb: XLSX.WorkBook, sheetName: string, skipRows = 0, aliases?: string[]): any[][] {
  const ws = findSheet(wb, sheetName, aliases);
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  return raw.slice(skipRows).filter(row => row.some(cell => cell !== null));
}

// For TRIPLE_HEADER_SHEETS: headers at row 0, data starts at row 3
// (Row1=headers, Row2=TRUE filter row, Row3=headers again, Row4+=data)
export function readTripleHeaderSheet(wb: XLSX.WorkBook, sheetName: string): {
  headers: string[];
  rows: any[][];
} {
  const all = readSheet(wb, sheetName, 0);
  const headers = (all[0] as any[]).map(h => String(h ?? '').trim());
  const rows = all.slice(3).filter(row => row.some(c => c !== null && c !== '' && c !== true && c !== false));
  return { headers, rows };
}

// ── Header layout detection (14C) ────────────────────────────────────────

/**
 * Examines the first few rows of a worksheet to auto-detect header layout.
 *
 * Detected layouts:
 * - Triple-header: row0=display names, row1=TRUE/FALSE filter, row2=real headers, row3+=data
 * - Single-header (default): row0=headers, row1+=data
 *
 * @returns headerRow   — 0-based index of the row containing real column headers
 *          dataStartRow — 0-based index of the first data row
 */
export function detectHeaderRow(ws: XLSX.WorkSheet): { headerRow: number; dataStartRow: number } {
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

  for (let i = 0; i <= Math.min(4, raw.length - 1); i++) {
    const row = raw[i] as any[];
    const nonNull = row.filter(c => c !== null && c !== undefined && c !== '');
    if (
      nonNull.length >= 2 &&
      nonNull.every(
        c => c === true || c === false ||
             String(c).toUpperCase() === 'TRUE' || String(c).toUpperCase() === 'FALSE',
      )
    ) {
      // Row i is the TRUE/FALSE filter row → real headers at i+1, data starts at i+2
      return { headerRow: i + 1, dataStartRow: i + 2 };
    }
  }

  return { headerRow: 0, dataStartRow: 1 };
}

// Parses Excel serial date or JS Date or string → Date | null
export function parseDate(val: any): Date | null {
  if (!val || val === 0 || val === '0') return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number' && val > 1000) {
    // Excel serial date
    return (XLSX.SSF as any).parse_date_code ? new Date((val - 25569) * 86400 * 1000) : null;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Robustly converts any cell value to a number, returning 0 for anything
 * that cannot be safely interpreted as a finite number. (14A)
 *
 * Handles:
 * - null / undefined / '' / booleans → 0
 * - Infinity / -Infinity / NaN (JS number type) → 0
 * - Excel formula error strings (#VALUE!, #REF!, #N/A, etc.) → 0
 * - Summation strings like "32475133+22190106" → sum of all parts
 * - Parenthetical negatives like "(1,234.56)" → -1234.56
 * - Indian / international currency like "₹1,23,456.78" → 123456.78
 * - Scientific notation strings like "1.23E+07" → 12300000
 */
export function safeNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'boolean') return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;

  const str = String(val).trim();
  if (str === '') return 0;

  // Excel formula error strings: #VALUE!, #REF!, #N/A, #NAME?, #DIV/0!, etc.
  if (str.startsWith('#')) return 0;

  // Summation strings like "32475133+22190106" (used in STOCK VALUE cells)
  // Only match pure digit+digit patterns to avoid false positives with "1E+07"
  if (/^\d+(\+\d+)+$/.test(str)) {
    return str.split('+').reduce((sum, part) => sum + safeNum(part), 0);
  }

  // Parenthetical negatives: "(1,234.56)" → -1234.56
  const isNegative = str.startsWith('(') && str.endsWith(')');
  const cleaned = (isNegative ? str.slice(1, -1) : str).replace(/[₹$€£¥,\s]/g, '');

  const n = parseFloat(cleaned);
  if (!isFinite(n)) return 0;
  return isNegative ? -n : n;
}

// Strips Flipkart triple-quotes and SKU: prefix
// """SKU:IAV-CC-21-105""" → "IAV-CC-21-105"
export function cleanFlipkartSKU(val: any): string {
  return String(val ?? '').replace(/^"+|"+$/g, '').replace(/^SKU:/, '').trim();
}

// Maps a row array to an object using headers
export function rowToObject(headers: string[], row: any[]): Record<string, any> {
  const obj: Record<string, any> = {};
  headers.forEach((h, i) => { obj[h] = row[i] ?? null; });
  return obj;
}

// ── Month auto-detection (14G) ────────────────────────────────────────────

/**
 * Attempts to detect the accounting period (month) from a workbook's sheet names.
 * Matches patterns like "IAV P&L JAN 2026", "Jan-26", "January 2026".
 *
 * @returns Normalised "Mon-YY" string (e.g. "Jan-26"), or null if undetected.
 */
export function detectMonthFromWorkbook(wb: XLSX.WorkBook): string | null {
  const pattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-–]?\s*(20\d{2}|\d{2})\b/i;

  for (const sheetName of wb.SheetNames) {
    const m = sheetName.match(pattern);
    if (m) {
      const abbr = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
      const yr   = m[2].length === 4 ? m[2].slice(2) : m[2];
      return `${abbr}-${yr}`;
    }
  }
  return null;
}