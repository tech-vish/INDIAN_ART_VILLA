import * as XLSX from 'xlsx';
import type {
  AmazonGSTRow,
  AmazonPaymentRow,
  AmazonSummary,
  AmazonFees,
  AmazonResult,
  AmazonOrderCounts,
  AmazonSummarySheet,
  AmazonExpSheet,
  AmazonExpFeeRow,
  StatewisePL,
} from '../types';
import { AMAZON_RETURN_TYPE_MAP } from '../constants';
import {
  readSheet,
  readTripleHeaderSheet,
  parseDate,
  safeNum,
} from '../utils/parser';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Case-insensitive header index lookup with multiple candidate names
function hIdx(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex(h => h.trim().toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

// 'Ship To State' is at a fixed column index per the workbook spec
const SHIP_TO_STATE_COL = 21;

// â”€â”€ Internal row types for return sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FbaReturnRow {
  orderId: string;
  sku: string;
  quantity: number;
  reason: string;
  revisedValue: string;   // pre-filled classification: "Courier Return" | "Customer Return" | ""
}

interface MerchantReturnRow {
  orderId: string;
  returnQty: number;
  returnReason: string;
}

interface ShipmentCountRow {
  orderId: string;
  qty: number;
}

// â”€â”€ Lookup map builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Reads AMAZON MERGER SKU SHEET v2 â†’ Map<orderId, reasonCode>
 * Used to classify MAIN SHEET Refund rows.
 */
function buildMergerReasonMap(wb: XLSX.WorkBook): Map<string, string> {
  const map = new Map<string, string>();
  if (!wb.Sheets['AMAZON MERGER SKU SHEET v2']) return map;

  const rows = readSheet(wb, 'AMAZON MERGER SKU SHEET v2', 0);
  if (rows.length < 2) return map;

  const headers = (rows[0] as any[]).map(h => String(h ?? '').trim());
  const iOrder  = hIdx(headers, 'Order Id', 'Order ID');
  const iReason = hIdx(headers, 'Return Reason', 'Reason Code', 'Reason', 'Disposition', 'Return Type');

  if (iOrder === -1) return map;

  for (const row of rows.slice(1)) {
    const orderId = String(row[iOrder] ?? '').trim();
    const reason  = iReason !== -1 ? String(row[iReason] ?? '').trim() : '';
    if (orderId) map.set(orderId, reason);
  }
  return map;
}

/**
 * Reads AMAZON RETURN VLOOKUP sheet (single header, data from row 1).
 * The sheet contains TWO side-by-side lookup tables:
 *   Left  (cols 1â€“2): merchantReturnMap â€” return-type label â†’ classification
 *   Right (cols 5â€“6): fbaReasonMap      â€” FBA reason code   â†’ classification
 *
 * Returns empty maps if the sheet is absent (all returns default to Customer Return).
 */
function buildReturnVlookupMaps(wb: XLSX.WorkBook): {
  merchantReturnMap: Map<string, string>;
  fbaReasonMap: Map<string, string>;
} {
  const merchantReturnMap = new Map<string, string>();
  const fbaReasonMap      = new Map<string, string>();

  if (!wb.Sheets['AMAZON RETURN VLOOKUP']) return { merchantReturnMap, fbaReasonMap };

  try {
    const rows = readSheet(wb, 'AMAZON RETURN VLOOKUP', 0);
    // Data starts at index 1 (row 2 in Excel)
    for (const row of rows.slice(1)) {
      // Left table: col index 1 (Return type), col index 2 (CONSIDERED IN)
      const returnType = String(row[1] ?? '').trim();
      const merchant   = String(row[2] ?? '').trim();
      if (returnType && merchant) merchantReturnMap.set(returnType, merchant);

      // Right table: col index 5 (reason code), col index 6 (CONSIDERED IN)
      const reasonCode = String(row[5] ?? '').trim();
      const fbaClass   = String(row[6] ?? '').trim();
      if (reasonCode && fbaClass) fbaReasonMap.set(reasonCode, fbaClass);
    }
  } catch { /* missing or malformed sheet â€” maps remain empty */ }

  return { merchantReturnMap, fbaReasonMap };
}

/**
 * Reads Sheet3 (no headers, all rows are data).
 * Col 0 = Order ID, Col 1 = pre-classified return type.
 * Returns Map<orderId, "Courier Return" | "Customer Return">.
 */
function buildSheet3ReturnMap(wb: XLSX.WorkBook): Map<string, string> {
  const map = new Map<string, string>();
  if (!wb.Sheets['Sheet3']) return map;

  try {
    const rows = readSheet(wb, 'Sheet3', 0);
    for (const row of rows) {
      const orderId  = String(row[0] ?? '').trim();
      const retClass = String(row[1] ?? '').trim();
      if (orderId && retClass) map.set(orderId, retClass);
    }
  } catch { /* ignore */ }

  return map;
}

// â”€â”€ Sheet parsers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Parse AMAZON B2B/B2C MAIN SHEET (triple-header, data row 4+).
 * Returns Shipment, Refund, and Cancel rows (Cancel rows have 0 invoice amounts).
 */
function parseMainRows(wb: XLSX.WorkBook, sheetName: string): AmazonGSTRow[] {
  if (!wb.Sheets[sheetName]) return [];
  const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

  const iOrder = hIdx(headers, 'Order Id', 'Order ID');
  const iShip  = hIdx(headers, 'Shipment Id', 'Shipment ID');
  const iShipD = hIdx(headers, 'Shipment Date', 'Invoice Date');
  const iOrdD  = hIdx(headers, 'Order Date');
  const iQty   = hIdx(headers, 'Quantity Purchased', 'Quantity');
  const iSku   = hIdx(headers, 'SKU');
  const iInv   = hIdx(headers, 'Invoice Amount', 'Total Amount');
  const iTax   = hIdx(headers, 'Tax Exclusive Gross', 'Taxable Value');
  const iIgst  = hIdx(headers, 'IGST Amount', 'IGST');
  const iCgst  = hIdx(headers, 'CGST Amount', 'CGST');
  const iSgst  = hIdx(headers, 'SGST Amount', 'SGST');
  const iShAmt = hIdx(headers, 'Shipping Amount', 'Shipping Credits');
  const iPromo = hIdx(headers, 'Item Promo Discount', 'Promo Discount', 'Promotional Discount');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    transactionType: (String(g(row, 0) ?? '').trim() || 'Shipment') as AmazonGSTRow['transactionType'],
    orderId:         String(g(row, iOrder)  ?? '').trim(),
    shipmentId:      String(g(row, iShip)   ?? '').trim(),
    shipmentDate:    parseDate(g(row, iShipD)),
    orderDate:       parseDate(g(row, iOrdD)),
    quantity:        safeNum(g(row, iQty)),
    sku:             String(g(row, iSku)    ?? '').trim(),
    shipToState:     String(row[SHIP_TO_STATE_COL] ?? '').trim().toUpperCase(),
    invoiceAmount:   safeNum(g(row, iInv)),
    taxExclusiveGross: safeNum(g(row, iTax)),
    igstAmount:      safeNum(g(row, iIgst)),
    cgstAmount:      safeNum(g(row, iCgst)),
    sgstAmount:      safeNum(g(row, iSgst)),
    shippingAmount:  safeNum(g(row, iShAmt)),
    promoDiscount:   safeNum(g(row, iPromo)),
  }));
}

