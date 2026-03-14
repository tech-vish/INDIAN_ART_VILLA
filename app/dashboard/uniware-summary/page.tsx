'use client';

import Link from 'next/link';
import { useIntermediates } from '@/store/outputStore';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const ROW_LABELS: Record<string, string> = {
  SALES: 'Sales',
  RETURN_COURIER: 'Courier Return',
  RETURN_CUSTOMER: 'Customer Return',
  CANCEL: 'Cancellation',
  NET_SALES: 'Net Sales',
};

export default function UniwareSummaryPage() {
  const intermediates = useIntermediates();
  const data = intermediates?.uniwareSummary;

  if (!data?.rows?.length) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500">No Uniware summary data loaded.</p>
          <Link href="/upload" className="text-sm text-blue-600 underline">Upload a workbook</Link>
        </div>
      </main>
    );
  }

  const byStateEntries = Object.entries(data.byState ?? {}).sort((a, b) => b[1].net - a[1].net);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-8">
        <h1 className="text-xl font-semibold text-gray-900">Uniware / IAV.in Summary</h1>

        {/* Main table */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase min-w-[160px]">Row Type</th>
                <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold text-purple-600 uppercase tracking-wide border-l border-gray-200">Myntra</th>
                <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold text-blue-600 uppercase tracking-wide border-l border-gray-200">IAV.in</th>
              </tr>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-20 bg-gray-50 px-4 py-2" />
                {['Principal / Basics', 'Shipping', 'COD Charges', 'Discount'].map(h => (
                  <th key={`m-${h}`} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
                {['Principal / Basics', 'Shipping', 'COD Charges', 'Discount'].map(h => (
                  <th key={`i-${h}`} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 whitespace-nowrap border-l border-gray-100">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                const isNet = row.rowType === 'NET_SALES';
                const base = isNet
                  ? 'bg-blue-50 font-semibold text-gray-900'
                  : 'bg-white hover:bg-gray-50 text-gray-700';
                return (
                  <tr key={i} className={base}>
                    <td className={`sticky left-0 px-4 py-2 border-b border-gray-100 whitespace-nowrap ${isNet ? 'bg-blue-50 font-semibold' : 'bg-white font-medium'}`}>
                      {ROW_LABELS[row.rowType] ?? row.rowType}
                    </td>
                    {([row.myntra.principalBasics, row.myntra.shipping, row.myntra.codCharges, row.myntra.discount] as number[]).map((v, ci) => (
                      <td key={`m${ci}`} className="px-3 py-2 text-right border-b border-gray-100 tabular-nums whitespace-nowrap">
                        ₹{fmtINR(v)}
                      </td>
                    ))}
                    {([row.iavIn.principalBasics, row.iavIn.shipping, row.iavIn.codCharges, row.iavIn.discount] as number[]).map((v, ci) => (
                      <td key={`i${ci}`} className="px-3 py-2 text-right border-b border-gray-100 tabular-nums whitespace-nowrap border-l border-gray-100">
                        ₹{fmtINR(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* By State table */}
        {byStateEntries.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-700 mb-3">Sales by State</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
              <table className="min-w-full text-sm border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">State</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Sales</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Returns</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase">Net Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {byStateEntries.map(([state, v]) => (
                    <tr key={state} className="bg-white hover:bg-gray-50">
                      <td className="px-4 py-2 border-b border-gray-100 font-medium text-gray-700">{state}</td>
                      <td className="px-3 py-2 text-right border-b border-gray-100 tabular-nums text-gray-600">₹{fmtINR(v.sales)}</td>
                      <td className="px-3 py-2 text-right border-b border-gray-100 tabular-nums text-red-600">₹{fmtINR(v.returns)}</td>
                      <td className="px-3 py-2 text-right border-b border-gray-100 tabular-nums font-semibold text-gray-800">₹{fmtINR(v.net)}</td>
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
