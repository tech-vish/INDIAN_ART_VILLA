'use client';

import { useCallback, useRef, useState } from 'react';
import { FILE_TYPES, FileType } from '@/lib/fileTypeRegistry';
import { useRawDataStore, UploadedFileInfo } from '@/store/rawDataStore';
import SmartSheetDetector from './SmartSheetDetector';

// ── Types ─────────────────────────────────────────────────────────────────

type SlotStatus = 'idle' | 'uploading' | 'uploaded' | 'error';

interface SlotState {
  status: SlotStatus;
  error?: string;
}

interface Props {
  monthlyPeriodId: string;
  onFileUploaded?: () => void;
}

// ── Grouping ──────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  'Amazon Seller Central',
  'Flipkart Seller Hub',
  'Tally/Busy',
  'Unicommerce/Tally',
  'Manual',
] as const;

const FILE_TYPE_ENTRIES = (
  Object.entries(FILE_TYPES) as [FileType, (typeof FILE_TYPES)[FileType]][]
).filter(([ft]) => ft !== 'COMBINED_WORKBOOK');

const REQUIRED_COUNT = FILE_TYPE_ENTRIES.filter(([, cfg]) => cfg.required).length;

// ── Icon helpers ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SlotStatus }) {
  if (status === 'uploading') {
    return (
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
    );
  }
  if (status === 'uploaded') {
    return (
      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  // idle
  return (
    <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0" />
  );
}

// ── File slot ─────────────────────────────────────────────────────────────

interface SlotProps {
  fileType: FileType;
  cfg: (typeof FILE_TYPES)[FileType];
  slot: SlotState;
  info?: UploadedFileInfo;
  onFilePicked: (fileType: FileType, file: File) => void;
  onDelete: (fileType: FileType) => void;
}

function FileSlot({ fileType, cfg, slot, info, onFilePicked, onDelete }: SlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) return;
    onFilePicked(fileType, f);
  };

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileType, onFilePicked]);

  const isClickable = slot.status === 'idle' || slot.status === 'error';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors
        ${dragging                   ? 'border-blue-400 bg-blue-50' :
          slot.status === 'uploaded' ? 'border-green-200 bg-green-50' :
          slot.status === 'error'    ? 'border-red-200 bg-red-50' :
                                       'border-gray-200 bg-white hover:border-gray-300'}
        ${isClickable                ? 'cursor-pointer' : ''}
      `}
      onClick={() => isClickable && inputRef.current?.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <StatusIcon status={slot.status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700 truncate">{cfg.label}</span>
          {!cfg.required && (
            <span className="text-xs text-gray-400 font-normal">(optional)</span>
          )}
        </div>

        {slot.status === 'uploaded' && info && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {info.fileName}
            {info.sheetsFound.length > 0 && <span className="ml-1 text-gray-400">· {info.sheetsFound.length} sheet{info.sheetsFound.length !== 1 ? 's' : ''}</span>}
          </p>
        )}
        {slot.status === 'error' && (
          <p className="text-xs text-red-500 mt-0.5">{slot.error ?? 'Upload failed'} — click to retry</p>
        )}
        {slot.status === 'idle' && (
          <p className="text-xs text-gray-400 mt-0.5">Drop .xlsx or click to browse</p>
        )}
      </div>

      {slot.status === 'uploaded' && info && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(fileType); }}
          className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors shrink-0"
          title="Remove file"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
        onClick={e => { (e.target as HTMLInputElement).value = ''; }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function FileChecklist({ monthlyPeriodId, onFileUploaded }: Props) {
  const { uploadedFileTypes, markFileUploaded, removeUploadedFile } = useRawDataStore();

  const [slots,    setSlots]    = useState<Partial<Record<FileType, SlotState>>>({});
  const [detector, setDetector] = useState<{ file: File; targetType: FileType } | null>(null);

  const uploadedRequired = FILE_TYPE_ENTRIES.filter(([ft, cfg]) => cfg.required && uploadedFileTypes[ft]).length;

  // ── Set slot status ───────────────────────────────────────────────────

  const setSlot = (ft: FileType, state: SlotState) =>
    setSlots(prev => ({ ...prev, [ft]: state }));

  // ── Upload a file after type is confirmed ─────────────────────────────

  const doUpload = async (fileType: FileType, file: File) => {
    setSlot(fileType, { status: 'uploading' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fileType', fileType);
      fd.append('monthlyPeriodId', monthlyPeriodId);

      const r = await fetch('/api/raw-upload', { method: 'POST', body: fd });
      const data = await r.json();

      if (!r.ok) {
        setSlot(fileType, { status: 'error', error: data.error ?? 'Upload failed' });
        return;
      }

      const info: UploadedFileInfo = {
        fileName:    file.name,
        uploadedAt:  new Date(),
        sheetsFound: data.sheetsDetected ?? [],
        fileId:      data.fileId,
      };
      markFileUploaded(fileType, info);
      setSlot(fileType, { status: 'uploaded' });
      onFileUploaded?.();
    } catch {
      setSlot(fileType, { status: 'error', error: 'Network error' });
    }
  };

  // ── Delete a file ─────────────────────────────────────────────────────

  const handleDelete = async (fileType: FileType) => {
    const info = uploadedFileTypes[fileType];
    if (!info) return;
    try {
      await fetch(`/api/raw-upload?fileId=${encodeURIComponent(info.fileId)}&monthlyPeriodId=${encodeURIComponent(monthlyPeriodId)}`, {
        method: 'DELETE',
      });
      removeUploadedFile(fileType);
      setSlot(fileType, { status: 'idle' });
    } catch {
      // best-effort; remove from UI anyway
      removeUploadedFile(fileType);
      setSlot(fileType, { status: 'idle' });
    }
  };

  // ── File picked on a slot ─────────────────────────────────────────────

  const handleFilePicked = (targetType: FileType, file: File) => {
    // Always run SmartSheetDetector; it auto-confirms when unambiguous
    setDetector({ file, targetType });
  };

  // ── SmartSheetDetector callbacks ──────────────────────────────────────

  const handleDetectorConfirm = (fileType: FileType) => {
    const file = detector!.file;
    setDetector(null);
    doUpload(fileType, file);
  };

  const handleDetectorCancel = () => setDetector(null);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-700">
            {uploadedRequired} of {REQUIRED_COUNT} required files uploaded
          </span>
          {uploadedRequired === REQUIRED_COUNT && (
            <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded">Ready to process</span>
          )}
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500
              ${uploadedRequired === REQUIRED_COUNT ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${(uploadedRequired / REQUIRED_COUNT) * 100}%` }}
          />
        </div>
      </div>

      {/* Groups */}
      {ALL_SOURCES.map(source => {
        const entries = FILE_TYPE_ENTRIES.filter(([, cfg]) => cfg.source === source);
        if (!entries.length) return null;

        return (
          <div key={source}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{source}</h3>
            <div className="space-y-1.5">
              {entries.map(([ft, cfg]) => {
                const slot: SlotState = slots[ft] ??
                  (uploadedFileTypes[ft] ? { status: 'uploaded' } : { status: 'idle' });

                return (
                  <FileSlot
                    key={ft}
                    fileType={ft}
                    cfg={cfg}
                    slot={slot}
                    info={uploadedFileTypes[ft]}
                    onFilePicked={handleFilePicked}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* SmartSheetDetector modal */}
      {detector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Detect File Type</h2>
                <p className="text-sm text-gray-500 mt-0.5">{detector.file.name}</p>
              </div>
              <button onClick={handleDetectorCancel} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SmartSheetDetector
              file={detector.file}
              onConfirm={handleDetectorConfirm}
              onCancel={handleDetectorCancel}
            />
          </div>
        </div>
      )}
    </div>
  );
}
