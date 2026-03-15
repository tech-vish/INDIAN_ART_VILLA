'use client';

import { useEffect, useMemo, useState } from 'react';

type CellValue = string | number | boolean | Date | null | undefined;

interface RawWorkbookEditorProps {
  sheetNames: string[];
  sheetData: Record<string, CellValue[][]>;
  hasEdits: boolean;
  fullPage?: boolean;
  onCellChange: (sheetName: string, rowIndex: number, colIndex: number, value: string) => void;
  onAddRow: (sheetName: string) => void;
  onAddColumn: (sheetName: string) => void;
  onResetSheet: (sheetName: string) => void;
  onResetAll: () => void;
}

const PAGE_SIZES = [25, 50, 100] as const;

function toDisplay(value: CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function getMaxCols(rows: CellValue[][]): number {
  let max = 0;
  for (const row of rows) {
    if (row.length > max) max = row.length;
  }
  return Math.max(1, max);
}

export default function RawWorkbookEditor({
  sheetNames,
  sheetData,
  hasEdits,
  fullPage = false,
  onCellChange,
  onAddRow,
  onAddColumn,
  onResetSheet,
  onResetAll,
}: RawWorkbookEditorProps) {
  const [activeSheet, setActiveSheet] = useState<string>(sheetNames[0] ?? '');
  const [pageBySheet, setPageBySheet] = useState<Record<string, number>>({});
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  useEffect(() => {
    if (!sheetNames.includes(activeSheet)) {
      setActiveSheet(sheetNames[0] ?? '');
    }
  }, [activeSheet, sheetNames]);

  const rows = sheetData[activeSheet] ?? [];
  const maxCols = useMemo(() => getMaxCols(rows), [rows]);

  const page = pageBySheet[activeSheet] ?? 0;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

  useEffect(() => {
    if (page !== safePage) {
      setPageBySheet(prev => ({ ...prev, [activeSheet]: safePage }));
    }
  }, [activeSheet, page, safePage]);

  const start = safePage * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);

  const setPage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(nextPage, totalPages - 1));
    setPageBySheet(prev => ({ ...prev, [activeSheet]: bounded }));
  };

  if (!sheetNames.length) {
    return null;
  }

  const sectionClass = fullPage
    ? 'border border-gray-200 rounded-xl p-5 h-[calc(100vh-11rem)] min-h-[620px] flex flex-col gap-4'
    : 'border border-gray-200 rounded-xl p-5 space-y-4';

  const tableContainerClass = fullPage
    ? 'overflow-auto border border-gray-200 rounded-lg flex-1 min-h-0'
    : 'overflow-auto border border-gray-200 rounded-lg max-h-[520px]';

  return (
    <section className={sectionClass}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Raw Workbook Editor</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            View and edit uploaded sheet data before processing final outputs.
          </p>
        </div>
        {hasEdits && (
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1">
            Unsaved raw edits in this session
          </span>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {sheetNames.map(sheetName => (
          <button
            key={sheetName}
            onClick={() => setActiveSheet(sheetName)}
            className={[
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              sheetName === activeSheet
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
            ].join(' ')}
          >
            {sheetName}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onAddRow(activeSheet)}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Add row
        </button>
        <button
          onClick={() => onAddColumn(activeSheet)}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Add column
        </button>
        <button
          onClick={() => onResetSheet(activeSheet)}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Reset this sheet
        </button>
        <button
          onClick={onResetAll}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Reset all sheets
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-600">
          <label htmlFor="page-size">Rows per page</label>
          <select
            id="page-size"
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 bg-white"
          >
            {PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={tableContainerClass}>
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 text-left font-semibold text-gray-500 border-b border-gray-200">Row</th>
              {Array.from({ length: maxCols }).map((_, colIndex) => (
                <th key={colIndex} className="px-2 py-2 text-left font-semibold text-gray-500 border-b border-gray-200">
                  Col {colIndex + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, visibleRowIndex) => {
              const rowIndex = start + visibleRowIndex;
              return (
                <tr key={rowIndex} className="odd:bg-white even:bg-gray-50/40">
                  <td className="px-2 py-1.5 text-gray-500 border-b border-gray-100 whitespace-nowrap">{rowIndex + 1}</td>
                  {Array.from({ length: maxCols }).map((_, colIndex) => (
                    <td key={colIndex} className="border-b border-gray-100 px-1 py-1">
                      <input
                        value={toDisplay(row[colIndex])}
                        onChange={e => onCellChange(activeSheet, rowIndex, colIndex, e.target.value)}
                        className="w-full min-w-[120px] rounded border border-gray-200 px-2 py-1 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={maxCols + 1} className="px-3 py-6 text-center text-gray-500">
                  This sheet is currently empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>
          Showing {rows.length === 0 ? 0 : start + 1} to {Math.min(start + pageSize, rows.length)} of {rows.length} rows
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(safePage - 1)}
            disabled={safePage === 0}
            className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
          >
            Prev
          </button>
          <span>Page {safePage + 1} of {totalPages}</span>
          <button
            onClick={() => setPage(safePage + 1)}
            disabled={safePage >= totalPages - 1}
            className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
