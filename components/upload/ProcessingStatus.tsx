'use client';

import { useState, useEffect, useRef } from 'react';
import { useRawDataStore } from '@/store/rawDataStore';

// ── Types ─────────────────────────────────────────────────────────────────

interface Props {
  monthlyPeriodId: string;
  month: string;
  onComplete: (uploadId: string) => void;
  onClose: () => void;
}

interface ProcessResult {
  uploadId: string;
  month: string;
  errors: string[];
}

type Phase = 'assembling' | 'processing' | 'building' | 'done' | 'failed';

const PHASE_LABELS: Record<Phase, string> = {
  assembling:  'Assembling uploaded files…',
  processing:  'Running channel processors…',
  building:    'Building P&L report…',
  done:        'Complete',
  failed:      'Processing failed',
};

// Time-faked animation milestones (ms)
const PHASE_DURATIONS: [Phase, number][] = [
  ['assembling', 1200],
  ['processing', 2800],
  ['building',   1800],
];

// ── Step indicator ────────────────────────────────────────────────────────

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-colors
      ${active ? 'bg-blue-50' : done ? 'bg-green-50' : 'bg-gray-50'}`}>
      {done ? (
        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : active ? (
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0" />
      )}
      <span className={`text-sm font-medium
        ${active ? 'text-blue-700' : done ? 'text-green-700' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ProcessingStatus({ monthlyPeriodId, month, onComplete, onClose }: Props) {
  const { setProcessing } = useRawDataStore();

  const [phase,   setPhase]   = useState<Phase>('assembling');
  const [result,  setResult]  = useState<ProcessResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const apiCallMadeRef = useRef(false);
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Phase animation ───────────────────────────────────────────────────

  const animatePhases = (resolve: Promise<ProcessResult | { error: string }>) => {
    let elapsed = 0;
    const advance = async (idx: number) => {
      if (idx >= PHASE_DURATIONS.length) {
        // Wait for the real API result
        const r = await resolve;
        if ('error' in r) {
          setPhase('failed');
          setApiError(r.error);
          setProcessing(false);
        } else {
          setPhase('done');
          setResult(r);
          setProcessing(false);
        }
        return;
      }
      const [, duration] = PHASE_DURATIONS[idx];
      elapsed += duration;
      phaseTimeoutRef.current = setTimeout(() => {
        setPhase(PHASE_DURATIONS[idx + 1]?.[0] ?? 'building');
        advance(idx + 1);
      }, duration);
    };
    advance(0);
  };

  // ── API call ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (apiCallMadeRef.current) return;
    apiCallMadeRef.current = true;
    setProcessing(true);

    const resultPromise: Promise<ProcessResult | { error: string }> = fetch('/api/process-month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyPeriodId, month }),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) return { error: data.error ?? 'Processing failed.' };
      return { uploadId: data.uploadId, month: data.month, errors: data.errors ?? [] } as ProcessResult;
    }).catch(e => ({ error: e?.message ?? 'Network error' }));

    animatePhases(resultPromise);

    return () => {
      if (phaseTimeoutRef.current) clearTimeout(phaseTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phases list ───────────────────────────────────────────────────────

  const phaseOrder: Phase[] = ['assembling', 'processing', 'building'];
  const currentIdx = phaseOrder.indexOf(phase as typeof phaseOrder[number]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Steps */}
      <div className="space-y-1.5">
        {phaseOrder.map((p, i) => (
          <Step
            key={p}
            label={PHASE_LABELS[p]}
            active={phase === p}
            done={
              phase === 'done' ||
              (currentIdx > i && phase !== 'failed') ||
              i < phaseOrder.indexOf(phase as typeof phaseOrder[number])
            }
          />
        ))}
      </div>

      {/* Error state */}
      {phase === 'failed' && apiError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm font-medium text-red-700 mb-1">Processing failed</p>
          <p className="text-xs text-red-600 font-mono break-words">{apiError}</p>
        </div>
      )}

      {/* Success state */}
      {phase === 'done' && result && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800">P&amp;L built successfully</p>
              <p className="text-xs text-green-600 mt-0.5">{result.month}</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs font-semibold text-amber-700 mb-1.5">
                {result.errors.length} warning{result.errors.length !== 1 ? 's' : ''}
              </p>
              <ul className="space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-amber-700 font-mono break-words">• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        {phase === 'done' && result && (
          <button
            onClick={() => onComplete(result.uploadId)}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            View Dashboard →
          </button>
        )}
        <button
          onClick={onClose}
          disabled={phase !== 'done' && phase !== 'failed'}
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase === 'done' ? 'Close' : phase === 'failed' ? 'Dismiss' : 'Processing…'}
        </button>
      </div>
    </div>
  );
}
