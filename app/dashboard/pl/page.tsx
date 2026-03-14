'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOutputStore } from '@/store/outputStore';
import { CHANNELS } from '@/lib/constants';
import type { PLOutput, PLRow, ExpenseRow } from '@/lib/types';

// ── Formatting ────────────────────────────────────────────────────────────

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── Table class constants ─────────────────────────────────────────────────

const CELL       = 'px-3 py-2 text-right border-b border-gray-100 whitespace-nowrap tabular-nums text-gray-700';
const LABEL_CELL = 'px-4 py-2 border-b border-gray-100 sticky left-0 z-10 whitespace-nowrap';
const HEADER     = 'px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap';

// ── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-gray-50">
      <td
        colSpan={cols}
        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400 sticky left-0 bg-gray-50"
      >
        {label}
      </td>
    </tr>
  );
}

function PLDataRow({
  row,
  highlight,
  indent,
}: {
  row: PLRow;
  highlight?: boolean;
  indent?: boolean;
}) {
  const base     = highlight ? 'bg-blue-50 font-semibold' : 'bg-white hover:bg-gray-50';
  const stickyBg = highlight ? 'bg-blue-50' : 'bg-white';

  return (
    <tr className={base}>
      <td className={`${LABEL_CELL} ${stickyBg} ${indent ? 'pl-8' : ''} ${highlight ? 'text-blue-900' : 'text-gray-800'}`}>
        {row.label}
      </td>
      <td className={`${CELL} font-medium ${highlight ? 'text-blue-900' : ''}`}>
        {fmtINR(row.total)}
        {row.totalPct !== 0 && (
          <span className="ml-1.5 text-xs font-normal text-gray-400">
            {fmtPct(row.totalPct)}
          </span>
        )}
      </td>
      {CHANNELS.map(ch => (
        <td key={ch} className={`${CELL} ${highlight ? 'text-blue-900' : ''}`}>
          {fmtINR(row.byChannel[ch] ?? 0)}
        </td>
      ))}
    </tr>
  );
}

