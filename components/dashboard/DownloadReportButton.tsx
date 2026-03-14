'use client';

import { useState } from 'react';

interface Props {
  /** MonthlyPeriod._id — used to call /api/monthly-periods/:id/report */
  periodId: string;
  /** Human-readable month label shown in the loading state */
  month?: string;
}

export default function DownloadReportButton({ periodId, month }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/monthly-periods/${encodeURIComponent(periodId)}/report`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeMonth = (month ?? periodId).replace(/[^a-zA-Z0-9 ]/g, '-');
      a.download = `IAV Report ${safeMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Download failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleDownload}
        disabled={loading}
        title={month ? `Download report for ${month}` : 'Download report'}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md whitespace-nowrap',
          'border transition-colors shrink-0',
          loading
            ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
            : 'border-green-600 text-green-700 hover:bg-green-50 bg-white font-medium',
        ].join(' ')}
      >
        {loading ? (
          <>
            <span className="inline-block w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            <span>Downloading…</span>
          </>
        ) : (
          <>
            <span>↓</span>
            <span>Download Report</span>
          </>
        )}
      </button>
      {error && (
        <span className="text-xs text-red-600 max-w-[200px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
