/**
 * workbookAssembler.ts
 *
 * Assembles a virtual XLSX.WorkBook from one or more RawFileStore documents.
 * The resulting workbook is identical in structure to a manually built master
 * workbook, so all existing processors (amazonProcessor, flipkartProcessor, …)
 * work without modification.
 *
 * Usage:
 *   const rawFiles = await RawFileStore.find({ monthlyPeriodId });
 *   const wb = assembleWorkbook(rawFiles);
 *   const result = await buildPL(wb, 'assembled', month, monthlyPeriodId);
 */
import * as XLSX from 'xlsx';
import type { IRawFileStore } from '../db/models/RawFileStore';
import { FILE_TYPES, resolveSheetName } from '../fileTypeRegistry';
import type { FileType } from '../fileTypeRegistry';

/**
 * Converts a stored ISheetData back into an XLSX.WorkSheet.
 * headers + data rows are re-joined so cell addresses are consistent with
 * what SheetJS produces when you call XLSX.utils.aoa_to_sheet().
 */
function sheetDataToWorksheet(
  headers: string[],
  data: unknown[][],
): XLSX.WorkSheet {
  const aoa: unknown[][] = [headers, ...data];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/**
 * Assembles all RawFileStore documents for a single monthly period into one
 * XLSX.WorkBook that can be handed directly to buildPL().
 *
 * Sheet-name conflict resolution:
 * - If the same canonical sheet name appears in more than one file, the first
 *   occurrence wins (the file uploaded most recently should have been stored
 *   last, so callers should sort `rawFiles` newest-first if they want the
 *   latest version of a sheet to take precedence).
 * - Generic names like "Sheet1" are remapped (or ignored) using each file
 *   type's `sheetNameAliases` configuration.
 */
export function assembleWorkbook(rawFiles: IRawFileStore[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  // Track which canonical sheet names have already been added
  const addedSheets = new Set<string>();

  for (const rawFile of rawFiles) {
    const fileType = rawFile.fileType as FileType;

    for (const sheetData of rawFile.sheets) {
      // Resolve the raw sheet name using aliases (may return null = skip)
      const canonicalName = FILE_TYPES[fileType]
        ? resolveSheetName(sheetData.sheetName, fileType)
        : sheetData.sheetName;

      if (canonicalName === null) continue;  // explicitly ignored
      if (addedSheets.has(canonicalName)) continue;  // first-wins dedup

      const ws = sheetDataToWorksheet(sheetData.headers, sheetData.data);
      XLSX.utils.book_append_sheet(wb, ws, canonicalName);
      addedSheets.add(canonicalName);
    }
  }

  return wb;
}

/**
 * Parses a raw XLSX.WorkBook (the in-memory workbook uploaded by a user) and
 * extracts sheet data into the ISheetData format expected by RawFileStore.
 *
 * This is the inverse of assembleWorkbook — called during the file-upload
 * Server Action to persist the raw sheet contents before buildPL() runs.
 *
 * @param wb       Parsed XLSX.WorkBook from the uploaded file
 * @param fileType The FILE_TYPES key that identifies this upload
 * @returns        Array of ISheetData objects ready to store in RawFileStore
 */
export function extractSheetData(
  wb: XLSX.WorkBook,
  fileType: FileType,
): Array<{
  sheetName: string;
  headers: string[];
  data: unknown[][];
  rowCount: number;
}> {
  const results: Array<{
    sheetName: string;
    headers: string[];
    data: unknown[][];
    rowCount: number;
  }> = [];

  for (const rawSheetName of wb.SheetNames) {
    // Apply alias mapping
    const canonicalName = resolveSheetName(rawSheetName, fileType);
    if (canonicalName === null) continue;  // ignored sheet

    const ws = wb.Sheets[rawSheetName];
    if (!ws) continue;

    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (aoa.length === 0) continue;

    const headers = (aoa[0] as unknown[]).map(v => (v == null ? '' : String(v)));
    const data    = aoa.slice(1) as unknown[][];

    results.push({
      sheetName: canonicalName,
      headers,
      data,
      rowCount: data.length,
    });
  }

  return results;
}