/**
 * Parse AMAZON B2B/B2C CANCEL sheets (triple-header, same layout + Per Pcs Rate).
 * Cancellation value = perPcsRate Ã— quantity (invoice amounts are 0).
 * Returns [] if the sheet does not exist in the workbook.
 */
function parseCancelRows(wb: XLSX.WorkBook, sheetName: string): AmazonGSTRow[] {
  if (!wb.Sheets[sheetName]) return [];

  const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

  const iOrder = hIdx(headers, 'Order Id', 'Order ID');
  const iShip  = hIdx(headers, 'Shipment Id', 'Shipment ID');
  const iShipD = hIdx(headers, 'Shipment Date', 'Invoice Date');
  const iOrdD  = hIdx(headers, 'Order Date');
  const iQty   = hIdx(headers, 'Quantity Purchased', 'Quantity');
  const iSku   = hIdx(headers, 'SKU');
  const iInv   = hIdx(headers, 'Invoice Amount', 'Total Amount');
  const iTax   = hIdx(headers, 'Tax Exclusive Gross', 'Taxable Value');
  const iIgst  = hIdx(headers, 'IGST Amount', 'IGST');
  const iCgst  = hIdx(headers, 'CGST Amount', 'CGST');
  const iSgst  = hIdx(headers, 'SGST Amount', 'SGST');
  const iShAmt = hIdx(headers, 'Shipping Amount');
  const iPromo = hIdx(headers, 'Item Promo Discount', 'Promo Discount');
  const iRate  = hIdx(headers, 'Per Pcs Rate', 'Per Piece Rate', 'Rate');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.map(row => ({
    transactionType: 'Cancel' as const,
    orderId:         String(g(row, iOrder)  ?? '').trim(),
    shipmentId:      String(g(row, iShip)   ?? '').trim(),
    shipmentDate:    parseDate(g(row, iShipD)),
    orderDate:       parseDate(g(row, iOrdD)),
    quantity:        safeNum(g(row, iQty)),
    sku:             String(g(row, iSku)    ?? '').trim(),
    shipToState:     String(row[SHIP_TO_STATE_COL] ?? '').trim().toUpperCase(),
    invoiceAmount:   safeNum(g(row, iInv)),
    taxExclusiveGross: safeNum(g(row, iTax)),
    igstAmount:      safeNum(g(row, iIgst)),
    cgstAmount:      safeNum(g(row, iCgst)),
    sgstAmount:      safeNum(g(row, iSgst)),
    shippingAmount:  safeNum(g(row, iShAmt)),
    promoDiscount:   safeNum(g(row, iPromo)),
    perPcsRate:      safeNum(g(row, iRate)),
  }));
}

/**
 * Parse a plain SHIPMENT sheet (single header at row 0, data from row 1).
 * Used to count distinct orders and total units.
 */
