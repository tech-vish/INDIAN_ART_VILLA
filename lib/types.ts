// ── Channels ──────────────────────────────────────────────
export type Channel =
  | 'AMAZON' | 'FLIPKART' | 'MEESHO' | 'MYNTRA'
  | 'IAV_IN' | 'BULK_DOMESTIC' | 'SHOWROOM'
  | 'IAV_COM' | 'BULK_EXPORT';

export type ChannelMap<T> = Record<Channel, T>;

// ── Raw sheet row types ────────────────────────────────────
export interface AmazonGSTRow {
  transactionType: 'Shipment' | 'Refund' | 'Cancel';
  orderId: string;
  shipmentId: string;
  shipmentDate: Date | null;
  orderDate: Date | null;
  quantity: number;
  sku: string;
  shipToState: string;
  invoiceAmount: number;
  taxExclusiveGross: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  shippingAmount: number;
  promoDiscount: number;
  perPcsRate?: number;          // only in CANCEL sheets
}

export interface FlipkartSalesRow {
  orderId: string;
  orderItemId: string;
  eventType: 'Sale' | 'Return' | 'Cancellation' | 'Return Cancellation';
  orderDate: Date | null;
  sku: string;                   // stripped of triple-quotes and 'SKU:' prefix
  deliveryState: string;
  sellerShare: number;
  finalInvoiceAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  tcsTotal: number;
}

export interface FlipkartCashbackRow {
  orderId: string;
  documentType: 'Credit Note' | 'Debit Note';
  documentSubType: 'Sale' | 'Return';
  invoiceAmount: number;
  taxableValue: number;
  deliveryState: string;
}

export interface SalesBusyRow {
  date: Date;
  voucherNo: string;
  account: string;
  revisedAccount: string;   // mapped channel name
  netAmount: number;
  isReturn: boolean;
}

export interface UniwareRow {
  date: Date;
  invoiceNo: string;
  channelLedger: string;
  sku: string;
  qty: number;
  unitPrice: number;
  currency: string;           // 'INR' or 'USD'
  total: number;
  shippingState: string;
  isReturn: boolean;
}

export interface AmazonPaymentRow {
  dateTime: Date | null;
  type: string;
  orderId: string;
  sku: string;
  description: string;
  productSales: number;
  shippingCredits: number;
  promoRebates: number;
  sellingFees: number;
  fbaFees: number;
  other: number;
  total: number;
  orderState?: string;  // col 12: ship-to state (used for per-state fee breakdown)
}

// ── Intermediate computed types ────────────────────────────
export interface AmazonSummary {
  grossSales: number;
  cancellations: number;
  courierReturns: number;
  customerReturns: number;
  totalReturns: number;
  shippingReceived: number;
  giftWrap: number;
  discounts: number;
  netSales: number;
  byState: Record<string, { gross: number; cancel: number; returns: number; net: number }>;
  // B2B / B2C split
  b2bGrossSales: number;
  b2cGrossSales: number;
  b2bCancellations: number;
  b2cCancellations: number;
  b2bNetSales: number;
  b2cNetSales: number;
}

export interface FlipkartSummary {
  grossSales: number;
  cancellations: number;
  returns: number;
  returnCancellations: number;
  cashback: number;
  shippingReceived: number;
  discounts: number;
  netSales: number;
}

export interface AmazonFees {
  advertisement: number;
  longTermStorage: number;
  storage: number;
  fbaWeightHandling: number;
  pickAndPack: number;
  commission: number;
  otherFees: number;
  totalFees: number;
}

export interface ExpenseRow {
  sno: number | null;
  particulars: string;
  totalBooks: number;
  dataSource: string;
  allocationBasis: 'DIRECT' | 'SALES RATIO' | '70%-30%' | 'ONLY INDIANARTVILLA.IN' | 'B2B FOR BULK & B2C WEBSITE';
  allocated: ChannelMap<number>;
}