function ExpenseDataRow({ row }: { row: ExpenseRow }) {
  const basisColor: Record<string, string> = {
    'DIRECT':                   'bg-blue-50 text-blue-700',
    'ONLY INDIANARTVILLA.IN':   'bg-indigo-50 text-indigo-700',
    'SALES RATIO':              'bg-gray-100 text-gray-600',
    '70%-30%':                  'bg-amber-50 text-amber-700',
    'B2B FOR BULK & B2C WEBSITE': 'bg-purple-50 text-purple-700',
  };
  const badge = basisColor[row.allocationBasis] ?? 'bg-gray-100 text-gray-600';

  return (
    <tr className="bg-white hover:bg-gray-50">
      <td className={`${LABEL_CELL} bg-white pl-8 text-gray-700`}>
        {row.particulars}
        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${badge}`}>
          {row.allocationBasis}
        </span>
      </td>
      <td className={`${CELL} text-gray-700`}>{fmtINR(row.totalBooks)}</td>
      {CHANNELS.map(ch => (
        <td key={ch} className={CELL}>
          {fmtINR(row.allocated[ch] ?? 0)}
        </td>
      ))}
    </tr>
  );
}


// ── P&L Table ─────────────────────────────────────────────────────────────

function PLTable({ pl }: { pl: PLOutput }) {
  const totalCols = 2 + CHANNELS.length; // sticky label + Total + 9 channels

  const directExp    = pl.expenses.filter(
    e => e.allocationBasis === 'DIRECT' || e.allocationBasis === 'ONLY INDIANARTVILLA.IN',
  );
  const allocatedExp = pl.expenses.filter(
    e => e.allocationBasis !== 'DIRECT' && e.allocationBasis !== 'ONLY INDIANARTVILLA.IN',
  );

  const ebt = pl.netProfit.total - (pl.interestExpense ?? 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm border-collapse">
        <thead className="border-b border-gray-200">
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[220px]">
              Line Item
            </th>
            <th className={HEADER}>Total</th>
            {CHANNELS.map(ch => (
              <th key={ch} className={HEADER}>
                {ch.replace(/_/g, '\u200B')}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {/* ── Revenue ── */}
          <SectionHeader label="Revenue" cols={totalCols} />
          <PLDataRow row={pl.grossSales} />
          <PLDataRow row={pl.cancellations} indent />
          <PLDataRow row={pl.courierReturns} indent />
          <PLDataRow row={pl.customerReturns} indent />
          <PLDataRow row={pl.shippingReceived} indent />
          <PLDataRow row={pl.netSales} highlight />

          {/* ── Cost of Goods Sold ── */}
          <SectionHeader label="Cost of Goods Sold" cols={totalCols} />
          <PLDataRow row={pl.openingStock} indent />
          <PLDataRow row={pl.purchases} indent />
          <PLDataRow row={pl.closingStock} indent />
          <PLDataRow row={pl.packingMaterial} indent />
          <PLDataRow row={pl.freightInward} indent />
          <PLDataRow row={pl.cogs} highlight />

          {/* ── Gross Profit ── */}
          <SectionHeader label="Gross Profit" cols={totalCols} />
          <PLDataRow row={pl.grossProfit} highlight />

          {/* ── Expenses Part A (Direct) ── */}
          <SectionHeader label="Part A — Direct Expenses" cols={totalCols} />
          {directExp.map((exp, i) => (
            <ExpenseDataRow key={i} row={exp} />
          ))}
          <PLDataRow row={pl.totalDirectExp} highlight />

          {/* ── Expenses Part B (Allocated) ── */}
          <SectionHeader label="Part B — Allocated Expenses" cols={totalCols} />
          {allocatedExp.map((exp, i) => (
            <ExpenseDataRow key={i} row={exp} />
          ))}
          <PLDataRow row={pl.totalAllocatedExp} highlight />

          {/* ── Net Profit (before interest) ── */}
          <SectionHeader label="Profit" cols={totalCols} />
          <PLDataRow row={pl.netProfit} highlight />

          {/* ── Interest Expense ── */}
          {(pl.interestExpense ?? 0) !== 0 && (
            <>
              <tr className="bg-orange-50 border-b border-gray-200">
                <td className={`${LABEL_CELL} bg-orange-50 font-semibold text-orange-900`}>
                  Less: Interest Expense
                </td>
                <td className="px-3 py-2 text-right font-semibold text-orange-900 border-b border-gray-100 tabular-nums">
                  {fmtINR(pl.interestExpense ?? 0)}
                </td>
                {CHANNELS.map(ch => (
                  <td key={ch} className="px-3 py-2 text-right border-b border-gray-100 text-orange-400 tabular-nums text-xs">—</td>
                ))}
              </tr>
              <tr className="bg-green-50 font-semibold">
                <td className={`${LABEL_CELL} bg-green-50 text-green-900`}>EBT (Earnings Before Tax)</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold border-b border-gray-100 ${ebt < 0 ? 'text-red-600' : 'text-green-800'}`}>
                  {fmtINR(ebt)}
                </td>
                {CHANNELS.map(ch => (
                  <td key={ch} className="px-3 py-2 text-right border-b border-gray-100 text-green-400 tabular-nums text-xs">—</td>
                ))}
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PLPage() {
  const { cachedPL, uploadId, processingErrors, setUploadResult } = useOutputStore();

  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [fetchedPL,    setFetchedPL]    = useState<PLOutput | null>(null);
  const [fetchedErrs,  setFetchedErrs]  = useState<string[]>([]);

  // Fetch from API when cachedPL is absent but uploadId is stored
  useEffect(() => {
    if (cachedPL !== null || !uploadId) return;

    setLoading(true);
    setFetchError(null);

    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}.`);
        return r.json() as Promise<{ uploadId: string; month: string; data: PLOutput; processingErrors: string[] }>;
      })
      .then(data => {
        setFetchedPL(data.data);
        setFetchedErrs(data.processingErrors ?? []);
        // Repopulate store so navigating away and back is instant
        setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? []);
      })
      .catch((e: unknown) => {
        setFetchError(e instanceof Error ? e.message : 'Failed to load report.');
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const pl     = cachedPL ?? fetchedPL;
  const errors = cachedPL !== null ? processingErrors : fetchedErrs;

  // ── Guard states ───────────────────────────────────────────────────────

  if (!uploadId && !cachedPL) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No data loaded.</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">
            ← Go to Upload
          </Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading report…</p>
        </div>
      </main>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">P&amp;L Report</h1>
            {pl && <p className="text-sm text-gray-500 mt-0.5">Period: {pl.month}</p>}
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">
            ← Upload new file
          </Link>
        </div>

        {/* Stale-data / fetch-error banner */}
        {fetchError && pl && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠ Could not reach database. Showing last processed data.
          </div>
        )}

        {/* Fetch error with no data */}
        {fetchError && !pl && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{fetchError}</span>
            <Link href="/upload" className="shrink-0 text-red-700 underline hover:no-underline">
              ← Back to Upload
            </Link>
          </div>
        )}

        {/* Processing errors */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-medium">
              ⚠ Some channels could not be processed:{' '}
            </span>
            {errors.join(', ')}
          </div>
        )}

        {/* Table */}
        {pl && <PLTable pl={pl} />}

      </div>
    </main>
  );
}