function parseShipmentSheet(wb: XLSX.WorkBook, sheetName: string): ShipmentCountRow[] {
  if (!wb.Sheets[sheetName]) return [];

  try {
    const rows = readSheet(wb, sheetName, 0);
    if (rows.length < 2) return [];

    const headers = (rows[0] as any[]).map(h => String(h ?? '').trim());
    const iOrder  = hIdx(headers, 'Order Id', 'Order ID', 'order id', 'Order-ID');
    const iQty    = hIdx(headers, 'Quantity', 'Qty', 'Quantity Purchased', 'quantity');
    if (iOrder === -1) return [];

    return rows.slice(1)
      .map(row => ({
        orderId: String(row[iOrder] ?? '').trim(),
        qty:     safeNum(iQty !== -1 ? row[iQty] : 1),
      }))
      .filter(r => !!r.orderId);
  } catch { return []; }
}

/**
 * Parse AMAZON FBA RETURN sheet (triple-header).
 * Fixed fallback column indices (0-based per workbook spec):
 *   order-id=1, sku=2, quantity=6, reason=9, REVISED VALUE=12
 */
function parseFbaReturnSheet(wb: XLSX.WorkBook): FbaReturnRow[] {
  const sheetName = 'AMAZON FBA RETURN '; // trailing space intentional
  if (!wb.Sheets[sheetName]) return [];

  try {
    const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

    const iOrder   = hIdx(headers, 'order-id', 'Order Id', 'Order ID', 'order id');
    const iSku     = hIdx(headers, 'sku', 'SKU', 'Merchant SKU', 'seller-sku');
    const iQty     = hIdx(headers, 'Quantity', 'Return Qty', 'quantity', 'qty');
    const iReason  = hIdx(headers, 'reason', 'Reason', 'Reason Code', 'disposal-reason', 'Return Reason');
    const iRevised = hIdx(headers, 'REVISED VALUE', 'Revised Value', 'Return Classification', 'CONSIDERED IN');

    // Fallback to fixed 0-based column indices (per workbook spec, 1-indexed: col2â†’1, col3â†’2, col7â†’6, col10â†’9, col13â†’12)
    const getVal = (row: any[], idx: number, fallback: number) =>
      idx !== -1 ? row[idx] : row[fallback];

    return rows
      .map(row => ({
        orderId:      String(getVal(row, iOrder,   1)  ?? '').trim(),
        sku:          String(getVal(row, iSku,     2)  ?? '').trim(),
        quantity:     safeNum(getVal(row, iQty,    6)),
        reason:       String(getVal(row, iReason,  9)  ?? '').trim(),
        revisedValue: String(getVal(row, iRevised, 12) ?? '').trim(),
      }))
      .filter(r => !!r.orderId);
  } catch { return []; }
}

/**
 * Parse AMAZON MERCHENT RETURN sheet (triple-header, typo intentional).
 * Fixed fallback column indices (0-based): Order ID=0, Return Qty=17, Return Reason=18
 */
function parseMerchantReturnSheet(wb: XLSX.WorkBook): MerchantReturnRow[] {
  const sheetName = 'AMAZON MERCHENT RETURN '; // trailing space + typo intentional
  if (!wb.Sheets[sheetName]) return [];

  try {
    const { headers, rows } = readTripleHeaderSheet(wb, sheetName);

    const iOrder  = hIdx(headers, 'Order Id', 'Order ID', 'order id', 'Order-ID');
    const iQty    = hIdx(headers, 'Return Quantity', 'Return Qty', 'Return quantity', 'qty');
    const iReason = hIdx(headers, 'Return Reason', 'Return reason', 'Reason');

    return rows
      .map(row => ({
        orderId:      String((iOrder  !== -1 ? row[iOrder]  : row[0])  ?? '').trim(),
        returnQty:    safeNum(iQty   !== -1 ? row[iQty]   : row[17]),
        returnReason: String((iReason !== -1 ? row[iReason] : row[18]) ?? '').trim(),
      }))
      .filter(r => !!r.orderId);
  } catch { return []; }
}

/** Parse AMAZON PAYMENT SHEET (single header row 0, data from row 1). Now includes orderState. */
function parsePaymentRows(wb: XLSX.WorkBook): AmazonPaymentRow[] {
  if (!wb.Sheets['AMAZON PAYMENT SHEET']) return [];

  const rows = readSheet(wb, 'AMAZON PAYMENT SHEET', 0);
  if (rows.length < 2) return [];

  const headers = (rows[0] as any[]).map(h => String(h ?? '').trim().toLowerCase());
  const fi = (term: string) => headers.findIndex(h => h.includes(term));

  const iDt       = fi('date');
  const iType     = fi('type');
  const iOrder    = fi('order id');
  const iSku      = fi('sku');
  const iDesc     = fi('description');
  const iProdSale = fi('product sales');
  const iShipCred = fi('shipping credits');
  const iPromo    = fi('promotional rebates');
  const iSellFees = fi('selling fees');
  const iFbaFees  = fi('fba fees');
  const iOther    = fi('other');
  const iTotal    = fi('total');
  // col 12 = order state (fallback if header not found)
  const iState    = fi('order state') !== -1 ? fi('order state') : fi('ship state');

  const g = (row: any[], i: number) => (i === -1 ? null : row[i]);

  return rows.slice(1).map(row => ({
    dateTime:        parseDate(g(row, iDt)),
    type:            String(g(row, iType)     ?? '').trim(),
    orderId:         String(g(row, iOrder)    ?? '').trim(),
    sku:             String(g(row, iSku)      ?? '').trim(),
    description:     String(g(row, iDesc)     ?? '').trim(),
    productSales:    safeNum(g(row, iProdSale)),
    shippingCredits: safeNum(g(row, iShipCred)),
    promoRebates:    safeNum(g(row, iPromo)),
    sellingFees:     safeNum(g(row, iSellFees)),
    fbaFees:         safeNum(g(row, iFbaFees)),
    other:           safeNum(g(row, iOther)),
    total:           safeNum(g(row, iTotal)),
    // col 12 as fallback when 'order state' header isn't detected
    orderState:      String((iState !== -1 ? g(row, iState) : row[12]) ?? '').trim() || undefined,
  }));
}