// ── P&L output types ───────────────────────────────────────
export interface PLRow {
  label: string;
  total: number;
  totalPct: number;
  byChannel: ChannelMap<number>;
  byChannelPct: ChannelMap<number>;
}

export interface PLOutput {
  month: string;
  grossSales: PLRow;
  cancellations: PLRow;
  courierReturns: PLRow;
  customerReturns: PLRow;
  shippingReceived: PLRow;
  netSales: PLRow;
  openingStock: PLRow;
  purchases: PLRow;
  closingStock: PLRow;
  packingMaterial: PLRow;
  freightInward: PLRow;
  cogs: PLRow;
  grossProfit: PLRow;
  expenses: ExpenseRow[];
  totalDirectExp: PLRow;
  totalAllocatedExp: PLRow;
  netProfit: PLRow;
  /** Interest on bank and other loans — total-level deduction, not allocated per channel */
  interestExpense: number;
}

export interface MonthlyAmazonRow {
  month: Date;
  grossSales: number;
  cancellations: number;
  courierReturns: number;
  customerReturns: number;
  shippingReceived: number;
  netSales: number;
  amazonCommission: number;
  amazonAds: number;
  fulfilmentFees: number;
  otherFees: number;
  totalExpenses: number;
  netEarnings: number;
}

export interface StatewisePL {
  state: string;
  grossSales: number;
  cancellations: number;
  returns: number;
  netSales: number;
  expenseAllocation: number;
  netEarnings: number;
}

// ── Amazon enhanced output types ───────────────────────────────────────────

/** Order and unit counts sourced from SHIPMENT / CANCEL / FBA-RETURN / MERCHANT-RETURN sheets */
export interface AmazonOrderCounts {
  totalOrders: number;
  totalUnits: number;
  b2bOrders: number;
  b2bUnits: number;
  b2cOrders: number;
  b2cUnits: number;
  cancelledOrders: number;
  cancelledUnits: number;
  fbaReturnOrders: number;
  fbaReturnUnits: number;
  merchantReturnOrders: number;
  merchantReturnUnits: number;
  freeReplacementOrders: number;
}

/** One row of the AMAZON SUMMRY SHEET (B2B, B2C, Total columns) */
export interface AmazonSummarySheetRow {
  basis: string;
  particulars: string;
  b2b: number;
  b2c: number;
  total: number;
}

/** Full AMAZON SUMMRY SHEET structure */
export interface AmazonSummarySheet {
  rows: AmazonSummarySheetRow[];
  /** Per-state gross sales split by B2B and B2C */
  byState: Record<string, { b2b: number; b2c: number; total: number }>;
}

/** One fee category row of the AMAZON EXP SHEET (per-state invoice/credit/net) */
export interface AmazonExpFeeRow {
  feeLabel: string;
  byState: Record<string, { invoice: number; creditNote: number; net: number }>;
  totalInvoice: number;
  totalCreditNote: number;
  totalNet: number;
}

/** Full AMAZON EXP SHEET structure (top-9 states + OTHER) */
export interface AmazonExpSheet {
  /** Ordered list of state column names (top 9 by fee volume + "OTHER") */
  states: string[];
  fees: AmazonExpFeeRow[];
}

/** Full result returned by processAmazon() */
export interface AmazonResult {
  summary: AmazonSummary;
  fees: AmazonFees;
  statewise: StatewisePL[];
  orders: AmazonOrderCounts;
  summarySheet: AmazonSummarySheet;
  expSheet: AmazonExpSheet;
  returnClassification: { courier: number; customer: number };
}

// ── Flipkart enhanced output types ─────────────────────────────────────────

/** Order and unit counts sourced from Flipkart Sales Report */
export interface FlipkartOrderCounts {
  totalOrders: number;
  totalUnits: number;
  cancelledOrders: number;
  cancelledUnits: number;
  returnOrders: number;
  returnUnits: number;
  returnCancellationOrders: number;
}

