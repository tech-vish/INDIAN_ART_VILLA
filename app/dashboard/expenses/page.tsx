'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOutputStore, usePLOutput, useIntermediates } from '@/store/outputStore';
import type { ExpenseRow, AmazonExpFeeRow, FlipkartExpFeeRow } from '@/lib/types';
import { CHANNELS } from '@/lib/constants';

// ── Formatters ────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

// ── Allocation basis badge ────────────────────────────────────────────────

const BASIS_COLORS: Record<string, string> = {
  'DIRECT':                   'bg-blue-100 text-blue-700',
  'ONLY INDIANARTVILLA.IN':   'bg-purple-100 text-purple-700',
  'SALES RATIO':              'bg-green-100 text-green-700',
  '70%-30%':                  'bg-orange-100 text-orange-700',
  'B2B FOR BULK & B2C WEBSITE': 'bg-teal-100 text-teal-700',
};

function BasisBadge({ basis }: { basis: string }) {
  const cls = BASIS_COLORS[basis] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{basis}</span>;
}

// ── Active channels ───────────────────────────────────────────────────────

const DISPLAY_CHANNELS = CHANNELS.filter(ch =>
  ch !== 'MEESHO' && ch !== 'SHOWROOM'
) as string[];

const CH_LABEL: Record<string, string> = {
  AMAZON: 'AMZ', FLIPKART: 'FLK', MYNTRA: 'MYN', IAV_IN: 'IAV',
  BULK_DOMESTIC: 'B.DOM', IAV_COM: 'IAV.C', BULK_EXPORT: 'B.EXP',
};

// ── Expense table ─────────────────────────────────────────────────────────

const TH = 'px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap';
const TD = 'px-3 py-2 text-right tabular-nums whitespace-nowrap text-sm';

function ExpensesSection({ title, rows, highlight }: { title: string; rows: ExpenseRow[]; highlight: string }) {
  if (!rows.length) return null;
  const subtotal = rows.reduce((s, r) => s + r.totalBooks, 0);
  const colSub   = (ch: string) => rows.reduce((s, r) => s + (r.allocated[ch as keyof typeof r.allocated] ?? 0), 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-4 py-2 border-b border-gray-200 ${highlight}`}>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[220px]">Particulars</th>
              <th className={`${TH} text-gray-600`}>Total (₹)</th>
              <th className={TH}>Basis</th>
              {DISPLAY_CHANNELS.map(ch => <th key={ch} className={TH}>{CH_LABEL[ch] ?? ch}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">
                  {row.sno != null && <span className="text-gray-400 mr-2 text-xs">{row.sno}.</span>}
                  {row.particulars}
                </td>
                <td className={`${TD} font-medium text-gray-800`}>₹{fmt(row.totalBooks)}</td>
                <td className="px-3 py-2 whitespace-nowrap"><BasisBadge basis={row.allocationBasis} /></td>
                {DISPLAY_CHANNELS.map(ch => {
                  const val = row.allocated[ch as keyof typeof row.allocated] ?? 0;
                  return <td key={ch} className={`${TD} ${val === 0 ? 'text-gray-300' : 'text-gray-700'}`}>{val === 0 ? '—' : `₹${fmt(val)}`}</td>;
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50">
            <tr className="font-semibold">
              <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-gray-800">Sub-total</td>
              <td className={`${TD} text-gray-800`}>₹{fmt(subtotal)}</td>
              <td />
              {DISPLAY_CHANNELS.map(ch => <td key={ch} className={`${TD} text-gray-800`}>₹{fmt(colSub(ch))}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Amazon Exp Sheet detail ───────────────────────────────────────────────

function AmazonExpDetail({ fees, states }: { fees: AmazonExpFeeRow[]; states: string[] }) {
  return (
    <details className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50">
        Amazon Expense Sheet — Fee Breakdown by State
      </summary>
      <div className="overflow-x-auto border-t border-gray-200">
        <table className="min-w-full text-xs border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 text-xs font-semibold text-gray-500 min-w-[180px]">Fee</th>
              {states.map(s => <th key={s} className="px-2 py-2 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">{s}</th>)}
              <th className="px-2 py-2 text-right text-xs font-semibold text-gray-700">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fees.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-gray-700 whitespace-nowrap">{row.feeLabel}</td>
                {states.map(s => {
                  const net = row.byState[s]?.net ?? 0;
                  return <td key={s} className={`px-2 py-1.5 text-right tabular-nums ${net < 0 ? 'text-red-600' : 'text-gray-700'}`}>{net === 0 ? '—' : fmt(net)}</td>;
                })}
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${row.totalNet < 0 ? 'text-red-600' : 'text-gray-800'}`}>{fmt(row.totalNet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── Flipkart Exp Sheet detail ────────────────────────────────────────────

function FlipkartExpDetail({ fees, states }: { fees: FlipkartExpFeeRow[]; states: string[] }) {
  return (
    <details className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50">
        Flipkart Expense Sheet — Fee Breakdown by State
      </summary>
      <div className="overflow-x-auto border-t border-gray-200">
        <table className="min-w-full text-xs border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 text-xs font-semibold text-gray-500 min-w-[180px]">Fee</th>
              {states.map(s => <th key={s} className="px-2 py-2 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">{s}</th>)}
              <th className="px-2 py-2 text-right text-xs font-semibold text-gray-700">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fees.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-gray-700 whitespace-nowrap">{row.feeLabel}</td>
                {states.map(s => {
                  const val = row.byState[s] ?? 0;
                  return <td key={s} className={`px-2 py-1.5 text-right tabular-nums ${val < 0 ? 'text-red-600' : 'text-gray-700'}`}>{val === 0 ? '—' : fmt(val)}</td>;
                })}
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${row.total < 0 ? 'text-red-600' : 'text-gray-800'}`}>{fmt(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedPL          = usePLOutput();
  const cachedIntermediates = useIntermediates();

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (cachedPL || !uploadId) return;
    setLoading(true);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}.`); return r.json(); })
      .then(data => {
        setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
          intermediates: data.intermediates,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  if (!uploadId && !cachedPL) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No expense data loaded.</p>
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
  if (error || !cachedPL) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 text-sm">{error ?? 'No expense data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  const expenses = cachedPL.expenses ?? [];
  const directExp   = expenses.filter(e => e.allocationBasis === 'DIRECT' || e.allocationBasis === 'ONLY INDIANARTVILLA.IN');
  const allocExp    = expenses.filter(e => e.allocationBasis !== 'DIRECT' && e.allocationBasis !== 'ONLY INDIANARTVILLA.IN');

  const amznExp  = cachedIntermediates?.amazonExpSheet;
  const fkExp    = cachedIntermediates?.flipkartExpSheet;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Expense Sheet</h1>
            <p className="text-sm text-gray-500 mt-0.5">{cachedPL.month} · {expenses.length} expense lines</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <ExpensesSection
          title="Part A — Direct Expenses"
          rows={directExp}
          highlight="bg-blue-50 text-blue-800"
        />

        <ExpensesSection
          title="Part B — Allocated Expenses"
          rows={allocExp}
          highlight="bg-orange-50 text-orange-800"
        />

        {amznExp?.fees?.length ? (
          <AmazonExpDetail fees={amznExp.fees} states={amznExp.states} />
        ) : null}

        {fkExp?.fees?.length ? (
          <FlipkartExpDetail fees={fkExp.fees} states={fkExp.states} />
        ) : null}
      </div>
    </main>
  );
}
