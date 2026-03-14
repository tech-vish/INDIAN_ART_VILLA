/**
 * outputSheets.ts
 *
 * Three final output-sheet builders:
 *   9A  computeOrdersSheet()        — multi-channel orders/units summary
 *   9B  computeKPISheet()           — channel KPI / percentage sheet
 *   9C  computeAmazonStatewisePL()  — Amazon 9-state full P&L
 */

import type {
  Channel, PLOutput,
  AmazonResult, FlipkartResult, IavInResult, SalesBusyResult,
  AmazonExpSheet,
  OrdersSheet, OrdersChannelCol, OrdersSheetRow,
  KPISheet, KPIChannelCol,
  AmazonStatewisePL, AmazonStatewisePLRow, AmazonStateKey,
} from '../types';

// ── 9A: Orders Sheet ──────────────────────────────────────────────────────

const ZERO_COL: OrdersChannelCol = { orders: 0, units: 0, pct: 0 };

function mkCol(orders: number, units: number, totalOrders: number): OrdersChannelCol {
  return {
    orders,
    units,
    pct: totalOrders > 0 ? (orders / totalOrders) * 100 : 0,
  };
}

function mkColPct(orders: number, units: number, pctBase: number): OrdersChannelCol {
  return {
    orders,
    units,
    pct: pctBase > 0 ? (orders / pctBase) * 100 : 0,
  };
}

function sumCol(cols: OrdersChannelCol[]): OrdersChannelCol {
  return {
    orders: cols.reduce((s, c) => s + c.orders, 0),
    units:  cols.reduce((s, c) => s + c.units,  0),
    pct:    0, // recalculated at row level
  };
}

/** Build one row of the orders sheet */
function mkRow(
  label: string,
  perChannel: { amazon: OrdersChannelCol; flipkart: OrdersChannelCol; myntra: OrdersChannelCol; iavIn: OrdersChannelCol; bulkDomestic: OrdersChannelCol; iavCom: OrdersChannelCol; bulkExport: OrdersChannelCol },
  totalOrdersForPct: number,
): OrdersSheetRow {
  const cols = [
    perChannel.amazon, perChannel.flipkart, perChannel.myntra,
    perChannel.iavIn, perChannel.bulkDomestic, perChannel.iavCom, perChannel.bulkExport,
  ];
  const totalOrders = cols.reduce((s, c) => s + c.orders, 0);
  const totalUnits  = cols.reduce((s, c) => s + c.units,  0);
  const total: OrdersChannelCol = {
    orders: totalOrders,
    units:  totalUnits,
    pct:    totalOrdersForPct > 0 ? (totalOrders / totalOrdersForPct) * 100 : 0,
  };
  return { label, total, ...perChannel };
}

/**
 * 9A — build the full orders sheet from processor results.
 */