/** One row of the FLIPKART SUMMRY SHEET */
export interface FlipkartSummarySheetRow {
  basis: string;
  particulars: string;
  sales: number;
  cashback: number;
  total: number;
}

/** Full FLIPKART SUMMRY SHEET */
export interface FlipkartSummarySheet {
  rows: FlipkartSummarySheetRow[];
  byState: Record<string, { sales: number; cashback: number; total: number }>;
}

/** One fee row of FLIPKART EXP SHEET */
export interface FlipkartExpFeeRow {
  feeLabel: string;
  byState: Record<string, number>;
  total: number;
}

/** Full FLIPKART EXP SHEET */
export interface FlipkartExpSheet {
  states: string[];
  fees: FlipkartExpFeeRow[];
}

/** Full result returned by processFlipkart() */
export interface FlipkartResult {
  summary: FlipkartSummary;
  fees: Record<string, number>;
  statewise: StatewisePL[];
  orders: FlipkartOrderCounts;
  summarySheet: FlipkartSummarySheet;
  expSheet: FlipkartExpSheet;
  returnClassification: { courier: number; customer: number };
}

// ── IAV / Tally (Uniware) enhanced output types ────────────────────────────

/** Per-channel summary for IAV_IN (includes full return split + charges breakdown) */
export interface IavInChannelSummary {
  grossSales: number;
  returns: number;
  courierReturn: number;
  customerReturn: number;
  shipping: number;
  codCharges: number;
  discount: number;
  netSales: number;
}

/** One row of the UNIWARE SUMMRY SHEET intermediate table */
export interface UniwareSummarySheetRow {
  rowType: 'SALES' | 'RETURN_COURIER' | 'RETURN_CUSTOMER' | 'CANCEL' | 'NET_SALES';
  myntra: { principalBasics: number; shipping: number; codCharges: number; discount: number };
  iavIn:  { principalBasics: number; shipping: number; codCharges: number; discount: number };
}

/** Full UNIWARE SUMMRY SHEET (IAV_IN + Myntra combined, with per-state breakdown) */
export interface UniwareSummarySheet {
  rows: UniwareSummarySheetRow[];
  /** Combined IAV_IN + Myntra sales/returns per state */
  byState: Record<string, { sales: number; returns: number; net: number }>;
}

/** Full result returned by processIavIn() */
export interface IavInResult {
  iavIn:  IavInChannelSummary;
  iavCom: { grossSales: number; returns: number; shipping: number; discount: number; netSales: number };
  myntra: { grossSales: number; returns: number; shipping: number; discount: number; netSales: number };
  statewise: { iavIn: StatewisePL[]; iavCom: StatewisePL[]; myntra: StatewisePL[] };
  summarySheet: UniwareSummarySheet;
  orders: { iavIn: number; iavCom: number; myntra: number };
}

// ── SalesBusy enhanced output types ────────────────────────────────────────

/** Distinct Vch/Bill No counts per channel from SALES BUSY */
export interface SalesBusyOrderCounts {
  saleOrders: number;
  returnOrders: number;
}

/** PURCHASE LEDGER split into accounting buckets (6D) */
export interface PurchaseSplit {
  /** Type = "PURCHASES" (Purc), excluding packing/freight rows */
  traded: number;
  /** Account contains "Packing" */
  packingMaterial: number;
  /** Type = "STOCK TRANSFER" — excluded from total */
  stockTransfer: number;
  /** Account contains "Freight" */
  freightInward: number;
  /** traded + packingMaterial + freightInward */
  total: number;
}

/** Opening and closing stock values (6B / 6C) */
export interface StockValues {
  opening: { traded: number; packing: number };
  closing: { traded: number; packing: number };
}

