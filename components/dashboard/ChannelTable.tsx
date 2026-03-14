'use client';

import type { PLRow } from '@/lib/types';
import type { PLSection } from '@/lib/utils/plRows';
import { CHANNELS } from '@/lib/constants';

interface ChannelTableProps {
  sections?: PLSection[];
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const HIGHLIGHT_LABELS = new Set([
  'Net Sales', 'COGS', 'Gross Profit', 'Net Profit',
  'Total Direct Expenses', 'Total Allocated Expenses',
]);

const TOTAL_COLS = 2 + CHANNELS.length;

function SectionHeadingRow({ label }: { label: string }) {
  return (
    <tr className="bg-gray-100 border-y border-gray-200">
      <td
        colSpan={TOTAL_COLS}
        className="sticky left-0 bg-gray-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500"
      >
        {label}
      </td>
    </tr>
  );
}

function DataRow({ row, indent }: { row: PLRow; indent: boolean }) {
  const highlight = HIGHLIGHT_LABELS.has(row.label);
  const rowBg  = highlight ? 'bg-blue-50' : 'bg-white';
  const textCls = highlight ? 'text-blue-900 font-semibold' : 'text-gray-800';

  return (
    <tr className={`${rowBg} hover:brightness-95 transition-all`}>
      <td className={`sticky left-0 z-10 px-4 py-2.5 whitespace-nowrap border-r border-gray-100 ${rowBg} ${textCls} ${indent && !highlight ? 'pl-7' : ''}`}>
        {row.label}
      </td>
      <td className={`text-right px-3 py-2.5 whitespace-nowrap tabular-nums ${textCls}`}>
        {fmt(row.total)}
        {row.totalPct !== 0 && (
          <span className="ml-1.5 text-xs font-normal text-gray-400">
            {fmtPct(row.totalPct)}
          </span>
        )}
      </td>
      {CHANNELS.map(ch => (
        <td key={ch} className={`text-right px-3 py-2.5 whitespace-nowrap tabular-nums ${highlight ? 'text-blue-800' : 'text-gray-700'}`}>
          {fmt(row.byChannel[ch] ?? 0)}
        </td>
      ))}
    </tr>
  );
}

export default function ChannelTable({ sections }: ChannelTableProps) {
  if (!sections || sections.length === 0 || sections.every(s => s.rows.length === 0)) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No P&L data available</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[200px] whitespace-nowrap border-r border-gray-200">
              P&L Line Item
            </th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[140px]">
              Total
            </th>
            {CHANNELS.map(ch => (
              <th key={ch} className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[100px]">
                {ch.replace(/_/g, '\u200B')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sections.map(section => (
            <>
              <SectionHeadingRow key={`h-${section.heading}`} label={section.heading} />
              {section.rows.map((row, i) => (
                <DataRow key={`${section.heading}-${i}`} row={row} indent={true} />
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
