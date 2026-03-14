import { create } from 'zustand';
import * as XLSX from 'xlsx';
import type { FileType } from '@/lib/fileTypeRegistry';

export interface UploadedFileInfo {
  fileName: string;
  uploadedAt: Date;
  sheetsFound: string[];
  fileId: string;       // RawFileStore._id
}

interface RawDataState {
  // ── Combined workbook mode ────────────────────────────────────────────
  workbook: XLSX.WorkBook | null;
  fileName: string | null;
  uploadedAt: Date | null;

  // ── Individual files mode ─────────────────────────────────────────────
  monthlyPeriodId: string | null;
  /** Tracks which file types have been uploaded for the active period */
  uploadedFileTypes: Partial<Record<FileType, UploadedFileInfo>>;

  // ── Shared ────────────────────────────────────────────────────────────
  isProcessing: boolean;
  error: string | null;

  // Actions
  setWorkbook: (wb: XLSX.WorkBook, fileName: string) => void;
  clearWorkbook: () => void;
  setProcessing: (v: boolean) => void;
  setError: (e: string | null) => void;

  setMonthlyPeriod: (id: string | null) => void;
  markFileUploaded: (type: FileType, info: UploadedFileInfo) => void;
  removeUploadedFile: (type: FileType) => void;
  clearIndividualFiles: () => void;
}

export const useRawDataStore = create<RawDataState>(set => ({
  workbook: null,
  fileName: null,
  uploadedAt: null,
  monthlyPeriodId: null,
  uploadedFileTypes: {},
  isProcessing: false,
  error: null,

  setWorkbook: (wb, fileName) => set({ workbook: wb, fileName, uploadedAt: new Date(), error: null }),
  clearWorkbook: () => set({ workbook: null, fileName: null, uploadedAt: null }),
  setProcessing: isProcessing => set({ isProcessing }),
  setError: error => set({ error }),

  setMonthlyPeriod: (id) => set({ monthlyPeriodId: id }),
  markFileUploaded: (type, info) =>
    set(s => ({ uploadedFileTypes: { ...s.uploadedFileTypes, [type]: info } })),
  removeUploadedFile: (type) =>
    set(s => {
      const next = { ...s.uploadedFileTypes };
      delete next[type];
      return { uploadedFileTypes: next };
    }),
  clearIndividualFiles: () => set({ uploadedFileTypes: {}, monthlyPeriodId: null }),
}));