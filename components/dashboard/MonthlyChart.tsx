'use client';

import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { MonthlyAmazonRow } from '@/lib/types';

interface MonthlyChartProps {
  data?: MonthlyAmazonRow[];
}

function fmtMonth(d: Date | unknown): string {
  if (d instanceof Date) {
    return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }
  return String(d);
}

function fmtRupee(value: number): string {
  return `\u20b9${(value / 100_000).toFixed(1)}L`;
}

export default function MonthlyChart({ data }: MonthlyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No monthly data available</p>
      </div>
    );
  }

  const chartData = data.map(row => ({
    month:         fmtMonth(row.month),
    grossSales:    row.grossSales,
    totalExpenses: row.totalExpenses,
    netEarnings:   row.netEarnings,
    netSales:      row.netSales,
  }));

  return (
    <div className="space-y-6">
      {/* Revenue vs Net Earnings */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold mb-4">Revenue Trends</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={fmtRupee} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `\u20b9${Number(v).toLocaleString('en-IN')}`} />
            <Legend />
            <Line type="monotone" dataKey="grossSales"  stroke="#2563eb" name="Gross Sales"  strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="netSales"    stroke="#0891b2" name="Net Sales"    strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="netEarnings" stroke="#16a34a" name="Net Earnings" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Expenses Bar Chart */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold mb-4">Monthly Expenses</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={fmtRupee} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `\u20b9${Number(v).toLocaleString('en-IN')}`} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
