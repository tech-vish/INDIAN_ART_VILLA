import { Fragment } from 'react';
import type { ComparativePL, ComparativePLRow } from '@/lib/types';

const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number | null) => n == null ? '—' : `${n.toFixed(2)}%`;

function isSectionHeader(row: ComparativePLRow): boolean {
  return row.previous === 0 && row.current === 0 && row.change === 0;
}

export default function ComparativePLTable({ comp }: { comp: ComparativePL }) {
  const grossRow = comp.rows.find(r => r.label.toLowerCase().includes('gross sales'));
  const prevBase = grossRow?.previous && grossRow.previous !== 0 ? Math.abs(grossRow.previous) : null;
  const currBase = grossRow?.current && grossRow.current !== 0 ? Math.abs(grossRow.current) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[260px]">
                Particulars
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {comp.previousLabel}
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                %
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">
                {comp.currentLabel}
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">
                %
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Absolute Change
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {comp.rows.map((row, i) => {
              if (isSectionHeader(row)) {
                return (
                  <tr key={i} className="bg-gray-50">
                    <td colSpan={7} className="sticky left-0 z-10 bg-gray-50 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
                      {row.label}
                    </td>
                  </tr>
                );
              }

              const prevPct = prevBase ? (row.previous / prevBase) * 100 : null;
              const currPct = currBase ? (row.current / currBase) * 100 : null;

              return (
                <Fragment key={i}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-700 whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${row.previous < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(row.previous)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">
                      {fmtPct(prevPct)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${row.current < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{fmtINR(row.current)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">
                      {fmtPct(currPct)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${row.change < 0 ? 'text-red-600' : row.change > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                      ₹{fmtINR(row.change)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-blue-600">
                      {fmtPct(row.changePct)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