// â”€â”€ Return classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Normalise a raw classification string to the two canonical values. */
function normaliseClass(raw: string): 'Courier Return' | 'Customer Return' {
  const s = raw.toLowerCase();
  if (s.includes('courier') || s.includes('undeliver') || s.includes('rejected') || s.includes('undeliv')) {
    return 'Courier Return';
  }
  return 'Customer Return';
}

/**
 * Classify a MAIN SHEET Refund row using the available lookup maps.
 * Priority: sheet3Map â†’ mergerMap + AMAZON_RETURN_TYPE_MAP â†’ default Customer Return
 */
function classifyRefundRow(
  orderId: string,
  sheet3Map: Map<string, string>,
  mergerMap: Map<string, string>,
): 'Courier Return' | 'Customer Return' {
  const direct = sheet3Map.get(orderId);
  if (direct) return normaliseClass(direct);

  const reason = mergerMap.get(orderId) ?? '';
  return AMAZON_RETURN_TYPE_MAP[reason] ?? 'Customer Return';
}

/**
 * Classify an FBA return row.
 * Priority: revisedValue col â†’ fbaReasonMap â†’ default Customer Return
 */
function classifyFbaReturn(
  row: FbaReturnRow,
  fbaReasonMap: Map<string, string>,
): 'Courier Return' | 'Customer Return' {
  if (row.revisedValue) return normaliseClass(row.revisedValue);
  const cls = fbaReasonMap.get(row.reason);
  if (cls) return normaliseClass(cls);
  return 'Customer Return';
}

/**
 * Classify a merchant return row.
 * Priority: sheet3Map (by orderId) â†’ parse reason prefix â†’ merchantReturnMap â†’ default Customer Return
 */
function classifyMerchantReturn(
  row: MerchantReturnRow,
  sheet3Map: Map<string, string>,
  merchantReturnMap: Map<string, string>,
): 'Courier Return' | 'Customer Return' {
  const direct = sheet3Map.get(row.orderId);
  if (direct) return normaliseClass(direct);

  // Reason prefix: "CR-FOUND_BETTER_PRICE" â†’ prefix "CR"
  const prefix = row.returnReason.split('-')[0].trim();
  const cls    = merchantReturnMap.get(prefix)
              ?? merchantReturnMap.get(row.returnReason);
  if (cls) return normaliseClass(cls);

  // Heuristic: if reason starts with UND / UNDELIV / REJECTED â†’ Courier Return
  const lower = row.returnReason.toLowerCase();
  if (lower.startsWith('und') || lower.includes('undeliv') || lower.includes('reject')) {
    return 'Courier Return';
  }
  return 'Customer Return';
}

