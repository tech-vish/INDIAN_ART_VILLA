'use client';

import type { StatewisePL } from '@/lib/types';

interface StatewiseMapProps {
  data?: StatewisePL[];
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function StatewiseMap({ data }: StatewiseMapProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No statewise data available</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.netSales - a.netSales);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
            <th className="text-left px-3 py-2 border border-gray-200 font-semibold">State</th>
            <th className="text-right px-3 py-2 border border-gray-200 font-semibold">Gross Sales</th>
            <th className="text-right px-3 py-2 border border-gray-200 font-semibold">Net Sales</th>
            <th className="text-right px-3 py-2 border border-gray-200 font-semibold">Expenses</th>
            <th className="text-right px-3 py-2 border border-gray-200 font-semibold">Net Earnings</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.state} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-2 border border-gray-200 font-medium">{row.state}</td>
              <td className="text-right px-3 py-2 border border-gray-200">{fmt(row.grossSales)}</td>
              <td className="text-right px-3 py-2 border border-gray-200 font-medium">{fmt(row.netSales)}</td>
              <td className="text-right px-3 py-2 border border-gray-200 text-red-600">({fmt(row.expenseAllocation)})</td>
              <td className={'text-right px-3 py-2 border border-gray-200 font-semibold ' + (row.netEarnings >= 0 ? 'text-green-700' : 'text-red-600')}>
                {fmt(row.netEarnings)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