export function computeOrdersSheet(
  amazonResult:    AmazonResult,
  flipkartResult:  FlipkartResult,
  iavInResult:     IavInResult,
  salesBusyResult: SalesBusyResult,
): OrdersSheet {
  const amzO  = amazonResult.orders;
  const fkO   = flipkartResult.orders;
  const iavO  = iavInResult.orders;
  const busyO = salesBusyResult.orders;

  // ── TOTAL ORDERS ──────────────────────────────────────────────────────
  const amzTotal  = amzO.totalOrders;
  const fkTotal   = fkO.totalOrders;
  const myTotal   = iavO.myntra;
  const iavTotal  = iavO.iavIn;
  const bdTotal   = busyO['BULK_DOMESTIC']?.saleOrders ?? 0;
  const iavComTot = iavO.iavCom;
  const beTotal   = busyO['BULK_EXPORT']?.saleOrders ?? 0;

  // units: Amazon tracks units distinctly; others we default orders = units
  const amzTotalUnits  = amzO.totalUnits;
  const fkTotalUnits   = fkO.totalUnits;
  const myTotalUnits   = iavO.myntra;   // orders == units for Tally-based channels
  const iavTotalUnits  = iavO.iavIn;
  const bdTotalUnits   = busyO['BULK_DOMESTIC']?.saleOrders ?? 0;
  const iavComTotUnits = iavO.iavCom;
  const beTotalUnits   = busyO['BULK_EXPORT']?.saleOrders ?? 0;

  const grandTotal =
    amzTotal + fkTotal + myTotal + iavTotal + bdTotal + iavComTot + beTotal;

  const totalOrdersRow = mkRow(
    'TOTAL ORDERS',
    {
      amazon:       mkColPct(amzTotal,   amzTotalUnits,   grandTotal),
      flipkart:     mkColPct(fkTotal,    fkTotalUnits,    grandTotal),
      myntra:       mkColPct(myTotal,    myTotalUnits,    grandTotal),
      iavIn:        mkColPct(iavTotal,   iavTotalUnits,   grandTotal),
      bulkDomestic: mkColPct(bdTotal,    bdTotalUnits,    grandTotal),
      iavCom:       mkColPct(iavComTot,  iavComTotUnits,  grandTotal),
      bulkExport:   mkColPct(beTotal,    beTotalUnits,    grandTotal),
    },
    grandTotal,
  );

  // ── CANCELLED ORDERS ─────────────────────────────────────────────────
  const amzCancel   = amzO.cancelledOrders;
  const fkCancel    = fkO.cancelledOrders;
  // Myntra / IAV / Busy channels: Tally-based, no separate cancel sheet — treat as 0
  const cancelledRow = mkRow(
    'LESS:- CANCELED ORDERS',
    {
      amazon:       mkColPct(amzCancel,  amzO.cancelledUnits, grandTotal),
      flipkart:     mkColPct(fkCancel,   fkO.cancelledUnits,  grandTotal),
      myntra:       { ...ZERO_COL },
      iavIn:        { ...ZERO_COL },
      bulkDomestic: { ...ZERO_COL },
      iavCom:       { ...ZERO_COL },
      bulkExport:   { ...ZERO_COL },
    },
    grandTotal,
  );

  // ── FREE REPLACEMENT ORDERS ──────────────────────────────────────────
  const amzFreeReplace = amzO.freeReplacementOrders;
  const freeReplacementRow = mkRow(
    'LESS:- FREE REPLACEMENT ORDERS',
    {
      amazon:       mkColPct(amzFreeReplace, amzFreeReplace, grandTotal),
      flipkart:     { ...ZERO_COL },
      myntra:       { ...ZERO_COL },
      iavIn:        { ...ZERO_COL },
      bulkDomestic: { ...ZERO_COL },
      iavCom:       { ...ZERO_COL },
      bulkExport:   { ...ZERO_COL },
    },
    grandTotal,
  );

  // ── NET ORDERS ────────────────────────────────────────────────────────
  const amzNet   = amzTotal   - amzCancel  - amzFreeReplace;
  const fkNet    = fkTotal    - fkCancel;
  const myNet    = myTotal;
  const iavNet   = iavTotal;
  const bdNet    = bdTotal;
  const iavComNet = iavComTot;
  const beNet    = beTotal;

  const amzNetUnits   = amzO.totalUnits  - amzO.cancelledUnits;
  const fkNetUnits    = fkO.totalUnits   - fkO.cancelledUnits;

  const netOrdersRow = mkRow(
    'NET ORDERS',
    {
      amazon:       mkColPct(amzNet,    amzNetUnits,  grandTotal),
      flipkart:     mkColPct(fkNet,     fkNetUnits,   grandTotal),
      myntra:       mkColPct(myNet,     myNet,        grandTotal),
      iavIn:        mkColPct(iavNet,    iavNet,       grandTotal),
      bulkDomestic: mkColPct(bdNet,     bdNet,        grandTotal),
      iavCom:       mkColPct(iavComNet, iavComNet,    grandTotal),
      bulkExport:   mkColPct(beNet,     beNet,        grandTotal),
    },
    grandTotal,
  );

  // ── RETURN ORDERS ─────────────────────────────────────────────────────
  const amzCourierRet  = amzO.fbaReturnOrders;
  const amzCustomerRet = amzO.merchantReturnOrders;
  const amzTotalRet    = amzCourierRet + amzCustomerRet;
  const amzRetUnits    = amzO.fbaReturnUnits + amzO.merchantReturnUnits;

  const fkCourierRet   = flipkartResult.returnClassification.courier;
  const fkCustomerRet  = flipkartResult.returnClassification.customer;
  const fkTotalRet     = fkO.returnOrders;
  const fkRetUnits     = fkO.returnUnits;

  // Myntra / IAV_IN return orders come from order counts
  const myRet  = 0;  // not separately tracked at order-count level for Myntra
  const iavRet = 0;

  const returnOrdersRow = mkRow(
    'LESS:- RETURN ORDERS',
    {
      amazon:       mkColPct(amzTotalRet, amzRetUnits, grandTotal),
      flipkart:     mkColPct(fkTotalRet,  fkRetUnits,  grandTotal),
      myntra:       mkColPct(myRet,  myRet,  grandTotal),
      iavIn:        mkColPct(iavRet, iavRet, grandTotal),
      bulkDomestic: { ...ZERO_COL },
      iavCom:       { ...ZERO_COL },
      bulkExport:   { ...ZERO_COL },
    },
    grandTotal,
  );

  // ── SUCCESSFULLY DELIVERED ────────────────────────────────────────────
  const amzSuccess = amzNet    - amzTotalRet;
  const fkSuccess  = fkNet     - fkTotalRet;
  const deliveredRow = mkRow(
    'SUCCESSFULL DELIVERED ORDER',
    {
      amazon:       mkColPct(amzSuccess, amzNetUnits - amzRetUnits, grandTotal),
      flipkart:     mkColPct(fkSuccess,  fkNetUnits  - fkRetUnits,  grandTotal),
      myntra:       mkColPct(myNet,  myNet,  grandTotal),
      iavIn:        mkColPct(iavNet, iavNet, grandTotal),
      bulkDomestic: mkColPct(bdNet,  bdNet,  grandTotal),
      iavCom:       mkColPct(iavComNet, iavComNet, grandTotal),
      bulkExport:   mkColPct(beNet,  beNet,  grandTotal),
    },
    grandTotal,
  );

  // ── RETURN BREAKDOWN ─────────────────────────────────────────────────
  const totalCourierOrders  = amzCourierRet + fkCourierRet;
  const totalCustomerOrders = amzCustomerRet + fkCustomerRet;
  const totalReturnOrders   = totalCourierOrders + totalCustomerOrders;
  const totalReturnUnits    = amzRetUnits + fkRetUnits;

  const courierReturnCol: OrdersChannelCol = {
    orders: totalCourierOrders,
    units:  amzO.fbaReturnUnits,         // best proxy we have
    pct:    totalReturnOrders > 0 ? (totalCourierOrders / totalReturnOrders) * 100 : 0,
  };
  const customerReturnCol: OrdersChannelCol = {
    orders: totalCustomerOrders,
    units:  amzO.merchantReturnUnits,
    pct:    totalReturnOrders > 0 ? (totalCustomerOrders / totalReturnOrders) * 100 : 0,
  };
  const totalReturnCol: OrdersChannelCol = {
    orders: totalReturnOrders,
    units:  totalReturnUnits,
    pct:    grandTotal > 0 ? (totalReturnOrders / grandTotal) * 100 : 0,
  };

  return {
    rows: [
      totalOrdersRow,
      cancelledRow,
      freeReplacementRow,
      netOrdersRow,
      returnOrdersRow,
      deliveredRow,
    ],
    returnBreakdown: {
      courierReturn:  courierReturnCol,
      customerReturn: customerReturnCol,
      totalReturn:    totalReturnCol,
    },
  };
}

