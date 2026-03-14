'use client';

import Link from 'next/link';
import { useIntermediates } from '@/store/outputStore';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function FlipkartExpPage() {
  const intermediates = useIntermediates();
  const data = intermediates?.flipkartExpSheet;

  if (!data?.fees?.length) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500">No Flipkart expense data loaded.</p>
          <Link href="/upload" className="text-sm text-blue-600 underline">Upload a workbook</Link>
        </div>
      </main>
    );
  }

  const states = data.states ?? [];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Flipkart Expenses Sheet</h1>

        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase min-w-[200px]">
                  Fee Label
                </th>
                {states.map(s => (
                  <th key={s} className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {s}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.fees.map((f, i) => (
                <tr key={i} className="bg-white hover:bg-gray-50">
                  <td className="sticky left-0 bg-white px-4 py-2 border-b border-gray-100 font-medium text-gray-700 whitespace-nowrap">
                    {f.feeLabel}
                  </td>
                  {states.map(s => {
                    const val = (f.byState?.[s] as number | undefined) ?? 0;
                    return (
                      <td key={s} className="px-3 py-2 text-right border-b border-gray-100 tabular-nums text-gray-600 whitespace-nowrap">
                        ₹{fmtINR(val)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right border-b border-gray-100 tabular-nums font-semibold text-gray-800 whitespace-nowrap">
                    ₹{fmtINR(f.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
