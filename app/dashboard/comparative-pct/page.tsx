'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useOutputStore, useKPISheet } from '@/store/outputStore';
import type { KPIChannelCol, KPISheet, PLOutput } from '@/lib/types';

const fmtPct = (n: number) => `${n.toFixed(2)}%`;

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

interface UploadItem {
  _id: string;
}

interface RowDef {
  key: keyof KPIChannelCol | 'cogsAvg';
  label: string;
}

const ROWS: RowDef[] = [
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
];

function getCogsAvg(pl: PLOutput | null): number {
  if (!pl || pl.netSales.total === 0) return 0;
  return (pl.cogs.total / pl.netSales.total) * 100;
}

export default function ComparativePctPage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedKpi = useKPISheet();
  const cachedPl = useOutputStore(s => s.cachedPL);

  const [currentKpi, setCurrentKpi] = useState<KPISheet | null>(null);
  const [currentPl, setCurrentPl] = useState<PLOutput | null>(null);
  const [previousKpi, setPreviousKpi] = useState<KPISheet | null>(null);
  const [previousPl, setPreviousPl] = useState<PLOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let currentData: { kpiSheet?: KPISheet; data?: PLOutput; month?: string } | null = null;

        if (cachedKpi && cachedPl) {
          setCurrentKpi(cachedKpi);
          setCurrentPl(cachedPl);
          currentData = { kpiSheet: cachedKpi, data: cachedPl, month: cachedKpi.month };
        } else {
          const currentRes = await fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`);
          if (!currentRes.ok) throw new Error(`Server returned ${currentRes.status}.`);
          const current = await currentRes.json();
          setCurrentKpi(current.kpiSheet ?? null);
          setCurrentPl(current.data ?? null);
          currentData = current;
          setUploadResult(current.uploadId, current.month, current.data, current.processingErrors ?? [], {
            kpiSheet: current.kpiSheet,
            ordersSheet: current.ordersSheet,
          });
        }

        const uploadsRes = await fetch('/api/uploads');
        if (!uploadsRes.ok) {
          setPreviousKpi(null);
          setPreviousPl(null);
          return;
        }
        const uploadsJson = await uploadsRes.json();
        const uploads: UploadItem[] = uploadsJson.uploads ?? [];

        const currentIndex = uploads.findIndex(u => u._id === uploadId);
        const prevId = currentIndex >= 0 ? uploads[currentIndex + 1]?._id : uploads[1]?._id;

        if (!prevId) {
          setPreviousKpi(null);
          setPreviousPl(null);
          return;
        }

        const prevRes = await fetch(`/api/pl?uploadId=${encodeURIComponent(prevId)}`);
        if (!prevRes.ok) {
          setPreviousKpi(null);
          setPreviousPl(null);
          return;
        }
        const prev = await prevRes.json();
        setPreviousKpi(prev.kpiSheet ?? null);
        setPreviousPl(prev.data ?? null);

        // keep current data defined for lints and future logic
        void currentData;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load comparative % data.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const activeCurrentKpi = cachedKpi ?? currentKpi;
  const activeCurrentPl = cachedPl ?? currentPl;

  const hasPrevious = !!previousKpi;

  const activeCols = useMemo(
    () => KPI_CHANNELS.filter(ch => (activeCurrentKpi?.byChannel[ch]?.salesRs ?? 0) > 0 || (previousKpi?.byChannel[ch]?.salesRs ?? 0) > 0),
    [activeCurrentKpi, previousKpi],
  );

  if (!uploadId && !activeCurrentKpi) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No comparative % data loaded.</p>
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

  if (error || !activeCurrentKpi) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 text-sm">{error ?? 'No comparative % data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  const prevLabel = previousKpi?.month ?? 'Previous';
  const currLabel = activeCurrentKpi.month ?? 'Current';
  const prevCogs = getCogsAvg(previousPl);
  const currCogs = getCogsAvg(activeCurrentPl);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[2200px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Comparative %</h1>
            <p className="text-sm text-gray-500 mt-0.5">{hasPrevious ? `${prevLabel} vs ${currLabel}` : `${currLabel} (previous month not available)`}</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[340px]">
                    Particulars
                  </th>
                  {activeCols.map(ch => (
                    <th key={ch} colSpan={hasPrevious ? 2 : 1} className="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase border-l border-gray-200 whitespace-nowrap">
                      {COL_LABELS[ch]}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 px-4 py-1" />
                  {activeCols.map(ch => (
                    <Fragment key={ch}>
                      {hasPrevious && (
                        <th key={`${ch}-prev`} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase whitespace-nowrap border-l border-gray-100">
                          {prevLabel}
                        </th>
                      )}
                      <th key={`${ch}-curr`} className="px-3 py-2 text-right text-xs font-semibold text-blue-600 uppercase whitespace-nowrap border-l border-gray-100">
                        {currLabel}
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, rowIdx) => (
                  <tr key={row.key} className={rowIdx === 11 ? 'border-t-2 border-amber-300 bg-white hover:bg-gray-50' : 'border-b border-gray-100 bg-white hover:bg-gray-50'}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">{row.label}</td>
                    {activeCols.map(ch => {
                      const prevVal = row.key === 'cogsAvg'
                        ? prevCogs
                        : ((previousKpi?.byChannel[ch]?.[row.key as keyof KPIChannelCol] as number | undefined) ?? 0);
                      const currVal = row.key === 'cogsAvg'
                        ? currCogs
                        : ((activeCurrentKpi.byChannel[ch]?.[row.key as keyof KPIChannelCol] as number | undefined) ?? 0);

                      return (
                        <Fragment key={`${row.key}-${ch}`}>
                          {hasPrevious && (
                            <td key={`${row.key}-${ch}-prev`} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-gray-100 ${prevVal < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                              {fmtPct(prevVal)}
                            </td>
                          )}
                          <td key={`${row.key}-${ch}-curr`} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-gray-100 ${currVal < 0 ? 'text-red-600' : row.key === 'marginPct' ? 'text-emerald-600 font-medium' : 'text-blue-600'}`}>
                            {fmtPct(currVal)}
                          </td>
                        </Fragment>
                      );
                    })}
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
