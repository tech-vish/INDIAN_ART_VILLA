'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOutputStore, useComparativePL } from '@/store/outputStore';
import type { ComparativePL } from '@/lib/types';
import ComparativePLTable from '@/components/dashboard/ComparativePLTable';

export default function QuarterlyPage() {
  const { uploadId, setUploadResult } = useOutputStore();
  const cachedComparative = useComparativePL();

  const [comparative, setComparative] = useState<ComparativePL[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedComparative?.length) {
      setComparative(cachedComparative);
      return;
    }
    if (!uploadId) return;

    setLoading(true);
    fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}.`);
        return r.json();
      })
      .then(data => {
        if (data.comparativePL?.length) {
          const comps = data.comparativePL as ComparativePL[];
          setComparative(comps);
          setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
            comparativePL: comps,
          });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const activeComparative = (cachedComparative?.length ? cachedComparative : comparative)
    ?.find(c => c.type === 'amazon_quarterly') ?? null;

  if (!uploadId && !activeComparative) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-500 text-sm">No quarterly data loaded.</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (error || !activeComparative) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 text-sm">{error ?? 'No Amazon quarterly comparative data available.'}</p>
          <Link href="/upload" className="text-blue-600 hover:underline text-sm">← Go to Upload</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-[1800px] mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Amazon Quarterly</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {activeComparative.previousLabel} vs {activeComparative.currentLabel}
            </p>
          </div>
          <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-700 underline shrink-0">← Upload new file</Link>
        </div>

        <ComparativePLTable comp={activeComparative} />
      </div>
    </main>
  );
}