/** Full result returned by processSalesBusy() */
export interface SalesBusyResult {
  byChannel: ChannelMap<{ sales: number; returns: number; net: number }>;
  orders: ChannelMap<SalesBusyOrderCounts>;
  purchases: PurchaseSplit;
  stock: StockValues;
}

// ── Statewise combined output ──────────────────────────────────────────────

/** Combined statewise sales across all channels */
export interface StatewiseSale {
  combined: { state: string; grossSales: number; returns: number; netSales: number }[];
  byChannel: Partial<Record<Channel, StatewisePL[]>>;
}

/** One row in the STOCK VALUE sheet table */
export interface StockValueSheetRow {
  sno: string;
  location: string;
  openingStockValue: number;
  closingStockValue: number;
  changes: number;
  notes?: string;
  isTotal?: boolean;
}

/** Parsed STOCK VALUE sheet for UI rendering */
export interface StockValueSheet {
  rows: StockValueSheetRow[];
}

// ── 8B: Intermediate sheets ───────────────────────────────────────────────

/** All 6 intermediate computation sheets produced by buildPL */
export interface IntermediateSheets {
  amazonSummary:    AmazonSummarySheet;
  flipkartSummary:  FlipkartSummarySheet;
  uniwareSummary:   UniwareSummarySheet;
  amazonExpSheet:   AmazonExpSheet;
  flipkartExpSheet: FlipkartExpSheet;
  statewiseSale:    StatewiseSale;
  stockValueSheet:  StockValueSheet;
}

// ── 8D: Amazon-only monthly P&L row ──────────────────────────────────────

/** One month of Amazon-channel P&L for the rolling monthwise table */
export interface AmazonMonthlyPLRow {
  month:            string;
  grossSales:       number;
  cancellations:    number;
  courierReturns:   number;
  customerReturns:  number;
  salesAfterReturn: number;
  shippingReceived: number;
  giftWrap:         number;
  discounts:        number;
  netSales:         number;
  openingStock:     number;
  purchases:        number;
  closingStock:     number;
  packingMaterial:  number;
  freightInward:    number;
  totalCOGS:        number;
  grossProfit:      number;
  advertisement:    number;
  inboundTransport: number;
  commission:       number;
  paymentGateway:   number;
  shippingCourier:  number;
  storage:          number;
  exchangeDiff:     number;
  subscription:     number;
  employeeBenefit:  number;
  totalDirectExp:   number;
  ebitAmazon:       number;
}

// ── 8E: Quarterly rollup ──────────────────────────────────────────────────

export type FiscalQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface QuarterlyRollup {
  quarter:    FiscalQuarter;
  fiscalYear: string;
  /** Short month labels included in this quarter e.g. ["Apr-25","May-25","Jun-25"] */
  months:     string[];
  amazon:     AmazonMonthlyPLRow;
}

// ── 8F: Comparative P&L ───────────────────────────────────────────────────

export interface ComparativePLRow {
  label:     string;
  previous:  number;
  current:   number;
  change:    number;
  /** null when previous is 0 */
  changePct: number | null;
}

export interface ComparativePL {
  type:          'group_monthly' | 'amazon_monthly' | 'amazon_quarterly';
  currentLabel:  string;
  previousLabel: string;
  rows:          ComparativePLRow[];
  /** amazon_monthly: last 12 months of key Amazon metrics */
  history?: { label: string; values: Record<string, number> }[];
}

// ── Combined orders ───────────────────────────────────────────────────────

export interface CombinedOrders {
  amazon:   AmazonOrderCounts;
  flipkart: FlipkartOrderCounts;
  iavIn:    { iavIn: number; iavCom: number; myntra: number };
  busy:     ChannelMap<SalesBusyOrderCounts>;
}

// ── 9A: Orders sheet ──────────────────────────────────────────────────────

/** One channel column in the orders sheet */
export interface OrdersChannelCol {
  orders: number;
  units:  number;
  /** percentage relative to total orders for that channel (0–100) */
  pct:    number;
}