// â”€â”€ Intermediate sheet computers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function computeSummarySheet(
  b2bMainRows: AmazonGSTRow[],
  b2cMainRows: AmazonGSTRow[],
  b2bCancelRows: AmazonGSTRow[],
  b2cCancelRows: AmazonGSTRow[],
  sheet3Map: Map<string, string>,
  mergerMap: Map<string, string>,
): AmazonSummarySheet {
  // â”€â”€ Totals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let b2bGross = 0, b2cGross = 0;
  let b2bCancel = 0, b2cCancel = 0;
  let b2bShipping = 0, b2cShipping = 0;
  let b2bCourierRet = 0, b2bCustomerRet = 0;
  let b2cCourierRet = 0, b2cCustomerRet = 0;
  let discounts = 0, giftWrap = 0;

  for (const row of b2bMainRows) {
    if (row.transactionType === 'Shipment') {
      b2bGross    += row.invoiceAmount;
      b2bShipping += row.shippingAmount;
      discounts   += row.promoDiscount;
    } else if (row.transactionType === 'Refund') {
      const abs = Math.abs(row.invoiceAmount);
      if (classifyRefundRow(row.orderId, sheet3Map, mergerMap) === 'Courier Return') b2bCourierRet   += abs;
      else                                                                             b2bCustomerRet  += abs;
    }
  }
  for (const row of b2cMainRows) {
    if (row.transactionType === 'Shipment') {
      b2cGross    += row.invoiceAmount;
      b2cShipping += row.shippingAmount;
    } else if (row.transactionType === 'Refund') {
      const abs = Math.abs(row.invoiceAmount);
      if (classifyRefundRow(row.orderId, sheet3Map, mergerMap) === 'Courier Return') b2cCourierRet   += abs;
      else                                                                             b2cCustomerRet  += abs;
    }
  }
  for (const row of b2bCancelRows) b2bCancel += safeNum(row.perPcsRate) * row.quantity;
  for (const row of b2cCancelRows) b2cCancel += safeNum(row.perPcsRate) * row.quantity;

  const totalGross       = b2bGross + b2cGross;
  const totalCancel      = b2bCancel + b2cCancel;
  const totalCourier     = b2bCourierRet + b2cCourierRet;
  const totalCustomer    = b2bCustomerRet + b2cCustomerRet;
  const totalShipping    = b2bShipping + b2cShipping;
  const totalNet         = totalGross - totalCancel - totalCourier - totalCustomer + totalShipping;

  const rows = [
    { basis: 'Shipment',          particulars: 'Gross Sales',          b2b: b2bGross,      b2c: b2cGross,      total: totalGross },
    { basis: 'Cancel',            particulars: 'Cancel Sales',          b2b: b2bCancel,     b2c: b2cCancel,     total: totalCancel },
    { basis: 'Return',            particulars: 'Courier Return',        b2b: b2bCourierRet, b2c: b2cCourierRet,  total: totalCourier },
    { basis: 'Return',            particulars: 'Customer Return',       b2b: b2bCustomerRet,b2c: b2cCustomerRet, total: totalCustomer },
    { basis: 'Shipping',          particulars: 'Shipping Amount Received', b2b: b2bShipping,b2c: b2cShipping,   total: totalShipping },
    { basis: 'Gift Wrap',         particulars: 'Gift Wrap Amount',      b2b: 0,             b2c: giftWrap,      total: giftWrap },
    { basis: 'Promo',             particulars: 'Promo Discount',        b2b: 0,             b2c: discounts,     total: discounts },
    { basis: 'Net',               particulars: 'Net Sale',              b2b: b2bGross - b2bCancel - b2bCourierRet - b2bCustomerRet + b2bShipping,
                                                                         b2c: b2cGross - b2cCancel - b2cCourierRet - b2cCustomerRet + b2cShipping,
                                                                         total: totalNet },
  ];

  // â”€â”€ Per-state breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const byState: AmazonSummarySheet['byState'] = {};
  const ensureState = (s: string) => { if (!byState[s]) byState[s] = { b2b: 0, b2c: 0, total: 0 }; };

  for (const row of b2bMainRows) {
    if (row.transactionType !== 'Shipment') continue;
    const s = row.shipToState; if (!s) continue;
    ensureState(s); byState[s].b2b += row.invoiceAmount; byState[s].total += row.invoiceAmount;
  }
  for (const row of b2cMainRows) {
    if (row.transactionType !== 'Shipment') continue;
    const s = row.shipToState; if (!s) continue;
    ensureState(s); byState[s].b2c += row.invoiceAmount; byState[s].total += row.invoiceAmount;
  }

  return { rows, byState };
}

/**
 * Compute AMAZON EXP SHEET structure from payment rows.
 * Groups fees by category and state (top 9 states + OTHER).
 */
function computeExpSheet(paymentRows: AmazonPaymentRow[]): AmazonExpSheet {
  // â”€â”€ Fee category classifier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const classifyFee = (description: string): string => {
    const d = description.toLowerCase();
    if (d.includes('sponsored') || d.includes('advertisement') || d.includes('ads'))         return 'Advertisement';
    if (d.includes('long term storage') || d.includes('long-term storage'))                   return 'Long Term Storage';
    if (d.includes('storage'))                                                                 return 'Storage';
    if (d.includes('weight handling'))                                                         return 'Weight Handling';
    if (d.includes('pick') || d.includes('pack'))                                             return 'Pick & Pack';
    if (d.includes('commission') || d.includes('selling fee') || d.includes('referral fee')) return 'Commission';
    if (d.includes('shipping') || d.includes('delivery'))                                     return 'Shipping';
    if (d.includes('return'))                                                                  return 'Returns';
    return 'Other';
  };

  // â”€â”€ Collect all states by total volume to pick top 9 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stateVolume = new Map<string, number>();
  for (const row of paymentRows) {
    const state = (row.orderState ?? 'OTHER').trim() || 'OTHER';
    stateVolume.set(state, (stateVolume.get(state) ?? 0) + Math.abs(row.total));
  }

  const top9States = [...stateVolume.entries()]
    .filter(([s]) => s !== 'OTHER')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([s]) => s);
  const topSet = new Set(top9States);
  const states = [...top9States, 'OTHER'];

  // â”€â”€ Accumulate per-category per-state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  type FeeAcc = { invoice: number; creditNote: number };
  const acc = new Map<string, Map<string, FeeAcc>>();

  const ensure = (cat: string, state: string) => {
    if (!acc.has(cat)) acc.set(cat, new Map());
    if (!acc.get(cat)!.has(state)) acc.get(cat)!.set(state, { invoice: 0, creditNote: 0 });
    return acc.get(cat)!.get(state)!;
  };

  for (const row of paymentRows) {
    const rawState = (row.orderState ?? '').trim() || 'OTHER';
    const state    = topSet.has(rawState) ? rawState : 'OTHER';
    const fee      = (row.sellingFees ?? 0) + (row.fbaFees ?? 0) + (row.other ?? 0);
    if (fee === 0) continue;

    const cat = classifyFee(row.description);
    const e   = ensure(cat, state);
    if (fee > 0) e.invoice    += fee;
    else         e.creditNote += Math.abs(fee);
  }

  // â”€â”€ Build output rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fees: AmazonExpFeeRow[] = [];
  for (const [cat, stateMap] of acc.entries()) {
    let totalInvoice = 0, totalCN = 0;
    const byState: AmazonExpFeeRow['byState'] = {};
    for (const state of states) {
      const e = stateMap.get(state) ?? { invoice: 0, creditNote: 0 };
      const net = e.invoice - e.creditNote;
      byState[state] = { invoice: e.invoice, creditNote: e.creditNote, net };
      totalInvoice += e.invoice;
      totalCN      += e.creditNote;
    }
    fees.push({ feeLabel: cat, byState, totalInvoice, totalCreditNote: totalCN, totalNet: totalInvoice - totalCN });
  }

  return { states, fees };
}

