'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { useOutputStore, useKPISheet } from '@/store/outputStore';
import type { KPISheet, KPIChannelCol } from '@/lib/types';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

interface KPIRowDef {
  key: keyof KPIChannelCol | 'cogsAvg';
  label: string;
  isAbs?: boolean;
}

const KPI_ROWS: KPIRowDef[] = [
  { key: 'shareInNetSale', label: 'Share In Net Sale %' },
  { key: 'cogsAvg', label: 'Cost of Goods Sold (COGS) % (Avg)' },
  { key: 'advertisement', label: 'Advertisement Exp' },
  { key: 'inboundTransport', label: 'Inbound Transportation Fee' },
  { key: 'commission', label: 'Commission Exp' },
  { key: 'paymentGateway', label: 'Payment Gateway Commission' },
  { key: 'shippingCourier', label: 'Shipping Exp / Courier Exp' },
  { key: 'storage', label: 'Storage Exp' },
  { key: 'exchangeDiff', label: 'Exchange Diff' },
  { key: 'subscription', label: 'Subscription Exp (Amazon, Shopify & Etsy)' },
  { key: 'employeeBenefit', label: 'Employee Benefit Exp' },
  { key: 'totalExpPct', label: 'Total Exp %' },
  { key: 'marginPct', label: 'Margin %' },
  { key: 'salesRs', label: 'Sales (Rs.)', isAbs: true },
  { key: 'marginRs', label: 'Margin (Rs.)', isAbs: true },
  { key: 'salesCancellationPct', label: 'Cancellation %' },
  { key: 'salesReturnPct', label: 'Return %' },
  { key: 'discountPct', label: 'Discount %' },
];

type ColKey = 'AMAZON' | 'FLIPKART' | 'MYNTRA' | 'IAV_IN' | 'BULK_DOMESTIC' | 'IAV_COM' | 'BULK_EXPORT';
const KPI_CHANNELS: ColKey[] = ['AMAZON', 'FLIPKART', 'MYNTRA', 'IAV_IN', 'BULK_DOMESTIC', 'IAV_COM', 'BULK_EXPORT'];
const COL_LABELS: Record<ColKey, string> = {
  AMAZON: 'AMAZON.IN',
  FLIPKART: 'FLIPKART',
  MYNTRA: 'MYNTRA',
  IAV_IN: 'INDIAN ART VILLA.IN',
  BULK_DOMESTIC: 'BULK DOMESTIC',
  IAV_COM: 'INDIAN ART VILLA.COM',
  BULK_EXPORT: 'BULK EXPORT',
};

const HDR = 'px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap';
const CELL = 'px-3 py-2 text-right tabular-nums whitespace-nowrap text-sm';

function KPITable({ sheet, cogsAvgPct }: { sheet: KPISheet; cogsAvgPct: number }) {
  const activeCols = KPI_CHANNELS.filter(ch => (sheet.byChannel[ch]?.salesRs ?? 0) > 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="border-b-2 border-gray-200 bg-gray-50">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[340px]">
                Particulars
              </th>
              {activeCols.map(ch => (
                <th key={ch} className={HDR}>{COL_LABELS[ch]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KPI_ROWS.map((row, i) => (
              <Fragment key={row.key}>
                <tr className={i === 11 ? 'border-t-2 border-amber-300' : 'border-b border-gray-100 hover:bg-gray-50'}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">
                    {row.label}
                  </td>
                  {activeCols.map(ch => {
                    const col = sheet.byChannel[ch];
                    let val = 0;
                    if (row.key === 'cogsAvg') {
                      val = cogsAvgPct;
                    } else {
                      val = col ? (col[row.key] as number) : 0;
                    }
                    const display = row.isAbs ? `₹${fmtINR(val)}` : fmtPct(val);

                    return (
                      <td
                        key={`${row.key}-${ch}`}
                        className={`${CELL} ${
                          val < 0
                            ? 'text-red-600'
                            : row.key === 'marginPct' || row.key === 'salesRs' || row.key === 'marginRs'
                              ? 'text-emerald-600 font-medium'
                              : 'text-blue-600'
                        }`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function KpiPage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedSheet = useKPISheet();
  const cachedPL = useOutputStore(s => s.cachedPL);

  const [sheet, setSheet] = useState<KPISheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedSheet) {
      setSheet(cachedSheet);
      return;
    }
    if (!uploadId) return;

    setLoading(true);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}.`);
        return r.json();
      })
      .then(data => {
        if (data.kpiSheet?.byChannel) {
          setSheet(data.kpiSheet as KPISheet);
          setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
            kpiSheet: data.kpiSheet,
            ordersSheet: data.ordersSheet,
          });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const active = cachedSheet ?? sheet;
  const pl = cachedPL;
  const cogsAvgPct = pl && pl.netSales.total > 0 ? (pl.cogs.total / pl.netSales.total) * 100 : 0;

  if (!uploadId && !active) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No KPI data loaded.</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (error || !active) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 text-sm">{error ?? 'No KPI data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">% Analysis</h1>
            <p className="text-sm text-gray-500 mt-0.5">{active.month}</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <KPITable sheet={active} cogsAvgPct={cogsAvgPct} />
      </div>
    </main>
  );
}


