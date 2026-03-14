'use client';

import Link from 'next/link';
import { useIntermediates, usePLOutput } from '@/store/outputStore';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function StockValuePage() {
  const intermediates = useIntermediates();
  const pl = usePLOutput();
  const stock = intermediates?.stockValueSheet;

  if (!stock?.rows?.length) {
    const opening = pl?.openingStock.total ?? 0;
    const closing = pl?.closingStock.total ?? 0;
    const diff = closing - opening;

    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-[1200px] mx-auto px-4 py-8 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Stock Value</h1>
              <p className="text-sm text-gray-500 mt-0.5">Detailed stock rows are not available for this upload.</p>
            </div>
            <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Particular</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="px-4 py-2 text-gray-700">Opening Stock Value</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">₹{fmtINR(opening)}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-4 py-2 text-gray-700">Closing Stock Value</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">₹{fmtINR(closing)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold text-gray-900">Change</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ₹{fmtINR(diff)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Stock Value</h1>
            <p className="text-sm text-gray-500 mt-0.5">Opening vs closing stock values by location</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">S.No</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[280px]">Location</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Opening Stock Value</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Closing Stock Value</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Changes</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Notes</th>
                </tr>
              </thead>
              <tbody>
                {stock.rows.map((row, i) => (
                  <tr key={`${row.sno}-${row.location}-${i}`} className={`${row.isTotal ? 'bg-amber-50 border-t-2 border-amber-300' : 'bg-white border-b border-gray-100 hover:bg-gray-50'}`}>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.sno || '—'}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.location}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-emerald-600">₹{fmtINR(row.openingStockValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-emerald-600">₹{fmtINR(row.closingStockValue)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${row.changes < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(row.changes)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{row.notes ?? '—'}</td>
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
