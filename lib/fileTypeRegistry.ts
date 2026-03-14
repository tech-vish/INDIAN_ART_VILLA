/**
 * fileTypeRegistry.ts
 *
 * Maps upload file-type keys to the Excel sheets they contain.
 * Used by:
 *   - The upload UI  → to label the file picker slots
 *   - workbookAssembler → to know which sheets belong to which file
 *   - MonthlyPeriod → to compute availableSheets / missingSheets
 */

export interface FileTypeConfig {
  /** Human-readable label shown in the UI */
  label: string;
  /** Where this file comes from */
  source: string;
  /** Exact sheet names this file is expected to contain */
  expectedSheets: string[];
  /**
   * Optional sheet-name remapping.
   * Key = sheet name as it appears in the uploaded file.
   * Value = canonical sheet name expected by processors, or null to ignore.
   */
  sheetNameAliases: Record<string, string | null>;
  /** Whether this file MUST be present before processing can run */
  required: boolean;
}

export const FILE_TYPES = {
  AMAZON_B2B_TAX: {
    label: 'Amazon B2B Tax Report',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON B2B MAIN SHEET', 'AMAZON B2B CANCEL', 'AMAZON B2B SHIPMENT', 'B2B RETURN'],
    sheetNameAliases: {
      'Sheet1': null,
      'B2B': 'AMAZON B2B MAIN SHEET',
    },
    required: true,
  },
  AMAZON_B2C_TAX: {
    label: 'Amazon B2C Tax Report',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON B2C MAIN SHEET', 'AMAZON B2C CANCEL', 'B2C SHIPMENT'],
    sheetNameAliases: {},
    required: true,
  },
  AMAZON_PAYMENT: {
    label: 'Amazon Payment Report',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON PAYMENT SHEET'],
    sheetNameAliases: { 'Sheet1': 'AMAZON PAYMENT SHEET' },
    required: true,
  },
  AMAZON_FBA_RETURN: {
    label: 'Amazon FBA Returns',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON FBA RETURN '],  // trailing space is intentional
    sheetNameAliases: {},
    required: true,
  },
  AMAZON_MERCHANT_RETURN: {
    label: 'Amazon Merchant Returns',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON MERCHENT RETURN '],  // trailing space + legacy typo intentional
    sheetNameAliases: {},
    required: false,  // merchant-fulfilled returns may not exist every month
  },
  AMAZON_MERGER_SKU: {
    label: 'Amazon Merger SKU Sheet',
    source: 'Amazon Seller Central',
    expectedSheets: ['AMAZON MERGER SKU SHEET v2'],
    sheetNameAliases: {},
    required: false,
  },
  FLIPKART_SALES: {
    label: 'Flipkart Sales Report',
    source: 'Flipkart Seller Hub',
    expectedSheets: ['Flipkart Sales Report Main '],  // trailing space is intentional
    sheetNameAliases: {},
    required: true,
  },
  FLIPKART_CASHBACK: {
    label: 'Flipkart Cashback Report',
    source: 'Flipkart Seller Hub',
    expectedSheets: ['Flipkart Cash Back Report Main '],  // trailing space is intentional
    sheetNameAliases: {},
    required: true,
  },
  FLIPKART_RETURN: {
    label: 'Flipkart Returns Report',
    source: 'Flipkart Seller Hub',
    expectedSheets: ['FLIPKART RETURN'],
    sheetNameAliases: {},
    required: true,
  },
  SALES_BUSY: {
    label: 'Sales Ledger (Busy)',
    source: 'Tally/Busy',
    expectedSheets: ['SALES BUSY'],
    sheetNameAliases: {},
    required: true,
  },
  PURCHASE_LEDGER: {
    label: 'Purchase Ledger (Busy)',
    source: 'Tally/Busy',
    expectedSheets: ['PURCHASE LEDGER'],
    sheetNameAliases: {},
    required: true,
  },
  TALLY_GST_SALES: {
    label: 'Tally GST Sales Report',
    source: 'Unicommerce/Tally',
    expectedSheets: ['Export-Tally GST Report-indiana'],
    sheetNameAliases: {},
    required: true,
  },
  TALLY_GST_RETURNS: {
    label: 'Tally GST Returns Report',
    source: 'Unicommerce/Tally',
    expectedSheets: ['Export-Tally Return GST Report-'],
    sheetNameAliases: {},
    required: true,
  },
  STOCK_VALUE: {
    label: 'Stock Value',
    source: 'Manual',
    expectedSheets: ['STOCK VALUE'],
    sheetNameAliases: {},
    required: true,
  },
  EXP_SHEET: {
    label: 'Expense Sheet',
    source: 'Manual',
    expectedSheets: ['EXP SHEET'],
    sheetNameAliases: {},
    required: true,
  },
  AMAZON_RETURN_VLOOKUP: {
    label: 'Amazon Return Classification Lookup',
    source: 'Manual',
    expectedSheets: ['AMAZON RETURN VLOOKUP'],
    sheetNameAliases: {},
    required: true,
  },
  COMBINED_WORKBOOK: {
    label: 'Combined Master Workbook',
    source: 'All-in-one',
    expectedSheets: [],  // accepts any — contains all sheets
    sheetNameAliases: {},
    required: false,
  },
} as const satisfies Record<string, FileTypeConfig>;

export type FileType = keyof typeof FILE_TYPES;

/**
 * All sheets that are required for a complete P&L run.
 * Derived from the required=true entries in FILE_TYPES.
 */
export const REQUIRED_SHEETS: string[] = Object.values(FILE_TYPES)
  .filter(cfg => cfg.required)
  .flatMap(cfg => cfg.expectedSheets);

/**
 * Given a flat list of sheet names, returns any required sheets that are missing.
 */
export function getMissingSheets(availableSheets: string[]): string[] {
  const available = new Set(availableSheets);
  return REQUIRED_SHEETS.filter(s => !available.has(s));
}

/**
 * Given a sheet name from an uploaded file and its file type config,
 * returns the canonical sheet name (or null if the sheet should be ignored).
 */
export function resolveSheetName(
  rawName: string,
  fileType: FileType,
): string | null {
  const cfg = FILE_TYPES[fileType];
  if (rawName in cfg.sheetNameAliases) {
    return cfg.sheetNameAliases[rawName as keyof typeof cfg.sheetNameAliases] ?? null;
  }
  return rawName;
}
