'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useOutputStore, useComparativePL } from '@/store/outputStore';
import type { ComparativePL, ComparativePLRow } from '@/lib/types';

// ── Formatters ────────────────────────────────────────────────────────────

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtChg = (n: number) => `${n > 0 ? '+' : ''}₹${fmtINR(Math.abs(n))}${n < 0 ? ' (↓)' : n > 0 ? ' (↑)' : ''}`;

// ── Comparison table ──────────────────────────────────────────────────────

function ComparisonTable({ comp }: { comp: ComparativePL }) {
  // Group rows: detect section headers (previous === 0 AND current === 0 AND change === 0 — label ends with ':')
  const isSectionHdr = (r: ComparativePLRow) => r.previous === 0 && r.current === 0 && r.change === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[220px]">
                Particulars
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {comp.previousLabel}
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">
                {comp.currentLabel}
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Change (₹)
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Change %
              </th>
            </tr>
          </thead>
          <tbody>
            {comp.rows.map((row, i) => (
              <Fragment key={i}>
                {isSectionHdr(row) ? (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="sticky left-0 z-10 bg-gray-50 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
                      {row.label}
                    </td>
                  </tr>
                ) : (
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">₹{fmtINR(row.previous)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-800 whitespace-nowrap">₹{fmtINR(row.current)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${row.change > 0 ? 'text-green-700' : row.change < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {row.change !== 0 ? fmtChg(row.change) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {row.changePct != null ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${row.changePct > 0 ? 'bg-green-100 text-green-700' : row.changePct < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                          {fmtPct(row.changePct)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── History Line Chart (amazon_monthly) ───────────────────────────────────

const HISTORY_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed'];

function HistoryChart({ comp }: { comp: ComparativePL }) {
  if (!comp.history?.length) return null;
  const keys = Object.keys(comp.history[0]?.values ?? {});
  const data = comp.history.map(h => ({ label: h.label, ...h.values }));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Trend — Last 12 Months</h2>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} tick={{ fontSize: 11 }} width={52} />
          <Tooltip formatter={(v) => `₹${fmtINR(Number(v ?? 0))}`} />
          <Legend />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={HISTORY_COLORS[i % HISTORY_COLORS.length]} strokeWidth={2} dot={false} name={k} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

type TabType = 'group_monthly' | 'amazon_monthly' | 'amazon_quarterly';

const TAB_LABELS: Record<TabType, string> = {
  group_monthly:    'Group Monthly',
  amazon_monthly:   'Amazon Monthly',
  amazon_quarterly: 'Amazon Quarterly',
};

export default function ComparativePage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedComparativePL = useComparativePL();

  const [comparativePL, setComparativePL] = useState<ComparativePL[] | null>(null);
  const [activeTab,     setActiveTab]     = useState<TabType>('group_monthly');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    if (cachedComparativePL?.length) { setComparativePL(cachedComparativePL); return; }
    if (!uploadId) return;
    setLoading(true);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}.`); return r.json(); })
      .then(data => {
        if (data.comparativePL?.length) {
          setComparativePL(data.comparativePL as ComparativePL[]);
          setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
            comparativePL: data.comparativePL,
          });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const active = cachedComparativePL?.length ? cachedComparativePL : comparativePL;
  const tabs   = (active ?? []).map(c => c.type as TabType);
  const activeComp = active?.find(c => c.type === activeTab) ?? active?.[0] ?? null;

  if (!uploadId && !active) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No comparative data loaded.</p>
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
          <p className="text-red-600 text-sm">{error ?? 'No comparative data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Comparative P&amp;L</h1>
            {activeComp && (
              <p className="text-sm text-gray-500 mt-0.5">{activeComp.previousLabel} → {activeComp.currentLabel}</p>
            )}
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === t
                  ? 'bg-white border border-b-white border-gray-200 text-blue-600 -mb-px'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[t] ?? t}
            </button>
          ))}
        </div>

        {activeComp && (
          <>
            {activeComp.type === 'amazon_monthly' && <HistoryChart comp={activeComp} />}
            <ComparisonTable comp={activeComp} />
          </>
        )}
      </div>
    </main>
  );
}
