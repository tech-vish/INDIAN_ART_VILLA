'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { detectMonthFromWorkbook } from '@/lib/utils/parser';

import { useRawDataStore } from '@/store/rawDataStore';
import { useOutputStore } from '@/store/outputStore';
import MonthSelector, { type MonthPeriodRecord } from '@/components/upload/MonthSelector';
import FileChecklist from '@/components/upload/FileChecklist';
import ProcessingStatus from '@/components/upload/ProcessingStatus';
import RawWorkbookEditor from '@/components/upload/RawWorkbookEditor';

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
const MAX_RAW_UPLOAD_CHUNK_BYTES = 2.8 * 1024 * 1024; // stays below common serverless body limits with form-data overhead
const MAX_ROWS_PER_UPLOAD_CHUNK = 4000;
const textEncoder = new TextEncoder();

function getCurrentMonth(): string {
  return new Date().toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

type CombinedStatusStage =
  | 'idle'
  | 'reading'
  | 'parsing'
  | 'ready'
  | 'serializing'
  | 'processing';

interface CombinedStatus {
  stage: CombinedStatusStage;
  fileName: string | null;
  fileSize: number | null;
  progressPct?: number;
  detail?: string;
}

type EditableCell = string | number | boolean | Date | null | undefined;
type EditableSheetMap = Record<string, EditableCell[][]>;

function cloneEditableRows(rows: EditableCell[][]): EditableCell[][] {
  return rows.map(row => [...row]);
}

function cloneEditableSheetMap(sheetMap: EditableSheetMap): EditableSheetMap {
  return Object.fromEntries(
    Object.entries(sheetMap).map(([sheetName, rows]) => [sheetName, cloneEditableRows(rows)]),
  );
}

function workbookToEditableSheetMap(workbook: XLSX.WorkBook): EditableSheetMap {
  const entries = workbook.SheetNames.map(sheetName => {
    const ws = workbook.Sheets[sheetName];
    const rows = ws
      ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as EditableCell[][])
      : [];
    return [sheetName, rows];
  });
  return Object.fromEntries(entries);
}

function buildWorkbookFromEditableMap(
  sheetNames: string[],
  editableSheets: EditableSheetMap,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const sheetName of sheetNames) {
    const rows = editableSheets[sheetName] ?? [];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  return wb;
}

function normalizeCellForTransport(value: EditableCell): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function trimTrailingEmptyCells<T>(row: T[], isEmpty: (v: T) => boolean): T[] {
  let end = row.length;
  while (end > 0 && isEmpty(row[end - 1])) {
    end -= 1;
  }
  return row.slice(0, end);
}

function buildSheetUploadChunks(sheetName: string, ws: XLSX.WorkSheet): Array<{
  chunkIndex: number;
  chunkTotal: number;
  headers: string[];
  rows: Array<Array<string | number | boolean | null>>;
}> {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as EditableCell[][];
  const headers = trimTrailingEmptyCells(
    (aoa[0] ?? []).map(v => String(v ?? '')),
    (v) => v.trim() === '',
  );

  const dataRows = aoa
    .slice(1)
    .map((row) => trimTrailingEmptyCells(
      row.map(normalizeCellForTransport),
      (v) => v === null || v === '',
    ))
    .filter((row) => row.length > 0);

  if (dataRows.length === 0) {
    return [{ chunkIndex: 1, chunkTotal: 1, headers, rows: [] }];
  }

  const chunks: Array<{ rows: Array<Array<string | number | boolean | null>> }> = [];
  let cursor = 0;

  while (cursor < dataRows.length) {
    const currentChunk: Array<Array<string | number | boolean | null>> = [];
    let chunkBytes = 2; // []

    while (cursor < dataRows.length && currentChunk.length < MAX_ROWS_PER_UPLOAD_CHUNK) {
      const nextRow = dataRows[cursor];
      const nextRowBytes = textEncoder.encode(JSON.stringify(nextRow)).length + 1;

      if (currentChunk.length > 0 && chunkBytes + nextRowBytes > MAX_RAW_UPLOAD_CHUNK_BYTES) {
        break;
      }

      if (currentChunk.length === 0 && nextRowBytes > MAX_RAW_UPLOAD_CHUNK_BYTES) {
        throw new Error(`Sheet '${sheetName}' has a very wide row that exceeds upload limits.`);
      }

      currentChunk.push(nextRow);
      chunkBytes += nextRowBytes;
      cursor += 1;
    }

    if (currentChunk.length === 0) {
      throw new Error(`Could not prepare upload chunks for sheet '${sheetName}'.`);
    }

    chunks.push({ rows: currentChunk });
  }

  const chunkTotal = chunks.length;
  return chunks.map((chunk, idx) => ({
    chunkIndex: idx + 1,
    chunkTotal,
    headers,
    rows: chunk.rows,
  }));
}

