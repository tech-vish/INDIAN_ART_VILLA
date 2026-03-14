'use client';

interface KpiMetric {
  name: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  change: number;
}

interface KpiCardsProps {
  data?: KpiMetric[];
}

function fmtVal(m: KpiMetric): string {
  if (m.unit === 'rs') {
    return '\u20b9' + m.value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  if (m.unit === '%') {
    return (m.value * 100).toFixed(1) + '%';
  }
  return m.value.toLocaleString('en-IN') + (m.unit ? ' ' + m.unit : '');
}

export default function KpiCards({ data }: KpiCardsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No KPI data available</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {data.map((metric) => (
        <div
          key={metric.name}
          className={
            'bg-white rounded-lg border-l-4 p-4 shadow-sm ' +
            (metric.trend === 'up'
              ? 'border-l-green-500'
              : metric.trend === 'down'
              ? 'border-l-red-500'
              : 'border-l-gray-300')
          }
        >
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            {metric.name}
          </p>
          <p className="text-2xl font-bold text-gray-800">{fmtVal(metric)}</p>
          <p
            className={
              'text-xs mt-1 ' +
              (metric.trend === 'up'
                ? 'text-green-600'
                : metric.trend === 'down'
                ? 'text-red-600'
                : 'text-gray-500')
            }
          >
            {metric.trend !== 'stable' && (metric.trend === 'up' ? '\u2191' : '\u2193')}
            {metric.change !== 0 ? ' ' + (metric.change * 100).toFixed(1) + '%' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}