// ── 9B: KPI Sheet ─────────────────────────────────────────────────────────

/** Channels included in the KPI sheet (excl. MEESHO and SHOWROOM per workbook) */
const KPI_CHANNELS: Channel[] = [
  'AMAZON', 'FLIPKART', 'MYNTRA', 'IAV_IN', 'BULK_DOMESTIC', 'IAV_COM', 'BULK_EXPORT',
];

function safeDiv(num: number, den: number): number {
  return den !== 0 ? (num / den) * 100 : 0;
}

/**
 * 9B — build the KPI / percentage sheet from PLOutput.
 */
export function computeKPISheet(pl: PLOutput): KPISheet {
  const totalNetSales = pl.netSales.total;

  const byChannel: Partial<Record<Channel, KPIChannelCol>> = {};

  for (const ch of KPI_CHANNELS) {
    const netSales     = pl.netSales.byChannel[ch]    ?? 0;
    const grossSales   = pl.grossSales.byChannel[ch]  ?? 0;
    const cancels      = Math.abs(pl.cancellations.byChannel[ch]   ?? 0);
    const courierRet   = Math.abs(pl.courierReturns.byChannel[ch]  ?? 0);
    const customerRet  = Math.abs(pl.customerReturns.byChannel[ch] ?? 0);
    const totalReturns = courierRet + customerRet;

    // Find allocated expense by keyword match for this channel
    const getExp = (kwds: string[]): number => {
      const total = pl.expenses
        .filter(e => kwds.some(k => e.particulars.toLowerCase().includes(k)))
        .reduce((s, e) => s + (e.allocated[ch] ?? 0), 0);
      return total;
    };

    const advertisement   = getExp(['advertisement', 'sponsored', 'ads']);
    const inboundTransport = getExp(['inbound transport', 'inbound']);
    const commission      = getExp(['commission', 'selling fee', 'referral']);
    const paymentGateway  = getExp(['payment gateway', 'payment fee']);
    const shippingCourier = getExp(['shipping', 'courier', 'fba', 'fulfil']);
    const storage         = getExp(['storage', 'inventory']);
    const exchangeDiff    = getExp(['exchange', 'forex']);
    const subscription    = getExp(['subscription']);
    const employeeBenefit = getExp(['employee benefit', 'salary', 'esic', 'pf']);

    const totalExp = advertisement + inboundTransport + commission + paymentGateway
                   + shippingCourier + storage + exchangeDiff + subscription + employeeBenefit;

    // Direct + allocated expenses for the channel
    const totalDirectExp    = pl.totalDirectExp.byChannel[ch]    ?? 0;
    const totalAllocatedExp = pl.totalAllocatedExp.byChannel[ch] ?? 0;
    const fullTotalExp      = totalDirectExp + totalAllocatedExp;

    const marginRs  = netSales - fullTotalExp;

    byChannel[ch] = {
      shareInNetSale:       safeDiv(netSales, totalNetSales),
      advertisement:        safeDiv(advertisement,    netSales),
      inboundTransport:     safeDiv(inboundTransport, netSales),
      commission:           safeDiv(commission,       netSales),
      paymentGateway:       safeDiv(paymentGateway,   netSales),
      shippingCourier:      safeDiv(shippingCourier,  netSales),
      storage:              safeDiv(storage,           netSales),
      exchangeDiff:         safeDiv(exchangeDiff,      netSales),
      subscription:         safeDiv(subscription,      netSales),
      employeeBenefit:      safeDiv(employeeBenefit,   netSales),
      totalExpPct:          safeDiv(fullTotalExp, netSales),
      marginPct:            netSales !== 0 ? safeDiv(marginRs, netSales) : 0,
      salesRs:              netSales,
      marginRs,
      salesCancellationPct: safeDiv(cancels,      grossSales),
      salesReturnPct:       safeDiv(totalReturns, grossSales),
      discountPct:          safeDiv(Math.abs(pl.expenses
        .filter(e => e.particulars.toLowerCase().includes('discount'))
        .reduce((s, e) => s + (e.allocated[ch] ?? 0), 0)), grossSales),
    };
  }

  // Group margin
  const totalMarginRs = KPI_CHANNELS.reduce((s, ch) => s + (byChannel[ch]?.marginRs ?? 0), 0);
  const groupMarginPct = safeDiv(totalMarginRs, totalNetSales);

  return { month: pl.month, groupMarginPct, byChannel };
}