function getSheetWidth(rows: EditableCell[][]): number {
  let width = 0;
  for (const row of rows) {
    if (row.length > width) width = row.length;
  }
  return Math.max(1, width);
}

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
    setMonthlyPeriod,
  } = useRawDataStore();

  const { setUploadResult } = useOutputStore();

  const [activeTab, setActiveTab]               = useState<Tab>('combined');
  const [selectedPeriod, setSelectedPeriod]     = useState<MonthPeriodRecord | null>(null);
  const [showProcessingModal, setShowProcessingModal] = useState(false);

  const [month, setMonth]                       = useState<string>(getCurrentMonth);
  const [uploads, setUploads]                   = useState<UploadRecord[]>([]);
  const [loadingHistory, setLoadingHistory]     = useState(false);
  const [loadingId, setLoadingId]               = useState<string | null>(null);
  const [editableSheets, setEditableSheets]     = useState<EditableSheetMap>({});
  const [initialEditableSheets, setInitialEditableSheets] = useState<EditableSheetMap>({});
  const [hasRawEdits, setHasRawEdits]           = useState(false);
  const [combinedStatus, setCombinedStatus]     = useState<CombinedStatus>({
    stage: 'idle',
    fileName: null,
    fileSize: null,
  });

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
      setCombinedStatus({
        stage: 'reading',
        fileName: file.name,
        fileSize: file.size,
        progressPct: 0,
        detail: 'Reading selected workbook…',
      });

      if (file.size > MAX_BYTES) {
        setError('File is too large. Maximum allowed size is 50 MB.');
        setCombinedStatus({
          stage: 'idle',
          fileName: null,
          fileSize: null,
        });
        return;
      }

      const reader = new FileReader();
      reader.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const progressPct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
        setCombinedStatus(prev => (
          prev.stage === 'reading'
            ? { ...prev, progressPct }
            : prev
        ));
      };

      reader.onload = e => {
        const buffer = e.target?.result as ArrayBuffer;
        try {
          setCombinedStatus(prev => ({
            ...prev,
            stage: 'parsing',
            detail: 'Parsing workbook sheets…',
            progressPct: 100,
          }));

          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
          setWorkbook(wb, file.name);
          const editable = workbookToEditableSheetMap(wb);
          setEditableSheets(editable);
          setInitialEditableSheets(cloneEditableSheetMap(editable));
          setHasRawEdits(false);
          setCombinedStatus(prev => ({
            ...prev,
            stage: 'ready',
            detail: `${wb.SheetNames.length} sheet${wb.SheetNames.length !== 1 ? 's' : ''} ready for review.`,
            progressPct: undefined,
          }));
          // 14G: Auto-detect month from workbook sheet names and pre-fill if field is empty
          const detected = detectMonthFromWorkbook(wb);
          if (detected) setMonth(prev => (prev === getCurrentMonth() || !prev.trim()) ? detected : prev);
        } catch {
          setError('Could not parse file. Make sure it is a valid .xlsx workbook.');
          setEditableSheets({});
          setInitialEditableSheets({});
          setHasRawEdits(false);
          setCombinedStatus({
            stage: 'idle',
            fileName: null,
            fileSize: null,
          });
        }
      };

      reader.onerror = () => {
        setError('Could not read the file. Please try uploading again.');
        setCombinedStatus({
          stage: 'idle',
          fileName: null,
          fileSize: null,
        });
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
    setEditableSheets({});
    setInitialEditableSheets({});
    setHasRawEdits(false);
    setCombinedStatus({
      stage: 'idle',
      fileName: null,
      fileSize: null,
    });
    setError(null);
  };

  const handleCellChange = (sheetName: string, rowIndex: number, colIndex: number, value: string) => {
    setEditableSheets(prev => {
      const nextRows = cloneEditableRows(prev[sheetName] ?? []);

      while (nextRows.length <= rowIndex) {
        nextRows.push([]);
      }

      const targetRow = [...(nextRows[rowIndex] ?? [])];
      while (targetRow.length <= colIndex) {
        targetRow.push('');
      }
      targetRow[colIndex] = value;
      nextRows[rowIndex] = targetRow;

      return {
        ...prev,
        [sheetName]: nextRows,
      };
    });
    setHasRawEdits(true);
  };

  const handleAddRow = (sheetName: string) => {
    setEditableSheets(prev => {
      const nextRows = cloneEditableRows(prev[sheetName] ?? []);
      const width = getSheetWidth(nextRows);
      nextRows.push(Array.from({ length: width }, () => ''));
      return { ...prev, [sheetName]: nextRows };
    });
    setHasRawEdits(true);
  };

  const handleAddColumn = (sheetName: string) => {
    setEditableSheets(prev => {
      const nextRows = cloneEditableRows(prev[sheetName] ?? []);
      if (nextRows.length === 0) {
        nextRows.push(['']);
      } else {
        const width = getSheetWidth(nextRows);
        for (let i = 0; i < nextRows.length; i += 1) {
          const row = [...nextRows[i]];
          row[width] = '';
          nextRows[i] = row;
        }
      }
      return { ...prev, [sheetName]: nextRows };
    });
    setHasRawEdits(true);
  };

  const handleResetSheet = (sheetName: string) => {
    const next = {
      ...editableSheets,
      [sheetName]: cloneEditableRows(initialEditableSheets[sheetName] ?? []),
    };
    setEditableSheets(next);

    const changed = Object.keys(next).some(name => {
      const current = JSON.stringify(next[name] ?? []);
      const initial = JSON.stringify(initialEditableSheets[name] ?? []);
      return current !== initial;
    });
    setHasRawEdits(changed);
  };

  const handleResetAllSheets = () => {
    setEditableSheets(cloneEditableSheetMap(initialEditableSheets));
    setHasRawEdits(false);
  };

  const handleProcess = async () => {
    if (!workbook || !fileName) return;

    if (!month.trim()) {
      setError('Please enter a reporting month before processing.');
      return;
    }

    setProcessing(true);
    setError(null);

    let processedSuccessfully = false;

    try {
      setCombinedStatus(prev => ({
        ...prev,
        stage: 'serializing',
        detail: hasRawEdits
          ? 'Preparing edited workbook for processing…'
          : 'Preparing workbook for processing…',
        progressPct: undefined,
      }));

      // Ensure we process against a persisted monthly period.
      const periodRes = await fetch('/api/monthly-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month.trim() }),
      });
      const periodData = await periodRes.json();
      if (!periodRes.ok || !periodData?.period?._id) {
        throw new Error(periodData?.error ?? 'Could not prepare reporting period.');
      }
      const resolvedPeriodId = String(periodData.period._id);
      setMonthlyPeriod(resolvedPeriodId);

      const workbookToProcess = Object.keys(editableSheets).length
        ? buildWorkbookFromEditableMap(workbook.SheetNames, editableSheets)
        : workbook;

      // Upload each sheet as an individual small COMBINED_WORKBOOK payload to avoid
      // large function payloads in production deployments.
      const sheetNames = workbookToProcess.SheetNames;
      if (sheetNames.length === 0) {
        throw new Error('Workbook has no sheets to upload.');
      }

      const uploadUnits: Array<{
        sheetName: string;
        chunkIndex: number;
        chunkTotal: number;
        headers: string[];
        rows: Array<Array<string | number | boolean | null>>;
      }> = [];
      for (const sheetName of sheetNames) {
        const worksheet = workbookToProcess.Sheets[sheetName];
        if (!worksheet) continue;
        const chunks = buildSheetUploadChunks(sheetName, worksheet);
        uploadUnits.push(...chunks.map(chunk => ({
          sheetName,
          chunkIndex: chunk.chunkIndex,
          chunkTotal: chunk.chunkTotal,
          headers: chunk.headers,
          rows: chunk.rows,
        })));
      }

      if (uploadUnits.length === 0) {
        throw new Error('No sheet chunks were generated for upload.');
      }

      let completedUploads = 0;
      const totalUploads = uploadUnits.length;
      const concurrency = Math.min(10, Math.max(1, totalUploads - 1));

      const uploadUnit = async (
        unit: {
          sheetName: string;
          chunkIndex: number;
          chunkTotal: number;
          headers: string[];
          rows: Array<Array<string | number | boolean | null>>;
        },
        resetCombined = false,
      ) => {
        setCombinedStatus(prev => ({
          ...prev,
          stage: 'processing',
          detail: `Uploading ${unit.sheetName} (chunk ${unit.chunkIndex}/${unit.chunkTotal})… ${completedUploads}/${totalUploads} completed`,
          progressPct: Math.round((completedUploads / totalUploads) * 100),
        }));

        const rawRes = await fetch('/api/raw-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName,
            fileType: 'COMBINED_WORKBOOK',
            monthlyPeriodId: resolvedPeriodId,
            sheetName: unit.sheetName,
            headers: unit.headers,
            rows: unit.rows,
            chunkIndex: unit.chunkIndex,
            chunkTotal: unit.chunkTotal,
            resetCombined,
          }),
        });
        const rawData = await rawRes.json().catch(() => ({}));
        if (!rawRes.ok) {
          throw new Error(rawData?.error ?? `Failed to upload raw sheet: ${unit.sheetName}`);
        }

        completedUploads += 1;
        setCombinedStatus(prev => ({
          ...prev,
          stage: 'processing',
          detail: `Uploaded ${completedUploads}/${totalUploads} raw chunks…`,
          progressPct: Math.round((completedUploads / totalUploads) * 100),
        }));
      };

      // First upload resets any prior combined snapshot docs for this period.
      const [firstUnit, ...restUnits] = uploadUnits;
      if (firstUnit) {
        await uploadUnit(firstUnit, true);
      }

      const uploadQueue = [...restUnits];

      const worker = async () => {
        while (uploadQueue.length > 0) {
          const nextUnit = uploadQueue.shift();
          if (!nextUnit) break;
          await uploadUnit(nextUnit);
        }
      };

      if (uploadQueue.length > 0) {
        await Promise.all(Array.from({ length: Math.min(concurrency, uploadQueue.length) }, () => worker()));
      }

      setCombinedStatus(prev => ({
        ...prev,
        stage: 'processing',
        detail: 'Finalizing uploaded raw sheets…',
      }));

      const finalizeRes = await fetch('/api/raw-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileType: 'COMBINED_WORKBOOK',
          monthlyPeriodId: resolvedPeriodId,
          fileName,
          finalizeCombined: true,
        }),
      });
      const finalizeData = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        throw new Error(finalizeData?.error ?? 'Failed to finalize combined workbook upload.');
      }

      setCombinedStatus(prev => ({
        ...prev,
        stage: 'processing',
        detail: 'Running processors and generating final sheets…',
        progressPct: 100,
      }));

      const processRes = await fetch('/api/process-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyPeriodId: resolvedPeriodId,
          month: month.trim(),
        }),
      });

      const result = await processRes.json();
      if (!processRes.ok) {
        const suffix = Array.isArray(result?.missingSheets) && result.missingSheets.length
          ? ` Missing: ${result.missingSheets.join(', ')}`
          : '';
        throw new Error((result?.error ?? 'Processing failed.') + suffix);
      }

      processedSuccessfully = true;

      setCombinedStatus(prev => ({
        ...prev,
        stage: 'processing',
        detail: 'Final sheets generated. Opening dashboard…',
      }));

      setUploadResult(result.uploadId, result.month ?? month, result.pl, result.errors ?? [], {
        ordersSheet:       result.ordersSheet,
        kpiSheet:          result.kpiSheet,
        amazonStatewisePL: result.amazonStatewisePL,
        intermediates:     result.intermediates,
      });
      router.push('/dashboard');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Processing failed.');
      setCombinedStatus(prev => ({
        ...prev,
        stage: 'ready',
        detail: 'Processing failed. Please retry after checking the workbook.',
      }));
    } finally {
      setProcessing(false);
      if (!processedSuccessfully && workbook) {
        setCombinedStatus(prev => ({
          ...prev,
          stage: 'ready',
          detail: prev.detail ?? `${workbook.SheetNames.length} sheets ready for review.`,
        }));
      }
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

            {(combinedStatus.stage !== 'idle' || workbook) && (
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {(combinedStatus.stage === 'reading' || combinedStatus.stage === 'parsing' || combinedStatus.stage === 'serializing' || combinedStatus.stage === 'processing') ? (
                      <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-green-500" />
                    )}
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {combinedStatus.fileName ?? fileName ?? 'No file selected'}
                    </p>
                  </div>
                  {combinedStatus.fileSize != null && (
                    <span className="text-xs text-gray-500">
                      {formatMegabytes(combinedStatus.fileSize)}
                    </span>
                  )}
                </div>

                <p className="text-xs text-gray-600">
                  {combinedStatus.detail ?? (workbook ? 'Workbook is ready.' : 'Select a workbook to continue.')}
                </p>

                {(combinedStatus.stage === 'reading' || combinedStatus.stage === 'processing') && typeof combinedStatus.progressPct === 'number' && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${combinedStatus.progressPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {combinedStatus.stage === 'reading' ? 'Reading' : 'Uploading'} {combinedStatus.progressPct}%
                    </p>
                  </div>
                )}
              </div>
            )}

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

            {workbook && (
              <div className="relative left-1/2 w-[100dvw] -translate-x-1/2 px-4 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-[1800px]">
                  <RawWorkbookEditor
                    sheetNames={workbook.SheetNames}
                    sheetData={editableSheets}
                    hasEdits={hasRawEdits}
                    fullPage
                    onCellChange={handleCellChange}
                    onAddRow={handleAddRow}
                    onAddColumn={handleAddColumn}
                    onResetSheet={handleResetSheet}
                    onResetAll={handleResetAllSheets}
                  />
                </div>
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
                  disabled={isProcessing || !workbook}
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
                    hasRawEdits ? 'Convert Edited Workbook To Final Sheets' : 'Convert To Final Sheets'
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

      {activeTab === 'combined' && isProcessing && (
        <div className="fixed inset-0 z-[60] bg-black/40 p-4 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-6 w-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">Converting Workbook</h2>
                <p className="text-sm text-gray-600 truncate mt-0.5">
                  {combinedStatus.fileName ?? fileName ?? 'Current workbook'}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-blue-700 animate-pulse">
                {combinedStatus.detail ?? 'Processing your workbook…'}
              </div>
              <p className="text-xs text-gray-500">
                Please keep this page open. Large workbooks can take a little time.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
