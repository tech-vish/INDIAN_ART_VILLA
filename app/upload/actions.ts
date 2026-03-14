'use server';

import * as XLSX from 'xlsx';
import type {
  PLOutput, OrdersSheet, KPISheet, AmazonStatewisePL,
  IntermediateSheets, ComparativePL, AmazonMonthlyPLRow, QuarterlyRollup,
} from '@/lib/types';
import { buildPL } from '@/lib/processors/plBuilder';

export interface ProcessWorkbookResult {
  uploadId:          string;
  pl:                PLOutput;
  errors:            string[];
  ordersSheet:       OrdersSheet;
  kpiSheet:          KPISheet;
  amazonStatewisePL: AmazonStatewisePL;
  intermediates:     IntermediateSheets;
  comparativePL:     ComparativePL[];
  amazonMonthlyRow:  AmazonMonthlyPLRow | Record<string, never>;
  quarterlyRollup:   QuarterlyRollup   | Record<string, never>;
}

export async function processWorkbook(formData: FormData): Promise<ProcessWorkbookResult> {
  const file = formData.get('file') as File | null;
  if (!file) throw new Error('No file provided.');

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

  const fileName = (formData.get('fileName') as string | null) ?? file.name;
  const month    = (formData.get('month')    as string | null) ?? '';

  const result = await buildPL(wb, fileName, month.trim());

  return {
    uploadId:          result.uploadId,
    pl:                result.pl,
    errors:            result.errors,
    ordersSheet:       result.ordersSheet,
    kpiSheet:          result.kpiSheet,
    amazonStatewisePL: result.amazonStatewisePL,
    intermediates:     result.intermediates,
    comparativePL:     [],  // comparativePL is not directly returned by buildPL currently; fetched from DB
    amazonMonthlyRow:  {},
    quarterlyRollup:   {},
  };
}
