'use client';

import Link from 'next/link';
import { useIntermediates } from '@/store/outputStore';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export default function StatewiseSalePage() {
  const intermediates = useIntermediates();
  const data = intermediates?.statewiseSale;

  if (!data?.combined?.length) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500">No statewise sale data loaded.</p>
          <Link href="/upload" className="text-sm text-blue-600 underline">Upload a workbook</Link>
        </div>
      </main>
    );
  }

  const amazonRows = data.byChannel?.AMAZON ?? [];
  const flipkartRows = data.byChannel?.FLIPKART ?? [];
  const iavRows = data.byChannel?.IAV_IN ?? [];

  const amzMap = new Map(amazonRows.map(r => [r.state, r.netSales]));
  const fkMap = new Map(flipkartRows.map(r => [r.state, r.netSales]));
  const iavMap = new Map(iavRows.map(r => [r.state, r.netSales]));

  const amzTotal = [...amzMap.values()].reduce((s, v) => s + v, 0);
  const fkTotal = [...fkMap.values()].reduce((s, v) => s + v, 0);
  const iavTotal = [...iavMap.values()].reduce((s, v) => s + v, 0);

  const rows = [...data.combined]
    .map(r => {
      const amz = amzMap.get(r.state) ?? 0;
      const fk = fkMap.get(r.state) ?? 0;
      const iav = iavMap.get(r.state) ?? 0;
      return {
        state: r.state,
        amazonNet: amz,
        amazonPct: amzTotal > 0 ? (amz / amzTotal) * 100 : 0,
        flipkartNet: fk,
        flipkartPct: fkTotal > 0 ? (fk / fkTotal) * 100 : 0,
        iavNet: iav,
        iavPct: iavTotal > 0 ? (iav / iavTotal) * 100 : 0,
        totalNet: r.netSales,
      };
    })
    .sort((a, b) => b.totalNet - a.totalNet);

  const totals = rows.reduce(
    (acc, r) => ({
      amazonNet: acc.amazonNet + r.amazonNet,
      flipkartNet: acc.flipkartNet + r.flipkartNet,
      iavNet: acc.iavNet + r.iavNet,
      totalNet: acc.totalNet + r.totalNet,
    }),
    { amazonNet: 0, flipkartNet: 0, iavNet: 0, totalNet: 0 },
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[2200px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Statewise Sale</h1>
            <p className="text-sm text-gray-500 mt-0.5">Amazon, Flipkart and IndianArtVilla.in state-wise net sales</p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[260px]">
                    State
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Amazon Net Sales</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">% In Total Amazon Sale</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Flipkart Net Sales</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">% In Total Flipkart Sale</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">IndianArtVilla.in Net Sales</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">% In Total IAV.IN Sale</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide whitespace-nowrap">Total Net Sales</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.state} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">{r.state}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.amazonNet < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(r.amazonNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">{fmtPct(r.amazonPct)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.flipkartNet < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(r.flipkartNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">{fmtPct(r.flipkartPct)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.iavNet < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(r.iavNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">{fmtPct(r.iavPct)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium ${r.totalNet < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(r.totalNet)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-amber-300">
                <tr>
                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-gray-800 font-semibold">TOTAL</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">₹{fmtINR(totals.amazonNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-semibold">100.00%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">₹{fmtINR(totals.flipkartNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-semibold">100.00%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">₹{fmtINR(totals.iavNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-semibold">100.00%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">₹{fmtINR(totals.totalNet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
