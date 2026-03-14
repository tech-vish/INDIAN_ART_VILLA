import { create } from 'zustand';
import type {
  PLOutput, MonthlyAmazonRow, StatewisePL,
  OrdersSheet, KPISheet, AmazonStatewisePL,
  IntermediateSheets, ComparativePL, AmazonMonthlyPLRow, QuarterlyRollup,
} from '../lib/types';

/** Extra computed sheets beyond PLOutput */
export interface UploadExtras {
  ordersSheet?:       OrdersSheet        | null;
  kpiSheet?:          KPISheet           | null;
  amazonStatewisePL?: AmazonStatewisePL  | null;
  intermediates?:     IntermediateSheets | null;
  comparativePL?:     ComparativePL[]    | null;
  amazonMonthlyRow?:  AmazonMonthlyPLRow | null;
  quarterlyRollup?:   QuarterlyRollup    | null;
}

interface OutputState {
  uploadId:          string | null;
  month:             string | null;
  cachedPL:          PLOutput            | null;
  processingErrors:  string[];
  isFetching:        boolean;

  // Extended computed sheets (populated from upload or API fetch)
  ordersSheet:       OrdersSheet        | null;
  kpiSheet:          KPISheet           | null;
  amazonStatewisePL: AmazonStatewisePL  | null;
  intermediates:     IntermediateSheets | null;
  comparativePL:     ComparativePL[]    | null;
  amazonMonthlyRow:  AmazonMonthlyPLRow | null;
  quarterlyRollup:   QuarterlyRollup    | null;

  setUploadResult: (
    uploadId: string,
    month: string,
    pl: PLOutput,
    errors: string[],
    extras?: UploadExtras,
  ) => void;
  setFetching: (v: boolean) => void;
  clearOutput: () => void;
}

export const useOutputStore = create<OutputState>(set => ({
  uploadId:          null,
  month:             null,
  cachedPL:          null,
  processingErrors:  [],
  isFetching:        false,
  ordersSheet:       null,
  kpiSheet:          null,
  amazonStatewisePL: null,
  intermediates:     null,
  comparativePL:     null,
  amazonMonthlyRow:  null,
  quarterlyRollup:   null,

  setUploadResult: (uploadId, month, pl, errors, extras = {}) =>
    set({
      uploadId, month,
      cachedPL:          pl,
      processingErrors:  errors,
      ordersSheet:       extras.ordersSheet       ?? null,
      kpiSheet:          extras.kpiSheet          ?? null,
      amazonStatewisePL: extras.amazonStatewisePL ?? null,
      intermediates:     extras.intermediates     ?? null,
      comparativePL:     extras.comparativePL     ?? null,
      amazonMonthlyRow:  extras.amazonMonthlyRow  ?? null,
      quarterlyRollup:   extras.quarterlyRollup   ?? null,
    }),

  setFetching: (v) => set({ isFetching: v }),

  clearOutput: () =>
    set({
      uploadId: null, month: null,
      cachedPL: null, processingErrors: [], isFetching: false,
      ordersSheet: null, kpiSheet: null, amazonStatewisePL: null,
      intermediates: null, comparativePL: null,
      amazonMonthlyRow: null, quarterlyRollup: null,
    }),
}));

// ── Selector hooks ────────────────────────────────────────────────────────
export const usePLOutput          = () => useOutputStore(s => s.cachedPL);
export const useOrdersSheet       = () => useOutputStore(s => s.ordersSheet);
export const useKPISheet          = () => useOutputStore(s => s.kpiSheet);
export const useAmazonStatewisePL = () => useOutputStore(s => s.amazonStatewisePL);
export const useIntermediates     = () => useOutputStore(s => s.intermediates);
export const useComparativePL     = () => useOutputStore(s => s.comparativePL);
export const useAmazonMonthlyRow  = () => useOutputStore(s => s.amazonMonthlyRow);
export const useQuarterlyRollup   = () => useOutputStore(s => s.quarterlyRollup);
export const useMonthlyRows       = (): MonthlyAmazonRow[] => [];
export const useStatewiseRows     = (): StatewisePL[] => [];
export const useIsComputing       = () => false;
export const useHasAnyData        = () => useOutputStore(s => s.cachedPL !== null);