// ── 9C: Amazon Statewise P&L ──────────────────────────────────────────────

const TRACKED_STATES: AmazonStateKey[] = [
  'RAJASTHAN', 'GUJARAT', 'HARYANA', 'WEST BENGAL',
  'TAMIL NADU', 'TELANGANA', 'UTTAR PRADESH', 'MAHARASHTRA', 'KARNATAKA',
];

/** Normalise state name for matching */
function normState(s: string): string {
  return s.trim().toUpperCase()
    .replace(/\bRAJASTHAN\b/, 'RAJASTHAN')
    .replace(/\bGUJARAT\b/, 'GUJARAT')
    .replace(/\bHARYANA\b/, 'HARYANA')
    .replace(/\bWEST BENGAL\b/, 'WEST BENGAL')
    .replace(/\bTAMIL ?NADU\b/, 'TAMIL NADU')
    .replace(/\bTELANGANA\b/, 'TELANGANA')
    .replace(/\bUTTAR ?PRADESH\b/, 'UTTAR PRADESH')
    .replace(/\bMAHARASHTRA\b/, 'MAHARASHTRA')
    .replace(/\bKARNATAKA\b/, 'KARNATAKA');
}

/**
 * Get the direct expense for a state+feeLabel from AmazonExpSheet.
 * Returns net (invoice - creditNote).
 */