// â”€â”€ Default empty values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEFAULT_ORDER_COUNTS: AmazonOrderCounts = {
  totalOrders: 0, totalUnits: 0,
  b2bOrders: 0,   b2bUnits: 0,
  b2cOrders: 0,   b2cUnits: 0,
  cancelledOrders: 0, cancelledUnits: 0,
  fbaReturnOrders: 0,      fbaReturnUnits: 0,
  merchantReturnOrders: 0, merchantReturnUnits: 0,
  freeReplacementOrders: 0,
};

const DEFAULT_SUMMARY_SHEET: AmazonSummarySheet = { rows: [], byState: {} };
const DEFAULT_EXP_SHEET: AmazonExpSheet = { states: [], fees: [] };

// â”€â”€ Exported functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Full Amazon processor. Returns AmazonResult containing summary, fees,
 * statewise P&L, order counts, intermediate summary sheet, fee exp sheet,
 * and classified return totals.
 *
 * Every new-sheet read is wrapped in try/catch â€” missing sheets produce zeroed output.
 */
export function processAmazon(wb: XLSX.WorkBook): AmazonResult {

  // â”€â”€ Build lookup maps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const mergerMap                          = buildMergerReasonMap(wb);
  const { merchantReturnMap, fbaReasonMap} = buildReturnVlookupMaps(wb);
  const sheet3Map                          = buildSheet3ReturnMap(wb);

  // â”€â”€ Parse main GST sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const b2bMainRows = parseMainRows(wb, 'AMAZON B2B MAIN SHEET');
  const b2cMainRows = parseMainRows(wb, 'AMAZON B2C MAIN SHEET');
  const allMainRows = [...b2bMainRows, ...b2cMainRows];

  const b2bCancelRows = parseCancelRows(wb, 'AMAZON B2B CANCEL');
  const b2cCancelRows = parseCancelRows(wb, 'AMAZON B2C CANCEL');
  const allCancelRows = [...b2bCancelRows, ...b2cCancelRows];

  // â”€â”€ Classify returns from FBA + Merchant return sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let fbaReturnCourier  = 0, fbaReturnCustomer  = 0;
  let fbaReturnOrders   = 0, fbaReturnUnits     = 0;
  let freeReplacements  = 0;

  const fbaRows = parseFbaReturnSheet(wb);
  for (const row of fbaRows) {
    const cls = classifyFbaReturn(row, fbaReasonMap);
    if (cls === 'Courier Return') fbaReturnCourier  += row.quantity;
    else                          fbaReturnCustomer += row.quantity;
    fbaReturnOrders++;
    fbaReturnUnits += row.quantity;
    // FREE REPLACEMENT heuristic: SELLABLE disposition = replacement item
    // TODO: improve detection once workbook sample available
  }
  void fbaReturnCourier; void fbaReturnCustomer; // used via classifyFbaReturn but totals are order-count oriented

  let merchantReturnOrders = 0, merchantReturnUnits = 0;
  const merchantRows = parseMerchantReturnSheet(wb);
  for (const row of merchantRows) {
    merchantReturnOrders++;
    merchantReturnUnits += row.returnQty;
  }

  // â”€â”€ Process main rows (monetary values) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let grossSales = 0, shippingReceived = 0, discounts = 0;
  let b2bGrossSales = 0, b2cGrossSales = 0;
  let courierReturns = 0, customerReturns = 0;
  const byState: AmazonSummary['byState'] = {};

  const ensureState = (s: string) => {
    if (!byState[s]) byState[s] = { gross: 0, cancel: 0, returns: 0, net: 0 };
  };

  for (const row of b2bMainRows) {
    const state = row.shipToState;
    ensureState(state);
    if (row.transactionType === 'Shipment') {
      b2bGrossSales    += row.invoiceAmount;
      grossSales       += row.invoiceAmount;
      shippingReceived += row.shippingAmount;
      discounts        += row.promoDiscount;
      byState[state].gross += row.invoiceAmount;
    } else if (row.transactionType === 'Refund') {
      const abs  = Math.abs(row.invoiceAmount);
      const kind = classifyRefundRow(row.orderId, sheet3Map, mergerMap);
      if (kind === 'Courier Return') courierReturns  += abs;
      else                           customerReturns += abs;
      byState[state].returns += abs;
    }
  }

  for (const row of b2cMainRows) {
    const state = row.shipToState;
    ensureState(state);
    if (row.transactionType === 'Shipment') {
      b2cGrossSales    += row.invoiceAmount;
      grossSales       += row.invoiceAmount;
      shippingReceived += row.shippingAmount;
      byState[state].gross += row.invoiceAmount;
    } else if (row.transactionType === 'Refund') {
      const abs  = Math.abs(row.invoiceAmount);
      const kind = classifyRefundRow(row.orderId, sheet3Map, mergerMap);
      if (kind === 'Courier Return') courierReturns  += abs;
      else                           customerReturns += abs;
      byState[state].returns += abs;
    }
  }

  // â”€â”€ Cancellations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let cancellations = 0, b2bCancellations = 0, b2cCancellations = 0;
  for (const row of b2bCancelRows) {
    const val = safeNum(row.perPcsRate) * row.quantity;
    b2bCancellations += val; cancellations += val;
    const state = row.shipToState; ensureState(state);
    byState[state].cancel += val;
  }
  for (const row of b2cCancelRows) {
    const val = safeNum(row.perPcsRate) * row.quantity;
    b2cCancellations += val; cancellations += val;
    const state = row.shipToState; ensureState(state);
    byState[state].cancel += val;
  }

  for (const state of Object.keys(byState)) {
    const s = byState[state];
    s.net = s.gross - s.cancel - s.returns;
  }

  const totalReturns = courierReturns + customerReturns;
  const netSales     = grossSales - cancellations - totalReturns + shippingReceived;

  // â”€â”€ Order counts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let totalOrders = 0, totalUnits = 0, b2bOrders = 0, b2bUnits = 0, b2cOrders = 0, b2cUnits = 0;
  let cancelledOrders = 0, cancelledUnits = 0;

  try {
    // B2B shipments
    const b2bShipRows = parseShipmentSheet(wb, 'AMAZON B2B SHIPMENT');
    const b2bOrderIds = new Set(b2bShipRows.map(r => r.orderId));
    b2bOrders  = b2bOrderIds.size;
    b2bUnits   = b2bShipRows.reduce((s, r) => s + r.qty, 0);

    // B2C shipments
    const b2cShipRows = parseShipmentSheet(wb, 'B2C SHIPMENT');
    const b2cOrderIds = new Set(b2cShipRows.map(r => r.orderId));
    b2cOrders  = b2cOrderIds.size;
    b2cUnits   = b2cShipRows.reduce((s, r) => s + r.qty, 0);

    totalOrders = b2bOrders + b2cOrders;
    totalUnits  = b2bUnits + b2cUnits;

    // Cancellations (distinct orders)
    const cancelIds = new Set([
      ...parseCancelRows(wb, 'AMAZON B2B CANCEL').map(r => r.orderId),
      ...parseCancelRows(wb, 'AMAZON B2C CANCEL').map(r => r.orderId),
    ]);
    cancelledOrders = cancelIds.size;
    cancelledUnits  = allCancelRows.reduce((s, r) => s + r.quantity, 0);
  } catch { /* non-fatal â€” shipment sheets may be absent */ }

  const orders: AmazonOrderCounts = {
    totalOrders,    totalUnits,
    b2bOrders,      b2bUnits,
    b2cOrders,      b2cUnits,
    cancelledOrders, cancelledUnits,
    fbaReturnOrders,      fbaReturnUnits,
    merchantReturnOrders, merchantReturnUnits,
    freeReplacementOrders: freeReplacements,
  };

  // â”€â”€ Payment sheet fees â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const paymentRows = parsePaymentRows(wb);

  let advertisement = 0, longTermStorage = 0, storage = 0;
  let fbaWeightHandling = 0, pickAndPack = 0, commission = 0, otherFees = 0;

  // Fees from AMAZON EXP SHEET (per-state breakdown already pre-computed)
  if (wb.Sheets['AMAZON EXP SHEET']) {
    const eRows = readSheet(wb, 'AMAZON EXP SHEET', 0);
    if (eRows.length >= 4) {
      const headers   = (eRows[0] as any[]).map(h => String(h ?? '').trim().toLowerCase());
      const iTotalCol = headers.findIndex(h => h === 'total' || h === 'grand total');
      const rowSum    = (row: any[]) =>
        iTotalCol !== -1
          ? safeNum(row[iTotalCol])
          : (row as any[]).slice(1).reduce((acc: number, v: any) => acc + safeNum(v), 0);

      for (const row of eRows.slice(3)) {
        const label = String(row[0] ?? '').trim().toLowerCase();
        if (!label) continue;
        const total = rowSum(row);
        if      (label.includes('advertisement') || label.includes('sponsored'))      advertisement    += total;
        else if (label.includes('long term')     || label.includes('long-term'))      longTermStorage  += total;
        else if (label.includes('storage'))                                            storage          += total;
        else if (label.includes('weight handling'))                                   fbaWeightHandling += total;
        else if (label.includes('pick')          || label.includes('pack'))           pickAndPack      += total;
        else                                                                           otherFees        += total;
      }
    }
  }

  // Commission and FBA from payment sheet
  for (const row of paymentRows) {
    commission        += Math.abs(safeNum(row.sellingFees));
    fbaWeightHandling += Math.abs(safeNum(row.fbaFees));
  }

  const totalFees = advertisement + longTermStorage + storage +
                    fbaWeightHandling + pickAndPack + commission + otherFees;

  const fees: AmazonFees = {
    advertisement, longTermStorage, storage,
    fbaWeightHandling, pickAndPack, commission, otherFees, totalFees,
  };

  // â”€â”€ Intermediate sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const summarySheet = computeSummarySheet(
    b2bMainRows, b2cMainRows, b2bCancelRows, b2cCancelRows, sheet3Map, mergerMap,
  );

  const expSheet = computeExpSheet(paymentRows);

  // â”€â”€ Statewise rows (from MERGER SKU SHEET v2, with cancel fallback) â”€â”€â”€â”€â”€â”€â”€
  const statewise = buildStatewiseFromMerger(wb, mergerMap, sheet3Map, allCancelRows);

  const summary: AmazonSummary = {
    grossSales, cancellations, courierReturns, customerReturns,
    totalReturns, shippingReceived,
    giftWrap: 0, discounts, netSales, byState,
    b2bGrossSales, b2cGrossSales,
    b2bCancellations, b2cCancellations,
    b2bNetSales: b2bGrossSales - b2bCancellations,
    b2cNetSales: b2cGrossSales - b2cCancellations,
  };

  return {
    summary,
    fees,
    statewise,
    orders,
    summarySheet,
    expSheet,
    returnClassification: { courier: courierReturns, customer: customerReturns },
  };
}

