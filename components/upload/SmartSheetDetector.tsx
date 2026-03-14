'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { FILE_TYPES, FileType } from '@/lib/fileTypeRegistry';

// ── Types ─────────────────────────────────────────────────────────────────

interface MatchResult {
  fileType: FileType;
  label: string;
  score: number;        // number of matching sheets
  total: number;        // number of expectedSheets
  matched: string[];    // which sheets matched
}

interface Props {
  file: File;
  onConfirm: (fileType: FileType) => void;
  onCancel: () => void;
}

// ── Helper: normalise sheet name for comparison ───────────────────────────

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sheetsMatch(fileSheets: string[], expected: string[], aliases?: string[]): string[] {
  const normFile = fileSheets.map(normalise);
  const candidates = [
    ...expected,
    ...(aliases ?? []),
  ].map(normalise);

  const matched: string[] = [];
  for (const c of candidates) {
    const idx = normFile.findIndex(s => s === c || s.startsWith(c) || c.startsWith(s));
    if (idx >= 0 && !matched.includes(fileSheets[idx])) {
      matched.push(fileSheets[idx]);
    }
  }
  return matched;
}

// ── Chip component ────────────────────────────────────────────────────────

function SheetChip({ name, matched }: { name: string; matched: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
        ${matched
          ? 'bg-green-100 text-green-700 border border-green-200'
          : 'bg-gray-100 text-gray-500 border border-gray-200'
        }`}
    >
      {matched && <span className="mr-1">✓</span>}
      {name}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function SmartSheetDetector({ file, onConfirm, onCancel }: Props) {
  const [fileSheets, setFileSheets]   = useState<string[]>([]);
  const [matches,    setMatches]      = useState<MatchResult[]>([]);
  const [loading,    setLoading]      = useState(true);
  const [error,      setError]        = useState<string | null>(null);
  const [manualMode, setManualMode]   = useState(false);
  const [selected,   setSelected]     = useState<FileType | ''>('');

  // ── Read sheet names from the file ──────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const readSheets = async () => {
      setLoading(true);
      setError(null);
      try {
        const buf = await file.arrayBuffer();
        const wb  = XLSX.read(buf, { bookSheets: true });  // reads only sheet names
        const sheets = wb.SheetNames;
        if (cancelled) return;

        setFileSheets(sheets);

        // Score each FILE_TYPE (exclude COMBINED_WORKBOOK from matching)
        const scored: MatchResult[] = [];
        for (const [ft, cfg] of Object.entries(FILE_TYPES) as [FileType, (typeof FILE_TYPES)[FileType]][]) {
          if (ft === 'COMBINED_WORKBOOK') continue;
          if (!cfg.expectedSheets || cfg.expectedSheets.length === 0) continue;

          const matched = sheetsMatch(sheets, cfg.expectedSheets, Object.keys(cfg.sheetNameAliases));
          if (matched.length > 0) {
            scored.push({
              fileType: ft,
              label:    cfg.label,
              score:    matched.length,
              total:    cfg.expectedSheets.length,
              matched,
            });
          }
        }

        // Sort best → worst
        scored.sort((a, b) => b.score / b.total - a.score / a.total || b.score - a.score);

        setMatches(scored);

        if (scored.length === 1) {
          // Unambiguous: auto-select and notify parent immediately
          onConfirm(scored[0].fileType);
        }
      } catch {
        if (!cancelled) setError('Could not read the Excel file. Make sure it is a valid .xlsx file.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    readSheets();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Reading sheet names from <span className="font-medium text-gray-700">{file.name}</span>…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 py-4">
        <p className="text-sm text-red-600">{error}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    );
  }

  // ── Manual pick fallback ──────────────────────────────────────────────

  const allFileTypes = (Object.entries(FILE_TYPES) as [FileType, (typeof FILE_TYPES)[FileType]][])
    .filter(([ft]) => ft !== 'COMBINED_WORKBOOK');

  const isManual = manualMode || matches.length === 0;

  return (
    <div className="space-y-5">
      {/* File sheet chips */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Sheets detected in file</p>
        <div className="flex flex-wrap gap-1.5">
          {fileSheets.map(s => {
            const isMatched = matches[0]?.matched.includes(s) ?? false;
            return <SheetChip key={s} name={s} matched={isMatched} />;
          })}
          {fileSheets.length === 0 && <span className="text-sm text-gray-400 italic">No sheets found</span>}
        </div>
      </div>

      {/* Match results */}
      {!isManual && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
            {matches.length === 1 ? 'Detected file type' : 'Possible file types — please select one'}
          </p>
          <div className="space-y-2">
            {matches.map(m => (
              <button
                key={m.fileType}
                onClick={() => onConfirm(m.fileType)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 text-left transition-colors
                  ${m === matches[0]
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {m.score} of {m.total} expected sheets matched
                    {m.matched.length > 0 && `: ${m.matched.join(', ')}`}
                  </p>
                </div>
                {m === matches[0] && (
                  <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">Best match</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setManualMode(true)}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline"
          >
            None of these match — pick manually
          </button>
        </div>
      )}

      {/* Manual picker */}
      {isManual && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
            {matches.length === 0 ? 'No automatic match found — select file type manually' : 'Select file type'}
          </p>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value as FileType)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Choose a file type…</option>
            {allFileTypes.map(([ft, cfg]) => (
              <option key={ft} value={ft}>{cfg.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        {isManual && (
          <button
            onClick={() => { if (selected) onConfirm(selected as FileType); }}
            disabled={!selected}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        )}
        <button
          onClick={onCancel}
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
