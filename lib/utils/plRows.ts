// Pure client-safe helper — no mongoose / server-only imports.
import type { PLOutput, PLRow } from '../types';

export interface PLSection {
  heading: string;
  rows: PLRow[];
}

/** Full P&L split into labelled sections — used by Comparative page */
export function plOutputToSections(pl: PLOutput): PLSection[] {
  return [
    {
      heading: 'Revenue',
      rows: [pl.grossSales, pl.cancellations, pl.courierReturns, pl.customerReturns, pl.shippingReceived, pl.netSales],
    },
    {
      heading: 'Cost of Goods Sold',
      rows: [pl.openingStock, pl.purchases, pl.closingStock, pl.packingMaterial, pl.freightInward, pl.cogs],
    },
    {
      heading: 'Gross Profit',
      rows: [pl.grossProfit],
    },
    {
      heading: 'Expenses',
      rows: [pl.totalDirectExp, pl.totalAllocatedExp],
    },
    {
      heading: 'Net Profit',
      rows: [pl.netProfit],
    },
  ];
}

/** Revenue section only — used by Orders page */
export function plOutputToOrderRows(pl: PLOutput): PLSection[] {
  return [
    {
      heading: 'Order Flow',
      rows: [pl.grossSales, pl.cancellations, pl.courierReturns, pl.customerReturns, pl.shippingReceived, pl.netSales],
    },
  ];
}

/** Flat list (legacy) */
export function plOutputToRows(pl: PLOutput): PLRow[] {
  return plOutputToSections(pl).flatMap(s => s.rows);
}
