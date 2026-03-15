import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod, RawFileStore, UploadRawSheet } from '@/lib/db';

interface SheetSnapshot {
  sheetName: string;
  headers: string[];
  data: unknown[][];
  rowCount: number;
}

function normalizeInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function flattenRawFilesToSheetMap(
  rawFiles: Array<{ sheets?: Array<{ sheetName?: string; headers?: string[]; data?: unknown[][]; rowCount?: number }> }>,
): Map<string, SheetSnapshot> {
  const sheetMap = new Map<string, SheetSnapshot>();

  for (const rawFile of rawFiles) {
    for (const sheet of rawFile.sheets ?? []) {
      const sheetName = String(sheet.sheetName ?? '').trim();
      if (!sheetName || sheetMap.has(sheetName)) continue;

      const data = (sheet.data ?? []) as unknown[][];
      const headers = (sheet.headers ?? []).map((h) => String(h ?? ''));

      sheetMap.set(sheetName, {
        sheetName,
        headers,
        data,
        rowCount: sheet.rowCount ?? data.length,
      });
    }
  }

  return sheetMap;
}

async function loadFallbackSheetsByUploadId(uploadId: string): Promise<Map<string, SheetSnapshot>> {
  const period = await MonthlyPeriod.findOne({ uploadId }).select('_id').lean();
  if (!period?._id) return new Map();

  const rawFiles = await RawFileStore.find({ monthlyPeriodId: period._id })
    .sort({ uploadedAt: -1 })
    .select('sheets')
    .lean();

  return flattenRawFilesToSheetMap(rawFiles);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const uploadId = searchParams.get('uploadId');
    const sheetName = searchParams.get('sheetName');
    const limit = normalizeInt(searchParams.get('limit'), 100, 1, 1000);
    const offset = normalizeInt(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    await connectDB();

    if (!sheetName) {
      const persistedSheets = await UploadRawSheet.find({ uploadId })
        .sort({ _id: 1 })
        .select('sheetName rowCount headers')
        .lean();

      if (persistedSheets.length > 0) {
        return NextResponse.json({
          uploadId,
          source: 'upload-raw-sheet',
          sheets: persistedSheets.map((sheet) => ({
            sheetName: sheet.sheetName,
            rowCount: sheet.rowCount ?? 0,
            columnCount: sheet.headers?.length ?? 0,
          })),
        });
      }

      const fallbackMap = await loadFallbackSheetsByUploadId(uploadId);
      return NextResponse.json({
        uploadId,
        source: 'raw-file-store',
        sheets: [...fallbackMap.values()].map((sheet) => ({
          sheetName: sheet.sheetName,
          rowCount: sheet.rowCount,
          columnCount: sheet.headers.length,
        })),
      });
    }

    const persisted = await UploadRawSheet.findOne({ uploadId, sheetName })
      .select('sheetName headers data rowCount')
      .lean();

    if (persisted) {
      const rows = (persisted.data ?? []) as unknown[][];
      return NextResponse.json({
        uploadId,
        source: 'upload-raw-sheet',
        sheetName: persisted.sheetName,
        headers: persisted.headers ?? [],
        totalRows: persisted.rowCount ?? rows.length,
        offset,
        limit,
        rows: rows.slice(offset, offset + limit),
      });
    }

    const fallbackMap = await loadFallbackSheetsByUploadId(uploadId);
    const fallbackSheet = fallbackMap.get(sheetName);

    if (!fallbackSheet) {
      return NextResponse.json({ error: `Sheet '${sheetName}' not found for upload ${uploadId}.` }, { status: 404 });
    }

    return NextResponse.json({
      uploadId,
      source: 'raw-file-store',
      sheetName: fallbackSheet.sheetName,
      headers: fallbackSheet.headers,
      totalRows: fallbackSheet.rowCount,
      offset,
      limit,
      rows: fallbackSheet.data.slice(offset, offset + limit),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load raw sheets.';
    console.error('[api/raw-sheets GET]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
