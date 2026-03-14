'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOutputStore, useAmazonStatewisePL } from '@/store/outputStore';
import type { AmazonStatewisePL, AmazonStatewisePLRow } from '@/lib/types';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

interface MetricRow {
  label: string;
  key: keyof AmazonStatewisePLRow;
  isPct?: boolean;
  section?: 'divider';
}

const METRIC_ROWS: MetricRow[] = [
  { label: 'Gross Sales', key: 'grossSales' },
  { label: 'Less: Sales Cancellation', key: 'cancellations' },
  { label: 'Less: Sales Return', key: 'totalReturns' },
  { label: '1). Courier Return', key: 'courierReturns' },
  { label: '2). Customer Return', key: 'customerReturns' },
  { label: 'Sales After Return', key: 'salesAfterReturn' },
  { label: 'Add:- Other Amount Received (Net)', key: 'shippingReceived', section: 'divider' },
  { label: 'Shipping Amount Received', key: 'shippingReceived' },
  { label: 'Gift Wrap/COD Charges Received', key: 'giftWrap' },
  { label: 'Less:- Discount (Incl. Shipping & Item Promo)/Free Sample', key: 'discounts' },
  { label: 'Net Sale (In Amount ) {A}', key: 'netSales' },
  { label: 'Share In Net Sale (In%)', key: 'shareInNetSalePct', isPct: true },
  { label: 'Total COGS {B}', key: 'totalCOGS' },
  { label: 'Contribution {C}:={A}-{B}', key: 'contribution' },
  { label: 'Less:- Advertisement Exp', key: 'advertisement' },
  { label: 'Inbound Transportation Fee', key: 'inboundTransport' },
  { label: 'Commission Exp', key: 'commission' },
  { label: 'Shipping Exp / Courier Exp', key: 'shippingCourier' },
  { label: 'Storage Exp', key: 'storage' },
  { label: 'Employee Benefit Exp', key: 'employeeBenefit' },
  { label: 'Total Direct Exp', key: 'totalDirectExp' },
  { label: 'Earnings Before Alloc Exp', key: 'earningsBeforeAlloc' },
  { label: 'Allocated Exp', key: 'allocatedExp' },
  { label: 'EBIT', key: 'ebit' },
  { label: 'Interest', key: 'interestExp' },
  { label: 'EBT', key: 'ebt' },
];

export default function StatewisePage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedSheet = useAmazonStatewisePL();

  const [sheet, setSheet] = useState<AmazonStatewisePL | null>(null);
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
        if (data.amazonStatewisePL?.states?.length) {
          setSheet(data.amazonStatewisePL as AmazonStatewisePL);
          setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
            amazonStatewisePL: data.amazonStatewisePL,
          });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load statewise data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const active = cachedSheet ?? sheet;

  if (!uploadId && !active) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No statewise data loaded.</p>
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
          <p className="text-red-600 text-sm">{error ?? 'No Amazon statewise data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  const states = active.states;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[2200px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Amazon Statewise</h1>
            <p className="text-sm text-gray-500 mt-0.5">State-wise profitability view</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[360px]">
                    Particulars
                  </th>
                  {states.map(s => (
                    <th key={s.state} className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">
                      {s.state}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">
                    AMAZON.IN
                  </th>
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((metric, idx) => (
                  <tr key={metric.label} className={`${idx === 6 ? 'border-t-2 border-amber-300' : 'border-b border-gray-100'} hover:bg-gray-50`}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">
                      {metric.label}
                    </td>

                    {states.map(s => {
                      const val = Number(s[metric.key] ?? 0);
                      const display = metric.isPct ? fmtPct(val) : `₹${fmtINR(val)}`;
                      const color = val < 0 ? 'text-red-600' : metric.key === 'netSales' || metric.key === 'ebt' || metric.key === 'contribution' ? 'text-emerald-600 font-medium' : 'text-gray-700';
                      return (
                        <td key={`${metric.key}-${s.state}`} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${color}`}>
                          {display}
                        </td>
                      );
                    })}

                    {(() => {
                      const val = Number(active.total[metric.key] ?? 0);
                      const display = metric.isPct ? fmtPct(val) : `₹${fmtINR(val)}`;
                      const color = val < 0 ? 'text-red-600' : metric.key === 'netSales' || metric.key === 'ebt' || metric.key === 'contribution' ? 'text-emerald-600 font-semibold' : 'text-gray-800 font-medium';
                      return <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${color}`}>{display}</td>;
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