/** One row in the orders sheet */
export interface OrdersSheetRow {
  label:        string;
  total:        OrdersChannelCol;
  amazon:       OrdersChannelCol;
  flipkart:     OrdersChannelCol;
  myntra:       OrdersChannelCol;
  iavIn:        OrdersChannelCol;
  bulkDomestic: OrdersChannelCol;
  iavCom:       OrdersChannelCol;
  bulkExport:   OrdersChannelCol;
}

/** Full orders sheet produced by computeOrdersSheet() */
export interface OrdersSheet {
  rows:           OrdersSheetRow[];   // TOTAL_ORDERS, CANCELLED, FREE_REPLACEMENT, NET_ORDERS, RETURNS, SUCCESSFUL
  returnBreakdown: {
    courierReturn:  OrdersChannelCol;
    customerReturn: OrdersChannelCol;
    totalReturn:    OrdersChannelCol;
  };
}

// ── 9B: KPI / % sheet ─────────────────────────────────────────────────────

/** One channel column in the KPI sheet — values are 0–100 or absolute Rs */
export interface KPIChannelCol {
  shareInNetSale:      number;   // %
  advertisement:       number;   // % of netSales
  inboundTransport:    number;   // %
  commission:          number;   // %
  paymentGateway:      number;   // %
  shippingCourier:     number;   // %
  storage:             number;   // %
  exchangeDiff:        number;   // %
  subscription:        number;   // %
  employeeBenefit:     number;   // %
  totalExpPct:         number;   // sum of above %
  marginPct:           number;   // 1 – totalExpPct (contribution margin concept)
  salesRs:             number;   // absolute net sales
  marginRs:            number;   // absolute margin amount
  salesCancellationPct: number;  // |cancellations| / grossSales %
  salesReturnPct:      number;   // |returns| / grossSales %
  discountPct:         number;   // |discounts| / grossSales %
}

export interface KPISheet {
  month:         string;
  groupMarginPct: number;   // total margin across all included channels
  byChannel: Partial<Record<Channel, KPIChannelCol>>;
}

// ── 9C: Amazon statewise P&L ──────────────────────────────────────────────

/** The 9 states tracked in the statewise P&L */
export type AmazonStateKey =
  | 'RAJASTHAN' | 'GUJARAT' | 'HARYANA' | 'WEST BENGAL'
  | 'TAMIL NADU' | 'TELANGANA' | 'UTTAR PRADESH'
  | 'MAHARASHTRA' | 'KARNATAKA';

/** Full P&L for one state (or TOTAL column) */
export interface AmazonStatewisePLRow {
  state:                 string;
  grossSales:            number;
  cancellations:         number;
  courierReturns:        number;
  customerReturns:       number;
  totalReturns:          number;
  salesAfterReturn:      number;
  shippingReceived:      number;
  giftWrap:              number;
  discounts:             number;
  netSales:              number;
  shareInNetSalePct:     number;   // state netSales / total amazon netSales × 100
  totalCOGS:             number;   // apportioned by share
  contribution:          number;   // netSales - totalCOGS
  // Direct expenses from AMAZON EXP SHEET
  advertisement:         number;
  inboundTransport:      number;
  commission:            number;
  shippingCourier:       number;
  storage:               number;
  employeeBenefit:       number;
  totalDirectExp:        number;
  earningsBeforeAlloc:   number;   // contribution - totalDirectExp
  // Allocated expenses (proportionally distributed)
  allocatedExp:          number;
  ebit:                  number;   // earningsBeforeAlloc - allocatedExp
  interestExp:           number;   // apportioned share of total interest
  ebt:                   number;   // ebit - interestExp
}

/** Full Amazon statewise P&L output */
export interface AmazonStatewisePL {
  states:      AmazonStatewisePLRow[];   // 9 state rows
  total:       AmazonStatewisePLRow;     // AMAZON.IN total column
}
