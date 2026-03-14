'use client';

import Link from 'next/link';
import { useIntermediates } from '@/store/outputStore';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const CELL  = 'px-3 py-2 text-right border-b border-gray-100 tabular-nums text-gray-700 whitespace-nowrap';
const HEAD  = 'px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap';

export default function AmazonSummaryPage() {
  const intermediates = useIntermediates();
  const data = intermediates?.amazonSummary;

  if (!data?.rows?.length) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500">No Amazon summary data loaded.</p>
          <Link href="/upload" className="text-sm text-blue-600 underline">Upload a workbook</Link>
        </div>
      </main>
    );
  }

  const totals = data.rows.reduce(
    (acc, r) => ({ b2b: acc.b2b + r.b2b, b2c: acc.b2c + r.b2c, total: acc.total + r.total }),
    { b2b: 0, b2c: 0, total: 0 },
  );

  const byStateEntries = Object.entries(data.byState ?? {}).sort((a, b) => b[1].total - a[1].total);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[900px] mx-auto px-4 py-8 space-y-8">
        <h1 className="text-xl font-semibold text-gray-900">Amazon Summary Sheet</h1>

        {/* Main summary table */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase min-w-[100px]">Basis</th>
                <th className="sticky left-[100px] z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase min-w-[220px]">Particulars</th>
                <th className={HEAD}>B2B</th>
                <th className={HEAD}>B2C</th>
                <th className={HEAD}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="bg-white hover:bg-gray-50">
                  <td className="sticky left-0 bg-white px-4 py-2 border-b border-gray-100 text-gray-500 text-xs whitespace-nowrap">{r.basis}</td>
                  <td className="sticky left-[100px] bg-white px-4 py-2 border-b border-gray-100 text-gray-700 whitespace-nowrap font-medium">{r.particulars}</td>
                  <td className={CELL}>₹{fmtINR(r.b2b)}</td>
                  <td className={CELL}>₹{fmtINR(r.b2c)}</td>
                  <td className={`${CELL} font-semibold text-gray-800`}>₹{fmtINR(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
              <tr>
                <td className="sticky left-0 bg-blue-50 px-4 py-2 text-blue-900 text-sm" colSpan={2}>TOTAL</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900">₹{fmtINR(totals.b2b)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900">₹{fmtINR(totals.b2c)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-900">₹{fmtINR(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* By State */}
        {byStateEntries.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Sales by State</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
              <table className="min-w-full text-sm border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase min-w-[180px]">State</th>
                    <th className={HEAD}>B2B</th>
                    <th className={HEAD}>B2C</th>
                    <th className={HEAD}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byStateEntries.map(([state, v], i) => (
                    <tr key={i} className="bg-white hover:bg-gray-50">
                      <td className="px-4 py-2 border-b border-gray-100 text-gray-700 whitespace-nowrap">{state}</td>
                      <td className={CELL}>₹{fmtINR(v.b2b)}</td>
                      <td className={CELL}>₹{fmtINR(v.b2c)}</td>
                      <td className={`${CELL} font-medium`}>₹{fmtINR(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
