'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { detectMonthFromWorkbook } from '@/lib/utils/parser';

import { useRawDataStore } from '@/store/rawDataStore';
import { useOutputStore } from '@/store/outputStore';
import { processWorkbook } from './actions';
import MonthSelector, { type MonthPeriodRecord } from '@/components/upload/MonthSelector';
import FileChecklist from '@/components/upload/FileChecklist';
import ProcessingStatus from '@/components/upload/ProcessingStatus';

// ── Constants ─────────────────────────────────────────────────────────────

const REQUIRED_SHEETS = [
  'AMAZON B2B MAIN SHEET',
  'AMAZON B2C MAIN SHEET',
  'AMAZON MERGER SKU SHEET v2',
  'AMAZON PAYMENT SHEET',
  'Flipkart Sales Report Main ',
  'Flipkart Cash Back Report Main ',
  'Export-Tally GST Report-indiana',
  'SALES BUSY',
  'PURCHASE LEDGER',
  'STOCK VALUE',
] as const;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function getCurrentMonth(): string {
  return new Date().toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

// ── Types ─────────────────────────────────────────────────────────────────

interface UploadRecord {
  _id: string;
  fileName: string;
  month: string;
  uploadedAt: string;
  status: string;
}

type Tab = 'combined' | 'individual';

// ── Page ──────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();

  const {
    workbook,
    fileName,
    isProcessing,
    error,
    setWorkbook,
    clearWorkbook,
    setProcessing,
    setError,
    monthlyPeriodId,
  } = useRawDataStore();

  const { setUploadResult } = useOutputStore();

  const [activeTab, setActiveTab]               = useState<Tab>('combined');
  const [selectedPeriod, setSelectedPeriod]     = useState<MonthPeriodRecord | null>(null);
  const [showProcessingModal, setShowProcessingModal] = useState(false);

  const [month, setMonth]                       = useState<string>(getCurrentMonth);
  const [uploads, setUploads]                   = useState<UploadRecord[]>([]);
  const [loadingHistory, setLoadingHistory]     = useState(false);
  const [loadingId, setLoadingId]               = useState<string | null>(null);

  // Keep raw file buffer so the server action can re-parse without re-reading the file
  const rawBytesRef = useRef<ArrayBuffer | null>(null);

  // ── Sync month input with selected period ────────────────────────────────
  useEffect(() => {
    if (selectedPeriod) setMonth(selectedPeriod.month);
  }, [selectedPeriod]);

  // ── Fetch history ───────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingHistory(true);
    fetch('/api/uploads?limit=10')
      .then(r => r.json())
      .then(d => setUploads(d.uploads ?? []))
      .catch(() => {/* non-fatal */})
      .finally(() => setLoadingHistory(false));
  }, []);

  // ── Dropzone ────────────────────────────────────────────────────────────
  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setError(null);

      if (file.size > MAX_BYTES) {
        setError('File is too large. Maximum allowed size is 50 MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = e => {
        const buffer = e.target?.result as ArrayBuffer;
        try {
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
          setWorkbook(wb, file.name);
          rawBytesRef.current = buffer;
          // 14G: Auto-detect month from workbook sheet names and pre-fill if field is empty
          const detected = detectMonthFromWorkbook(wb);
          if (detected) setMonth(prev => (prev === getCurrentMonth() || !prev.trim()) ? detected : prev);
        } catch {
          setError('Could not parse file. Make sure it is a valid .xlsx workbook.');
          rawBytesRef.current = null;
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [setWorkbook, setError],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    maxFiles: 1,
    multiple: false,
    disabled: isProcessing,
  });

  // ── Derived state ────────────────────────────────────────────────────────
  const missingSheets = workbook
    ? REQUIRED_SHEETS.filter(s => !workbook.SheetNames.includes(s))
    : [];

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleRemove = () => {
    clearWorkbook();
    rawBytesRef.current = null;
    setError(null);
  };

  const handleProcess = async () => {
    if (!rawBytesRef.current || !fileName) return;

    if (!month.trim()) {
      setError('Please enter a reporting month before processing.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const blob = new Blob([rawBytesRef.current], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fd = new FormData();
      fd.append('file', blob, fileName);
      fd.append('fileName', fileName);
      fd.append('month', month.trim());

      const result = await processWorkbook(fd);
      setUploadResult(result.uploadId, month, result.pl, result.errors, {
        ordersSheet:       result.ordersSheet,
        kpiSheet:          result.kpiSheet,
        amazonStatewisePL: result.amazonStatewisePL,
        intermediates:     result.intermediates,
      });
      router.push('/dashboard');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Processing failed.');
    } finally {
      setProcessing(false);
    }
  };

  const handleLoad = async (uploadId: string) => {
    setLoadingId(uploadId);
    setError(null);
    try {
      const res = await fetch(`/api/pl?uploadId=${encodeURIComponent(uploadId)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}.`);
      const data = await res.json();
      setUploadResult(data.uploadId, data.month, data.data, data.processingErrors ?? [], {
        ordersSheet:       data.ordersSheet,
        kpiSheet:          data.kpiSheet,
        amazonStatewisePL: data.amazonStatewisePL,
        intermediates:     data.intermediates,
        comparativePL:     data.comparativePL,
        amazonMonthlyRow:  data.amazonMonthlyRow,
        quarterlyRollup:   data.quarterlyRollup,
      });
      router.push('/dashboard');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load upload.');
    } finally {
      setLoadingId(null);
    }
  };

  const handleProcessComplete = (uploadId: string) => {
    setShowProcessingModal(false);
    handleLoad(uploadId);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Upload Data</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload Excel files to generate monthly P&amp;L reports.
          </p>
        </div>

        {/* Month Selector — always visible */}
        <div className="border border-gray-200 rounded-xl p-5">
          <MonthSelector
            selectedId={monthlyPeriodId}
            onChange={setSelectedPeriod}
          />
        </div>

        {/* Global error banner */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Tab switcher */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6" aria-label="Upload mode tabs">
            {(['combined', 'individual'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors
                  ${activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                {tab === 'combined' ? 'Combined Workbook' : 'Individual Files'}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Combined Workbook tab ─────────────────────────────────────── */}
        {activeTab === 'combined' && (
          <div className="space-y-6">
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={[
                'border-2 border-dashed rounded-xl px-6 py-14 text-center transition-colors',
                isProcessing
                  ? 'cursor-not-allowed border-gray-200 bg-gray-50'
                  : isDragActive
                  ? 'cursor-copy border-blue-500 bg-blue-50'
                  : 'cursor-pointer border-gray-300 hover:border-gray-400 bg-gray-50',
              ].join(' ')}
            >
              <input {...getInputProps()} />
              <div className="text-4xl mb-3 select-none">📂</div>
              {isDragActive ? (
                <p className="text-blue-600 font-medium">Drop the file here…</p>
              ) : (
                <>
                  <p className="text-gray-700 font-medium">Drag &amp; drop your .xlsx file here</p>
                  <p className="text-gray-400 text-sm mt-1">or click to browse — max 50 MB</p>
                </>
              )}
            </div>

            {/* Workbook preview */}
            {workbook && (
              <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900 break-all">{fileName}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {workbook.SheetNames.length} sheet{workbook.SheetNames.length !== 1 ? 's' : ''} detected
                    </p>
                  </div>
                  <button
                    onClick={handleRemove}
                    className="shrink-0 text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    Remove
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {workbook.SheetNames.map(name => {
                    const isRequired = (REQUIRED_SHEETS as readonly string[]).includes(name);
                    return (
                      <span
                        key={name}
                        className={[
                          'px-2 py-1 text-xs rounded-full font-medium',
                          isRequired
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600',
                        ].join(' ')}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>

                {missingSheets.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-medium text-amber-800 mb-1.5">
                      ⚠&nbsp; {missingSheets.length} required sheet{missingSheets.length > 1 ? 's' : ''} missing:
                    </p>
                    <ul className="text-sm text-amber-700 list-disc list-inside space-y-0.5">
                      {missingSheets.map(s => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Month + Process */}
            {workbook && (
              <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                <div>
                  <label
                    htmlFor="month-input"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Reporting Month
                  </label>
                  <input
                    id="month-input"
                    type="text"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    placeholder="e.g. Jan 2026"
                    className="w-full sm:w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Stored with the report in the database and shown in history.
                  </p>
                </div>

                <button
                  onClick={handleProcess}
                  disabled={isProcessing || !rawBytesRef.current}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isProcessing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Processing…
                    </>
                  ) : (
                    'Process Data'
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Individual Files tab ──────────────────────────────────────── */}
        {activeTab === 'individual' && (
          <div className="space-y-6">
            {!monthlyPeriodId ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-700">
                Select or create a reporting period above to start uploading individual files.
              </div>
            ) : (
              <>
                <FileChecklist
                  monthlyPeriodId={monthlyPeriodId}
                  onFileUploaded={() => {/* period status auto-refreshes via MonthSelector on next select */}}
                />

                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowProcessingModal(true)}
                    disabled={isProcessing || !selectedPeriod}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Process Month
                  </button>
                  {selectedPeriod && selectedPeriod.missingSheets.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {selectedPeriod.missingSheets.length} required sheet{selectedPeriod.missingSheets.length !== 1 ? 's' : ''} still missing
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload History */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Upload History</h2>

          {loadingHistory ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : uploads.length === 0 ? (
            <p className="text-sm text-gray-400">No uploads yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs font-medium uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">File Name</th>
                    <th className="text-left px-4 py-3">Month</th>
                    <th className="text-left px-4 py-3">Uploaded At</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {uploads.map(u => (
                    <tr key={u._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 max-w-[180px] truncate" title={u.fileName}>
                        {u.fileName}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.month}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(u.uploadedAt).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            'px-2 py-0.5 rounded-full text-xs font-medium',
                            u.status === 'done'
                              ? 'bg-green-100 text-green-700'
                              : u.status === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700',
                          ].join(' ')}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleLoad(u._id)}
                          disabled={loadingId === u._id || !!loadingId}
                          className="text-blue-600 hover:underline text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {loadingId === u._id ? 'Loading…' : 'Load'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Processing modal */}
      {showProcessingModal && monthlyPeriodId && selectedPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Processing {selectedPeriod.month}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{selectedPeriod.fiscalQuarter} · {selectedPeriod.fiscalYear}</p>
              </div>
            </div>
            <ProcessingStatus
              monthlyPeriodId={monthlyPeriodId}
              month={selectedPeriod.month}
              onComplete={handleProcessComplete}
              onClose={() => setShowProcessingModal(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
