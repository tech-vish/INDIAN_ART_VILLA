'use client';

import { useState, useEffect, useRef } from 'react';
import { useRawDataStore } from '@/store/rawDataStore';

// ── Types ─────────────────────────────────────────────────────────────────

export interface MonthPeriodRecord {
  _id: string;
  month: string;
  fiscalYear: string;
  fiscalQuarter: string;
  status: 'draft' | 'processing' | 'complete' | 'error';
  uploadedFiles: { fileType: string }[];
  availableSheets: string[];
  missingSheets: string[];
  openingStock: { tradedGoods: number; packingMaterial: number };
  previousMonthId: string | null;
}

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<MonthPeriodRecord['status'], string> = {
  draft:      'bg-gray-100 text-gray-600',
  processing: 'bg-yellow-100 text-yellow-700',
  complete:   'bg-green-100 text-green-700',
  error:      'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<MonthPeriodRecord['status'], string> = {
  draft:      'Draft',
  processing: 'Processing',
  complete:   'Complete',
  error:      'Error',
};

function StatusBadge({ status }: { status: MonthPeriodRecord['status'] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Next-month auto-detection ─────────────────────────────────────────────

function getNextMonthLabel(periods: MonthPeriodRecord[]): string {
  if (!periods.length) {
    // Default to current calendar month
    return new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }
  // Pick the most recent period (already sorted newest-first by API)
  const newest = new Date(`1 ${periods[0].month}`);
  newest.setMonth(newest.getMonth() + 1);
  return newest.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  selectedId: string | null;
  onChange: (period: MonthPeriodRecord | null) => void;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function MonthSelector({ selectedId, onChange }: Props) {
  const { setMonthlyPeriod } = useRawDataStore();

  const [periods,    setPeriods]    = useState<MonthPeriodRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showNew,    setShowNew]    = useState(false);
  const [newMonth,   setNewMonth]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Load periods ──────────────────────────────────────────────────────

  const fetchPeriods = async () => {
    try {
      const r = await fetch('/api/monthly-periods');
      const data = await r.json();
      const list: MonthPeriodRecord[] = data.periods ?? [];
      setPeriods(list);
      return list;
    } catch {
      setError('Failed to load periods.');
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPeriods();
  }, []);

  useEffect(() => {
    if (showNew) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [showNew]);

  // ── Select a period ───────────────────────────────────────────────────

  const handleSelect = (id: string) => {
    if (!id) {
      onChange(null);
      setMonthlyPeriod(null);
      return;
    }
    const p = periods.find(x => x._id === id) ?? null;
    onChange(p);
    setMonthlyPeriod(id);
  };

  // ── Create a new period ───────────────────────────────────────────────

  const handleShowNew = async () => {
    const list = periods.length ? periods : await fetchPeriods();
    setNewMonth(getNextMonthLabel(list));
    setShowNew(true);
  };

  const handleCreate = async () => {
    if (!newMonth.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/monthly-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: newMonth.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? 'Failed to create period.'); return; }

      const created: MonthPeriodRecord = data.period;
      // Merge into list (upsert)
      setPeriods(prev => {
        const idx = prev.findIndex(p => p._id === created._id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = created;
          return next;
        }
        return [created, ...prev];
      });
      setShowNew(false);
      handleSelect(created._id);
    } catch {
      setError('Network error while creating period.');
    } finally {
      setCreating(false);
    }
  };

  const selected = periods.find(p => p._id === selectedId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Reporting Period</label>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Loading periods…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedId ?? ''}
            onChange={e => handleSelect(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          >
            <option value="" disabled>Select a period…</option>
            {periods.map(p => (
              <option key={p._id} value={p._id}>
                {p.month} ({p.fiscalQuarter} {p.fiscalYear})
              </option>
            ))}
          </select>

          {!showNew ? (
            <button
              onClick={handleShowNew}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <span className="text-lg leading-none">+</span> Create New Month
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newMonth}
                onChange={e => setNewMonth(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false); }}
                placeholder="e.g. Mar 2026"
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newMonth.trim()}
                className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => setShowNew(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={selected.status} />
          <span className="text-gray-500">
            {selected.fiscalQuarter} · {selected.fiscalYear}
          </span>
          {selected.uploadedFiles.length > 0 && (
            <span className="text-gray-500">
              {selected.uploadedFiles.length} file{selected.uploadedFiles.length !== 1 ? 's' : ''} uploaded
            </span>
          )}
          {selected.missingSheets.length > 0 && (
            <span className="text-amber-600 font-medium">
              {selected.missingSheets.length} sheet{selected.missingSheets.length !== 1 ? 's' : ''} missing
            </span>
          )}
          {selected.openingStock.tradedGoods > 0 && (
            <span className="text-gray-400 text-xs">
              Opening stock: ₹{selected.openingStock.tradedGoods.toLocaleString('en-IN')}
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
