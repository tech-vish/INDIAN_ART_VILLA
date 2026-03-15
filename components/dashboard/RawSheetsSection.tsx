'use client';

import { useEffect, useMemo, useState } from 'react';

interface RawSheetsSectionProps {
  uploadId: string | null;
}

interface SheetMeta {
  sheetName: string;
  rowCount: number;
  columnCount: number;
}

interface SheetRowsResponse {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  offset: number;
  limit: number;
  source: string;
}

const PAGE_SIZES = [50, 100, 250] as const;

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getMaxCols(headers: string[], rows: unknown[][]): number {
  let max = headers.length;
  for (const row of rows) {
    if (row.length > max) max = row.length;
  }
  return Math.max(1, max);
}

export default function RawSheetsSection({ uploadId }: RawSheetsSectionProps) {
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');

  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);

  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [sheetRows, setSheetRows] = useState<SheetRowsResponse | null>(null);

  useEffect(() => {
    setPage(0);
  }, [activeSheet, pageSize]);

  useEffect(() => {
    if (!uploadId) {
      setSheets([]);
      setActiveSheet('');
      return;
    }

    let ignore = false;
    setLoadingSheets(true);
    setSheetsError(null);

    fetch(`/api/raw-sheets?uploadId=${encodeURIComponent(uploadId)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Server returned ${response.status}.`);
        return payload as { sheets: SheetMeta[] };
      })
      .then((payload) => {
        if (ignore) return;
        const nextSheets = payload.sheets ?? [];
        setSheets(nextSheets);
        setActiveSheet((prev) => (prev && nextSheets.some((sheet) => sheet.sheetName === prev)
          ? prev
          : (nextSheets[0]?.sheetName ?? '')));
      })
      .catch((e: unknown) => {
        if (ignore) return;
        setSheetsError(e instanceof Error ? e.message : 'Failed to load raw sheets.');
      })
      .finally(() => {
        if (!ignore) setLoadingSheets(false);
      });

    return () => {
      ignore = true;
    };
  }, [uploadId]);

  useEffect(() => {
    if (!uploadId || !activeSheet) {
      setSheetRows(null);
      return;
    }

    let ignore = false;
    const offset = page * pageSize;

    setLoadingRows(true);
    setRowsError(null);

    fetch(
      `/api/raw-sheets?uploadId=${encodeURIComponent(uploadId)}&sheetName=${encodeURIComponent(activeSheet)}&offset=${offset}&limit=${pageSize}`,
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Server returned ${response.status}.`);
        return payload as SheetRowsResponse;
      })
      .then((payload) => {
        if (ignore) return;
        setSheetRows(payload);
      })
      .catch((e: unknown) => {
        if (ignore) return;
        setRowsError(e instanceof Error ? e.message : 'Failed to load sheet rows.');
      })
      .finally(() => {
        if (!ignore) setLoadingRows(false);
      });

    return () => {
      ignore = true;
    };
  }, [uploadId, activeSheet, page, pageSize]);

  const maxCols = useMemo(() => {
    if (!sheetRows) return 1;
    return getMaxCols(sheetRows.headers ?? [], sheetRows.rows ?? []);
  }, [sheetRows]);

  const totalRows = sheetRows?.totalRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const startRow = totalRows === 0 ? 0 : page * pageSize + 1;
  const endRow = Math.min(totalRows, (page + 1) * pageSize);

  const activeMeta = sheets.find((sheet) => sheet.sheetName === activeSheet) ?? null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Raw Sheets</h2>
        <p className="text-sm text-gray-500 mt-1">
          View uploaded raw sheet data for this report before/after final computed sheets.
        </p>
      </div>

      {!uploadId && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Load a processed upload to view raw sheets.
        </div>
      )}

      {uploadId && loadingSheets && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Loading raw sheets…
        </div>
      )}

      {uploadId && sheetsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {sheetsError}
        </div>
      )}

      {uploadId && !loadingSheets && !sheetsError && sheets.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Raw sheet snapshots are not available for this upload.
        </div>
      )}

      {uploadId && sheets.length > 0 && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sheets.map((sheet) => {
              const isActive = sheet.sheetName === activeSheet;
              return (
                <button
                  key={sheet.sheetName}
                  onClick={() => setActiveSheet(sheet.sheetName)}
                  className={[
                    'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
                  ].join(' ')}
                >
                  {sheet.sheetName}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span>Rows: {activeMeta?.rowCount ?? 0}</span>
            <span>Columns: {activeMeta?.columnCount ?? 0}</span>
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="raw-page-size">Rows per page</label>
              <select
                id="raw-page-size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border border-gray-300 px-2 py-1 bg-white"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>

          {rowsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {rowsError}
            </div>
          )}

          <div className="overflow-auto border border-gray-200 rounded-lg max-h-[560px]">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold text-gray-500 border-b border-gray-200">Row</th>
                  {Array.from({ length: maxCols }).map((_, colIndex) => {
                    const colHeader = sheetRows?.headers?.[colIndex]?.trim() || `Col ${colIndex + 1}`;
                    return (
                      <th key={colIndex} className="px-2 py-2 text-left font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap">
                        {colHeader}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loadingRows ? (
                  <tr>
                    <td colSpan={maxCols + 1} className="px-3 py-6 text-center text-gray-500">
                      Loading rows…
                    </td>
                  </tr>
                ) : (sheetRows?.rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={maxCols + 1} className="px-3 py-6 text-center text-gray-500">
                      No data in this sheet.
                    </td>
                  </tr>
                ) : (
                  (sheetRows?.rows ?? []).map((row, rowIndex) => {
                    const rowNumber = page * pageSize + rowIndex + 1;
                    return (
                      <tr key={rowNumber} className="odd:bg-white even:bg-gray-50/40">
                        <td className="px-2 py-1.5 text-gray-500 border-b border-gray-100 whitespace-nowrap">{rowNumber}</td>
                        {Array.from({ length: maxCols }).map((_, colIndex) => (
                          <td key={colIndex} className="px-2 py-1.5 text-gray-800 border-b border-gray-100 whitespace-nowrap">
                            {formatCell(row?.[colIndex])}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>
              Showing {startRow} to {endRow} of {totalRows} rows
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
              >
                Prev
              </button>
              <span>Page {Math.min(page + 1, totalPages)} of {totalPages}</span>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
