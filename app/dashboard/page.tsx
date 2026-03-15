'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { useShallow } from 'zustand/shallow';
import { useOutputStore, useKPISheet, useAmazonStatewisePL } from '@/store/outputStore';
import type { PLOutput, OrdersSheet } from '@/lib/types';
import ValidationPanel from '@/components/dashboard/ValidationPanel';
import RawSheetsSection from '@/components/dashboard/RawSheetsSection';

// ── Constants ─────────────────────────────────────────────────────────────

interface UploadRecord {
  _id: string;
  fileName: string;
  month: string;
  uploadedAt: string;
  status: string;
}

const CH_LABELS: Record<string, string> = {
  AMAZON:        'AMAZON.IN',
  FLIPKART:      'FLIPKART',
  MEESHO:        'MEESHO',
  MYNTRA:        'MYNTRA',
  IAV_IN:        'IAV.IN',
  BULK_DOMESTIC: 'BULK DOMESTIC',
  SHOWROOM:      'SHOWROOM',
  IAV_COM:       'IAV.COM',
  BULK_EXPORT:   'BULK EXPORT',
};

const CH_COLORS: Record<string, string> = {
  AMAZON:        '#2563eb',
  FLIPKART:      '#f97316',
  MEESHO:        '#a855f7',
  MYNTRA:        '#ec4899',
  IAV_IN:        '#16a34a',
  BULK_DOMESTIC: '#0891b2',
  SHOWROOM:      '#7c3aed',
  IAV_COM:       '#ef4444',
  BULK_EXPORT:   '#ca8a04',
};

const CHANNELS_ORDERED = [
  'AMAZON', 'FLIPKART', 'MYNTRA', 'IAV_IN', 'BULK_DOMESTIC', 'IAV_COM', 'BULK_EXPORT', 'MEESHO', 'SHOWROOM',
];

// ── Formatters ───────────────────────────────────────────────────────────

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtLakh = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(2)} L`;
  return `₹${fmtINR(n)}`;
};
const fmtChartY = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(1)} Cr`;
  if (abs >= 1_00_000)    return `${(v / 1_00_000).toFixed(1)}L`;
  return fmtINR(v);
};

// ── KPI Card ─────────────────────────────────────────────────────────────