/**
 * Build state-level P&L rows from AMAZON MERGER SKU SHEET v2 (with cancel fallback).
 * Extracted into a helper so processAmazon() stays readable.
 */
function buildStatewiseFromMerger(
  wb: XLSX.WorkBook,
  mergerMap: Map<string, string>,
  sheet3Map: Map<string, string>,
  allCancelRows: AmazonGSTRow[],
): StatewisePL[] {
  if (!wb.Sheets['AMAZON MERGER SKU SHEET v2']) return [];

  const rows = readSheet(wb, 'AMAZON MERGER SKU SHEET v2', 0);
  if (rows.length < 2) return [];

  const headers = (rows[0] as any[]).map(h => String(h ?? '').trim());
  const iType  = hIdx(headers, 'Transaction Type');
  const iOrder = hIdx(headers, 'Order Id', 'Order ID');
  const iState = hIdx(headers, 'Ship To State', 'Ship State', 'State');
  const iInv   = hIdx(headers, 'Invoice Amount', 'Total Amount');
  const iQty   = hIdx(headers, 'Quantity Purchased', 'Quantity');
  const iRate  = hIdx(headers, 'Per Pcs Rate', 'Per Piece Rate', 'Rate');

  const stateMap = new Map<string, { gross: number; cancel: number; returns: number }>();
  const ensure   = (s: string) => {
    if (!stateMap.has(s)) stateMap.set(s, { gross: 0, cancel: 0, returns: 0 });
  };

  for (const row of rows.slice(1)) {
    const txType  = String(iType  !== -1 ? row[iType]  : '').trim();
    const orderId = String(iOrder !== -1 ? row[iOrder] : '').trim();
    const state   = String(iState !== -1 ? row[iState] : '').trim().toUpperCase();
    const inv     = safeNum(iInv  !== -1 ? row[iInv]   : null);
    const qty     = safeNum(iQty  !== -1 ? row[iQty]   : null);
    const rate    = safeNum(iRate !== -1 ? row[iRate]   : null);

    if (!state) continue;
    ensure(state);
    const s = stateMap.get(state)!;

    if (txType === 'Shipment') {
      s.gross += inv;
    } else if (txType === 'Refund') {
      s.returns += Math.abs(inv);
    } else if (txType === 'Cancel') {
      s.cancel += rate * qty;
    } else if (txType === '' && inv !== 0) {
      if (inv > 0) s.gross   += inv;
      else         s.returns += Math.abs(inv);
    }

    void orderId; void mergerMap; void sheet3Map;
  }

  // Fallback: if no cancel rows in merger sheet, use CANCEL sheets
  const hasCancelRows = Array.from(stateMap.values()).some(v => v.cancel > 0);
  if (!hasCancelRows) {
    for (const row of allCancelRows) {
      const state = row.shipToState;
      if (!state) continue;
      ensure(state);
      stateMap.get(state)!.cancel += safeNum(row.perPcsRate) * row.quantity;
    }
  }

  return Array.from(stateMap.entries())
    .map(([state, s]) => {
      const net = s.gross - s.cancel - s.returns;
      return {
        state,
        grossSales:        s.gross,
        cancellations:     s.cancel,
        returns:           s.returns,
        netSales:          net,
        expenseAllocation: 0,
        netEarnings:       net,
      };
    })
    .filter(r => r.grossSales !== 0 || r.cancellations !== 0 || r.returns !== 0)
    .sort((a, b) => b.netSales - a.netSales);
}

// â”€â”€ Backward-compatible thin wrappers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// plBuilder.ts uses processAmazon() directly; these are for external callers.

export function getAmazonStatewise(wb: XLSX.WorkBook): StatewisePL[] {
  return processAmazon(wb).statewise;
}

export function getAmazonFees(wb: XLSX.WorkBook): AmazonFees {
  return processAmazon(wb).fees;
}