function getStateExpense(
  expSheet: AmazonExpSheet,
  stateName: string,
  feeKeywords: string[],
): number {
  const norm = normState(stateName);
  let total  = 0;
  for (const feeRow of expSheet.fees) {
    const lbl = feeRow.feeLabel.toLowerCase();
    if (!feeKeywords.some(k => lbl.includes(k))) continue;
    // find matching state key in expSheet.states (case-insensitive)
    for (const stk of expSheet.states) {
      if (normState(stk) === norm) {
        const v = feeRow.byState[stk];
        if (v) total += v.net;
        break;
      }
    }
  }
  return total;
}

/**
 * 9C — build the Amazon 9-state full P&L.
 *
 * @param amazonResult   Full AmazonResult
 * @param pl             The assembled PLOutput for this period (for COGS and allocated exp)
 * @param interestExpense Total interest expense (from resolveInterestExpense)
 */
export function computeAmazonStatewisePL(
  amazonResult:    AmazonResult,
  pl:              PLOutput,
  interestExpense: number,
): AmazonStatewisePL {
  const expSheet      = amazonResult.expSheet;
  const summary       = amazonResult.summary;
  const totalNetSales = summary.netSales;

  // COGS for Amazon channel from PLOutput
  const ch              = 'AMAZON' as Channel;
  const openingStock    = pl.openingStock.byChannel[ch]    ?? 0;
  const purchases       = pl.purchases.byChannel[ch]       ?? 0;
  const closingStock    = pl.closingStock.byChannel[ch]    ?? 0;
  const packingMaterial = pl.packingMaterial.byChannel[ch] ?? 0;
  const freightInward   = pl.freightInward.byChannel[ch]   ?? 0;
  const totalCOGSAmazon = openingStock + purchases - closingStock + packingMaterial + freightInward;

  // Allocated expenses for Amazon channel
  const totalAllocatedExpAmazon = pl.totalAllocatedExp.byChannel[ch] ?? 0;

  // Build per-state data map from amazonResult.statewise
  const stateDataMap = new Map<string, typeof amazonResult.statewise[0]>();
  for (const row of amazonResult.statewise) {
    stateDataMap.set(normState(row.state), row);
  }

  // Build per-state cancellation/return from byState on summary
  const byStateSummary = summary.byState;

  const stateRows: AmazonStatewisePLRow[] = TRACKED_STATES.map(stateKey => {
    const stateData = stateDataMap.get(stateKey);

    // Gross sales etc. from statewise data (already in StatewisePL format)
    const grossSales      = stateData?.grossSales    ?? 0;
    const totalReturns    = stateData?.returns        ?? 0;
    const cancellations   = stateData?.cancellations  ?? 0;

    // Shipping / giftWrap / discounts from byState on AmazonSummary (if available)
    const summaryEntry = byStateSummary[stateKey] ?? byStateSummary[stateKey.toLowerCase()] ?? null;

    // Split returns into courier/customer proportionally from Amazon totals
    const totalAmazonReturns = summary.courierReturns + summary.customerReturns;
    const courierFrac  = totalAmazonReturns > 0 ? summary.courierReturns  / totalAmazonReturns : 0;
    const customerFrac = totalAmazonReturns > 0 ? summary.customerReturns / totalAmazonReturns : 0;
    const courierReturns  = totalReturns * courierFrac;
    const customerReturns = totalReturns * customerFrac;

    const netSales = stateData?.netSales ?? (grossSales - cancellations - totalReturns);
    const shareInNetSalePct = totalNetSales > 0 ? (netSales / totalNetSales) * 100 : 0;

    // COGS apportioned by share of net sales
    const totalCOGS = totalNetSales > 0
      ? (netSales / totalNetSales) * totalCOGSAmazon
      : 0;
    const contribution = netSales - totalCOGS;

    // Direct expenses from AMAZON EXP SHEET for this state
    const advertisement    = getStateExpense(expSheet, stateKey, ['advertisement', 'sponsored', 'ads']);
    const inboundTransport = getStateExpense(expSheet, stateKey, ['inbound transport', 'inbound']);
    const commission       = getStateExpense(expSheet, stateKey, ['commission', 'selling fee', 'referral']);
    const shippingCourier  = getStateExpense(expSheet, stateKey, ['shipping', 'courier', 'fba', 'weight handling', 'pick']);
    const storage          = getStateExpense(expSheet, stateKey, ['storage', 'inventory']);
    const employeeBenefit  = getStateExpense(expSheet, stateKey, ['employee benefit', 'salary', 'esic', 'pf']);
    const totalDirectExp   = advertisement + inboundTransport + commission + shippingCourier + storage + employeeBenefit;

    const earningsBeforeAlloc = contribution - totalDirectExp;

    // Allocated expenses apportioned by share of net sales
    const allocatedExp = totalNetSales > 0
      ? (netSales / totalNetSales) * totalAllocatedExpAmazon
      : 0;

    const ebit        = earningsBeforeAlloc - allocatedExp;
    const interestExp = totalNetSales > 0
      ? (netSales / totalNetSales) * interestExpense
      : 0;
    const ebt         = ebit - interestExp;

    return {
      state:               stateKey,
      grossSales,
      cancellations,
      courierReturns,
      customerReturns,
      totalReturns,
      salesAfterReturn:    grossSales - cancellations - totalReturns,
      shippingReceived:    0,   // AmazonSummary.byState does not track per-state shipping — use 0
      giftWrap:            0,
      discounts:           0,
      netSales,
      shareInNetSalePct,
      totalCOGS,
      contribution,
      advertisement,
      inboundTransport,
      commission,
      shippingCourier,
      storage,
      employeeBenefit,
      totalDirectExp,
      earningsBeforeAlloc,
      allocatedExp,
      ebit,
      interestExp,
      ebt,
    };
  });

  // TOTAL column = Amazon channel level
  const totalRow: AmazonStatewisePLRow = {
    state:               'AMAZON.IN TOTAL',
    grossSales:          summary.grossSales,
    cancellations:       summary.cancellations,
    courierReturns:      summary.courierReturns,
    customerReturns:     summary.customerReturns,
    totalReturns:        summary.courierReturns + summary.customerReturns,
    salesAfterReturn:    summary.grossSales - summary.cancellations - summary.totalReturns,
    shippingReceived:    summary.shippingReceived,
    giftWrap:            summary.giftWrap,
    discounts:           summary.discounts,
    netSales:            summary.netSales,
    shareInNetSalePct:   100,
    totalCOGS:           totalCOGSAmazon,
    contribution:        summary.netSales - totalCOGSAmazon,
    // direct exp totals from expSheet (total columns)
    advertisement:       expSheet.fees.find(f => f.feeLabel.toLowerCase().includes('advertisement') || f.feeLabel.toLowerCase().includes('sponsored'))?.totalNet ?? 0,
    inboundTransport:    expSheet.fees.find(f => f.feeLabel.toLowerCase().includes('inbound'))?.totalNet ?? 0,
    commission:          expSheet.fees.find(f => f.feeLabel.toLowerCase().includes('commission') || f.feeLabel.toLowerCase().includes('referral'))?.totalNet ?? 0,
    shippingCourier:     (expSheet.fees.filter(f => ['shipping', 'courier', 'fba', 'weight', 'pick'].some(k => f.feeLabel.toLowerCase().includes(k))).reduce((s, f) => s + f.totalNet, 0)),
    storage:             expSheet.fees.find(f => f.feeLabel.toLowerCase().includes('storage'))?.totalNet ?? 0,
    employeeBenefit:     pl.expenses.filter(e => ['employee benefit', 'salary', 'esic', 'pf'].some(k => e.particulars.toLowerCase().includes(k))).reduce((s, e) => s + (e.allocated[ch] ?? 0), 0),
    totalDirectExp:      pl.totalDirectExp.byChannel[ch] ?? 0,
    earningsBeforeAlloc: (summary.netSales - totalCOGSAmazon) - (pl.totalDirectExp.byChannel[ch] ?? 0),
    allocatedExp:        totalAllocatedExpAmazon,
    ebit:                (summary.netSales - totalCOGSAmazon) - (pl.totalDirectExp.byChannel[ch] ?? 0) - totalAllocatedExpAmazon,
    interestExp:         interestExpense,
    ebt:                 (summary.netSales - totalCOGSAmazon) - (pl.totalDirectExp.byChannel[ch] ?? 0) - totalAllocatedExpAmazon - interestExpense,
  };

  return { states: stateRows, total: totalRow };
}
