'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOutputStore, useOrdersSheet } from '@/store/outputStore';
import type { OrdersSheet, OrdersChannelCol, OrdersSheetRow } from '@/lib/types';

const fmtN = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

type ColKey = 'total' | 'amazon' | 'flipkart' | 'myntra' | 'iavIn' | 'bulkDomestic' | 'iavCom' | 'bulkExport';

const COLS: { key: ColKey; label: string }[] = [
  { key: 'total', label: 'TOTAL' },
  { key: 'amazon', label: 'AMAZON' },
  { key: 'flipkart', label: 'FLIPKART' },
  { key: 'myntra', label: 'MYNTRA' },
  { key: 'iavIn', label: 'INDIANARTVILLA.IN' },
  { key: 'bulkDomestic', label: 'BULK DOMESTIC' },
  { key: 'iavCom', label: 'INDIANARTVILLA.COM' },
  { key: 'bulkExport', label: 'BULK EXPORT' },
];

const HDR = 'px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase whitespace-nowrap';
const CELL = 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-gray-700 text-xs';

function ColHeader({ label }: { label: string }) {
  return (
    <th colSpan={3} className="px-2 py-2 text-center text-xs font-semibold text-gray-600 uppercase border-l border-gray-200 whitespace-nowrap">
      {label}
    </th>
  );
}

function CellGroup({ col, highlight }: { col: OrdersChannelCol; highlight?: boolean }) {
  const cls = highlight ? `${CELL} font-semibold text-blue-900` : CELL;
  return (
    <>
      <td className={`${cls} border-l border-gray-100`}>{fmtN(col.orders)}</td>
      <td className={cls}>{fmtN(col.units)}</td>
      <td className={`${cls} text-blue-600`}>{fmtPct(col.pct)}</td>
    </>
  );
}

function OrdersTable({ sheet }: { sheet: OrdersSheet }) {
  const isHighlight = (label: string) =>
    label === 'NET ORDERS' || label === 'SUCCESSFULL DELIVERED ORDER';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="border-b-2 border-gray-200 bg-gray-50">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap min-w-[220px]">
                Particulars
              </th>
              {COLS.map(col => <ColHeader key={col.key} label={col.label} />)}
            </tr>
            <tr className="bg-gray-50/80 border-b border-gray-200">
              <th className="sticky left-0 z-20 bg-gray-50 px-4 py-1" />
              {COLS.map(col => (
                <React.Fragment key={col.key}>
                  <th className={`${HDR} border-l border-gray-100`}>Orders</th>
                  <th className={HDR}>Units</th>
                  <th className={HDR}>%</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sheet.rows.map((row: OrdersSheetRow, i: number) => {
              const hl = isHighlight(row.label);
              return (
                <tr key={i} className={hl ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}>
                  <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 ${hl ? 'bg-blue-50 font-semibold text-blue-900' : 'bg-white text-gray-800'}`}>
                    {row.label}
                  </td>
                  {COLS.map(col => <CellGroup key={col.key} col={row[col.key]} highlight={hl} />)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoData() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-gray-500 text-sm">No orders data loaded.</p>
        <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
      </div>
    </main>
  );
}

export default function OrdersPage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedSheet = useOrdersSheet();

  const [sheet, setSheet] = useState<OrdersSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedSheet) {
      setSheet(cachedSheet);
      return;
    }
    if (!uploadId) return;

    setLoading(true);
    setError(null);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}.`);
        return r.json();
      })
      .then(data => {
        if (data.ordersSheet?.rows?.length) {
          setSheet(data.ordersSheet as OrdersSheet);
          setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
            ordersSheet: data.ordersSheet,
            kpiSheet: data.kpiSheet,
          });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const active = cachedSheet ?? sheet;

  if (!uploadId && !active) return <NoData />;

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 text-sm">{error}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  if (!active) return <NoData />;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Orders</h1>
            <p className="text-sm text-gray-500 mt-0.5">Total no. of orders and units sold</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <OrdersTable sheet={active} />
      </div>
    </main>
  );
}
