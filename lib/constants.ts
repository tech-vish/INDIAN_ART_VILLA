import type { Channel } from './types';

export const CHANNELS = [
  'AMAZON',
  'FLIPKART',
  'MEESHO',
  'MYNTRA',
  'IAV_IN',
  'BULK_DOMESTIC',
  'SHOWROOM',
  'IAV_COM',
  'BULK_EXPORT',
] as const satisfies readonly Channel[];

// File upload configuration (used by FileDropzone)
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10 MB
  MAX_FILES: 10,
} as const;

// Sheets that have a triple-header row structure (merge-cell headers)
export const TRIPLE_HEADER_SHEETS = [
  'Amazon GST',
  'Flipkart Sales',
  'Flipkart Cashback',
] as const;

// Maps Busy accounting ledger names → Channel enum values
export const BUSY_ACCOUNT_TO_CHANNEL: Record<string, Channel> = {
  'Amazon India':       'AMAZON',
  'Amazon':             'AMAZON',
  'Flipkart':           'FLIPKART',
  'Meesho':             'MEESHO',
  'Myntra':             'MYNTRA',
  'IAV Website':        'IAV_IN',
  'IndianArtVilla.in':  'IAV_IN',
  'Bulk Domestic':      'BULK_DOMESTIC',
  'B2B Domestic':       'BULK_DOMESTIC',
  'Showroom':           'SHOWROOM',
  'IAV.com':            'IAV_COM',
  'IndianArtVilla.com': 'IAV_COM',
  'Bulk Export':        'BULK_EXPORT',
  'B2B Export':         'BULK_EXPORT',
};

// All Indian states/UTs that appear on Amazon GST reports
export const AMAZON_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
  'Daman & Diu', 'Dadra & Nagar Haveli', 'Andaman & Nicobar Islands', 'Lakshadweep',
] as const;

// How each expense line item is allocated across channels
export type AllocationRule =
  | 'DIRECT'
  | 'SALES RATIO'
  | '70%-30%'
  | 'ONLY INDIANARTVILLA.IN'
  | 'B2B FOR BULK & B2C WEBSITE';

// Maps Amazon transaction-type strings → return category
export const AMAZON_RETURN_TYPE_MAP: Record<string, 'Courier Return' | 'Customer Return'> = {
  CustomerReturn:           'Customer Return',
  FreeReplacement:          'Customer Return',
  ReturnToSeller:           'Customer Return',
  LostInbound:              'Courier Return',
  LostOutbound:             'Courier Return',
  DamagedInbound:           'Courier Return',
  DamagedOutbound:          'Courier Return',
  MissingFromInbound:       'Courier Return',
  UndeliverableAsAddressed: 'Courier Return',
};

// Expense category names for the expenseAllocator
export const EXPENSE_CATEGORIES = [
  'Advertisement',
  'Long Term Storage',
  'Storage',
  'FBA Weight Handling',
  'Pick & Pack',
  'Commission',
  'Other Fees',
  'Packing Material',
  'Freight Inward',
  'Salary',
  'Office Rent',
  'Utilities',
  'Miscellaneous',
] as const;

// Chart colour palette
export const CHART_COLORS = {
  PRIMARY:   '#2563eb',
  SUCCESS:   '#16a34a',
  DANGER:    '#dc2626',
  WARNING:   '#d97706',
  INFO:      '#0891b2',
  NEUTRAL:   '#6b7280',
} as const;

// ── Indian Fiscal Year helpers ─────────────────────────────────────────────

/**
 * Returns the Indian fiscal quarter for a given calendar month.
 * @param month  0-based month index (0 = January, 11 = December)
 */
export function getFiscalQuarter(month: number): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
  if (month >= 3 && month <= 5) return 'Q1';  // Apr–Jun
  if (month >= 6 && month <= 8) return 'Q2';  // Jul–Sep
  if (month >= 9 && month <= 11) return 'Q3'; // Oct–Dec
  return 'Q4';                                  // Jan–Mar
}

/**
 * Returns the Indian fiscal year string for a given calendar month + year.
 * e.g. month=0 (Jan), year=2026 → "2025-26"
 *      month=3 (Apr), year=2026 → "2026-27"
 * @param month  0-based month index
 * @param year   full calendar year
 */
export function getFiscalYear(month: number, year: number): string {
  // Jan–Mar belong to the previous fiscal year
  if (month <= 2) {
    return `${year - 1}-${String(year).slice(2)}`;
  }
  return `${year}-${String(year + 1).slice(2)}`;
}

// ── State name normalisation (14F) ────────────────────────────────────────

/**
 * Maps common misspellings and alternate forms of Indian state/UT names to
 * their canonical spellings (matching AMAZON_STATES entries).
 * Keys are UPPER-CASED for case-insensitive lookup.
 */
export const STATE_NAME_MAP: Record<string, string> = {
  // Telangana variants
  'TELEGANA':                       'Telangana',
  'TELANGNA':                       'Telangana',
  // Maharashtra variants
  'MAHARASTRA':                     'Maharashtra',
  // Odisha (formerly Orissa)
  'ORISSA':                         'Odisha',
  'ORRISA':                         'Odisha',
  'ORISA':                          'Odisha',
  // Uttarakhand (formerly Uttaranchal)
  'UTTARANCHAL':                    'Uttarakhand',
  // Puducherry (formerly Pondicherry)
  'PONDICHERRY':                    'Puducherry',
  // Tamil Nadu
  'TAMILNADU':                      'Tamil Nadu',
  // Jammu & Kashmir
  'J&K':                            'Jammu & Kashmir',
  'J & K':                          'Jammu & Kashmir',
  'JAMMU AND KASHMIR':              'Jammu & Kashmir',
  // Delhi
  'NCT OF DELHI':                   'Delhi',
  'NEW DELHI':                      'Delhi',
  // Andaman & Nicobar Islands
  'ANDAMAN AND NICOBAR':            'Andaman & Nicobar Islands',
  'A&N ISLANDS':                    'Andaman & Nicobar Islands',
  // Daman & Diu / Dadra & Nagar Haveli
  'DAMAN AND DIU':                  'Daman & Diu',
  'DADRA AND NAGAR HAVELI':         'Dadra & Nagar Haveli',
  'DADRA & NAGAR HAVELI AND DAMAN & DIU': 'Dadra & Nagar Haveli',
} as const;

/**
 * Normalises a raw state name string to the canonical form used in AMAZON_STATES.
 * 1. Trims whitespace
 * 2. Checks STATE_NAME_MAP (case-insensitive)
 * 3. Falls back to a case-insensitive scan of AMAZON_STATES
 * 4. Returns the original trimmed value if no match found
 */
export function normalizeStateName(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const upper   = trimmed.toUpperCase().replace(/\s+/g, ' ');

  if (STATE_NAME_MAP[upper]) return STATE_NAME_MAP[upper];

  const lower     = trimmed.toLowerCase();
  const canonical = AMAZON_STATES.find(s => s.toLowerCase() === lower);
  return canonical ?? trimmed;
}