function KPICard({
  icon, label, value, sub, valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-none">{label}</p>
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none truncate ${valueColor ?? 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 leading-none">{sub}</p>}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────

const IconSales  = () => <svg width="18" height="18" fill="none" stroke="#ca8a04" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
const IconCOGS   = () => <svg width="18" height="18" fill="none" stroke="#2563eb" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
const IconMargin = () => <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
const IconOrders = () => <svg width="18" height="18" fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>;
const IconReturn = () => <svg width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.92"/></svg>;
const IconStock  = () => <svg width="18" height="18" fill="none" stroke="#0891b2" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>;

// ── Channel Net Sales Bar Chart ──────────────────────────────────────────

function ChannelNetSalesChart({ pl }: { pl: PLOutput }) {
  const data = CHANNELS_ORDERED
    .map(ch => ({
      ch,
      name: CH_LABELS[ch] ?? ch,
      value: (pl.netSales.byChannel as Record<string, number>)[ch] ?? 0,
    }))
    .filter(d => d.value !== 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Channel-wise Net Sales</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={fmtChartY} tick={{ fontSize: 10 }} width={64} />
          <Tooltip formatter={(v) => [`₹${fmtINR(Number(v))}`, 'Net Sales']} />
          <Bar dataKey="value" name="Net Sales" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={CH_COLORS[d.ch] ?? '#94a3b8'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sales Mix Donut ──────────────────────────────────────────────────────

function SalesMixDonut({ pl }: { pl: PLOutput }) {
  const data = CHANNELS_ORDERED
    .map(ch => ({
      ch,
      name: CH_LABELS[ch] ?? ch,
      value: (pl.netSales.byChannel as Record<string, number>)[ch] ?? 0,
    }))
    .filter(d => d.value > 0);

  const RADIAN = Math.PI / 180;
  const renderLabel = ({
    cx, cy, midAngle, outerRadius, percent,
  }: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; percent?: number }) => {
    if (!cx || !cy || !midAngle || !outerRadius || !percent || percent < 0.05) return null;
    const x = cx + (outerRadius + 18) * Math.cos(-midAngle * RADIAN);
    const y = cy + (outerRadius + 18) * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#374151" textAnchor="middle" dominantBaseline="central" fontSize={10}>
        {(percent * 100).toFixed(0)}%
      </text>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Sales Mix by Channel</h2>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            labelLine={false}
            label={renderLabel}
          >
            {data.map((d, i) => <Cell key={i} fill={CH_COLORS[d.ch] ?? '#94a3b8'} />)}
          </Pie>
          <Tooltip formatter={(v) => [`₹${fmtINR(Number(v))}`, 'Net Sales']} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(v) => <span style={{ fontSize: 11, color: '#4b5563' }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Channel Margin % Bar Chart ───────────────────────────────────────────

function ChannelMarginChart({ pl }: { pl: PLOutput }) {
  const data = CHANNELS_ORDERED
    .map(ch => {
      const ns   = (pl.netSales.byChannel as Record<string, number>)[ch] ?? 0;
      const cogs = (pl.cogs.byChannel as Record<string, number>)[ch] ?? 0;
      const exp  = ((pl.totalDirectExp.byChannel as Record<string, number>)[ch] ?? 0)
                 + ((pl.totalAllocatedExp.byChannel as Record<string, number>)[ch] ?? 0);
      if (ns === 0) return null;
      return { ch, name: CH_LABELS[ch] ?? ch, margin: parseFloat(((ns - cogs - exp) / ns * 100).toFixed(1)) };
    })
    .filter(Boolean) as { ch: string; name: string; margin: number }[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Channel-wise Margin %</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} width={44} />
          <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Net Margin']} />
          <Bar dataKey="margin" name="Margin %" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.margin >= 0 ? (CH_COLORS[d.ch] ?? '#16a34a') : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Top States Horizontal Bar ────────────────────────────────────────────

function TopStatesChart({
  amazonStatewise,
}: {
  amazonStatewise: { states: { state: string; netSales: number }[] } | null;
}) {
  if (!amazonStatewise?.states?.length) return null;
  const top10 = [...amazonStatewise.states].sort((a, b) => b.netSales - a.netSales).slice(0, 10);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Top States by Net Sales (Amazon)
      </h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
          <XAxis type="number" tickFormatter={fmtChartY} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="state" tick={{ fontSize: 10 }} width={110} />
          <Tooltip formatter={(v) => [`₹${fmtINR(Number(v))}`, 'Net Sales']} />
          <Bar dataKey="netSales" fill="#2563eb" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { cachedPL, uploadId, month, processingErrors, setUploadResult, clearOutput } =
    useOutputStore(useShallow(s => ({
      cachedPL:         s.cachedPL,
      uploadId:         s.uploadId,
      month:            s.month,
      processingErrors: s.processingErrors,
      setUploadResult:  s.setUploadResult,
      clearOutput:      s.clearOutput,
    })));

  const amazonStatewise = useAmazonStatewisePL();
  void useKPISheet();

  const [fetchedPL,      setFetchedPL]      = useState<PLOutput | null>(null);
  const [ordersSheet,    setOrdersSheet]    = useState<OrdersSheet | null>(null);
  const [plLoading,      setPlLoading]      = useState(false);
  const [plError,        setPlError]        = useState<string | null>(null);
  const [uploads,        setUploads]        = useState<UploadRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [switchingId,    setSwitchingId]    = useState<string | null>(null);

  const pl = cachedPL ?? fetchedPL;

  useEffect(() => {
    if (cachedPL !== null || !uploadId) return;
    setPlLoading(true);
    setPlError(null);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}.`);
        return r.json() as Promise<{
          uploadId: string; month: string; data: PLOutput;
          processingErrors: string[]; ordersSheet?: OrdersSheet;
        }>;
      })
      .then(data => {
        setFetchedPL(data.data);
        if (data.ordersSheet) setOrdersSheet(data.ordersSheet);
        setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
          ordersSheet: data.ordersSheet,
        });
      })
      .catch((e: unknown) => setPlError(e instanceof Error ? e.message : 'Failed to load report.'))
      .finally(() => setPlLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  useEffect(() => {
    setUploadsLoading(true);
    fetch('/api/uploads')
      .then(r => r.json())
      .then(d => setUploads((d.uploads ?? []).slice(0, 10)))
      .catch(() => {/* non-fatal */})
      .finally(() => setUploadsLoading(false));
  }, []);

  const handleLoadUpload = useCallback(async (id: string) => {
    if (id === uploadId) return;
    setSwitchingId(id);
    try {
      const r = await fetch(`/api/pl?uploadId=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`Server returned ${r.status}.`);
      const data = await r.json() as {
        uploadId: string; month: string; data: PLOutput; processingErrors: string[];
      };
      setFetchedPL(null);
      setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? []);
    } catch {
      /* silently ignore */
    } finally {
      setSwitchingId(null);
    }
  }, [uploadId, setUploadResult]);

  // ── Derived KPIs ──────────────────────────────────────────────────────

  const totalNetSales  = pl?.netSales.total ?? 0;
  const totalCOGS      = pl?.cogs.total ?? 0;
  const grossProfit    = pl?.grossProfit.total ?? 0;
  const grossMarginPct = totalNetSales > 0 ? (grossProfit / totalNetSales) * 100 : 0;
  const closingStock   = pl?.closingStock.total ?? 0;

  const storeOrders     = useOutputStore(s => s.ordersSheet);
  const effectiveOrders = storeOrders ?? ordersSheet;
  const totalOrdersRow  = effectiveOrders?.rows.find(r => r.label === 'TOTAL ORDERS');
  const returnsRow      = effectiveOrders?.rows.find(r => r.label === 'RETURNS');
  const totalOrders     = totalOrdersRow?.total?.orders ?? 0;
  const totalReturns    = returnsRow?.total?.orders ?? 0;
  const returnRatePct   = totalOrders > 0 ? (totalReturns / totalOrders) * 100 : 0;

  // ── No-data state ─────────────────────────────────────────────────────

  if (!uploadId && !cachedPL && !plLoading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-5xl">📂</div>
          <h1 className="text-xl font-semibold text-gray-900">No data loaded</h1>
          <p className="text-sm text-gray-500">Upload a master workbook to generate your P&amp;L report.</p>
          <Link
            href="/upload"
            className="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Upload
          </Link>
        </div>
      </main>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">IAV Dashboard</h1>
            {pl && <p className="text-xs text-gray-400 mt-0.5">{month ?? pl.month}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {uploads.length > 0 && (
              <select
                value={uploadId ?? ''}
                onChange={e => { if (e.target.value) handleLoadUpload(e.target.value); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>Select period…</option>
                {uploads.map(u => (
                  <option key={u._id} value={u._id}>{u.month} — {u.fileName}</option>
                ))}
              </select>
            )}
            <Link
              href="/upload"
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors"
            >
              Upload file
            </Link>
            {pl && (
              <button
                onClick={() => { clearOutput(); setFetchedPL(null); }}
                className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Processing errors */}
        {processingErrors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 mb-2">
              ⚠ Some processors reported issues — partial data may be shown
            </p>
            <ul className="space-y-1">
              {processingErrors.map((err, i) => (
                <li key={i} className="text-xs text-amber-700 flex gap-1.5">
                  <span className="flex-shrink-0">•</span><span>{err}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Loading / error */}
        {plLoading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
            <p className="text-sm text-gray-500">Loading report…</p>
          </div>
        )}
        {plError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {plError} —{' '}
            <Link href="/upload" className="underline">go to upload</Link>
          </div>
        )}

        {pl && (
          <>
            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              <KPICard
                icon={<IconSales />}
                label="Net Sales"
                value={fmtLakh(totalNetSales)}
                sub="Total across all channels"
              />
              <KPICard
                icon={<IconCOGS />}
                label="Cost of Goods Sold"
                value={fmtLakh(totalCOGS)}
                sub="COGS for the period"
              />
              <KPICard
                icon={<IconMargin />}
                label="Gross Margin"
                value={`${grossMarginPct.toFixed(1)}%`}
                sub={`₹${fmtINR(grossProfit)}`}
                valueColor={grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}
              />
              <KPICard
                icon={<IconOrders />}
                label="Total Orders"
                value={totalOrders > 0 ? totalOrders.toLocaleString('en-IN') : '—'}
                sub="All channels combined"
                valueColor="text-violet-700"
              />
              <KPICard
                icon={<IconReturn />}
                label="Return Rate"
                value={totalOrders > 0 ? `${returnRatePct.toFixed(1)}%` : '—'}
                sub={totalReturns > 0 ? `${totalReturns.toLocaleString('en-IN')} returned` : undefined}
                valueColor={returnRatePct > 20 ? 'text-red-600' : 'text-gray-900'}
              />
              <KPICard
                icon={<IconStock />}
                label="Closing Stock (at cost)"
                value={fmtLakh(closingStock)}
                sub="Inventory valuation"
                valueColor="text-cyan-700"
              />
            </div>

            {/* ── Row 1: Channel Net Sales + Sales Mix ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <ChannelNetSalesChart pl={pl} />
              <SalesMixDonut pl={pl} />
            </div>

            {/* ── Row 2: Margin % + Top States ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <ChannelMarginChart pl={pl} />
              {amazonStatewise ? (
                <TopStatesChart amazonStatewise={amazonStatewise} />
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-center text-sm text-gray-400">
                  No Amazon statewise data available
                </div>
              )}
            </div>

            {/* ── Validation panel ── */}
            <ValidationPanel pl={pl} />

            {/* ── Raw sheets viewer ── */}
            <RawSheetsSection uploadId={uploadId} />
          </>
        )}

        {/* ── Recent uploads ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Recent Uploads</h2>
          {uploadsLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : uploads.length === 0 ? (
            <p className="text-sm text-gray-400">No uploads found.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {uploads.map(u => {
                const isActive    = u._id === uploadId;
                const isSwitching = switchingId === u._id;
                return (
                  <div key={u._id} className="flex items-center justify-between py-2.5 gap-4">
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-800'}`}
                        title={u.fileName}
                      >
                        {isActive && <span className="mr-1.5 text-blue-500">●</span>}
                        {u.fileName}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {u.month} · {new Date(u.uploadedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={[
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        u.status === 'done'  ? 'bg-green-100 text-green-700'  :
                        u.status === 'error' ? 'bg-red-100 text-red-700'      :
                                              'bg-yellow-100 text-yellow-700',
                      ].join(' ')}>
                        {u.status}
                      </span>
                      {!isActive && (
                        <button
                          onClick={() => handleLoadUpload(u._id)}
                          disabled={!!switchingId}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-40"
                        >
                          {isSwitching ? 'Loading…' : 'Load'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
