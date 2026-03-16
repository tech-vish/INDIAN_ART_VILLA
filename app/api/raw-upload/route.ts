import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { connectDB, MonthlyPeriod, RawFileStore } from '@/lib/db';
import { extractSheetData } from '@/lib/processors/workbookAssembler';
import { getMissingSheets, resolveSheetName } from '@/lib/fileTypeRegistry';
import type { FileType } from '@/lib/fileTypeRegistry';

// POST /api/raw-upload
// Body: FormData { file, fileType, monthlyPeriodId }
// or    FormData { fileType=COMBINED_WORKBOOK, monthlyPeriodId, sheetName, headers, rows, chunkIndex, chunkTotal }
// or    FormData { fileType=COMBINED_WORKBOOK, monthlyPeriodId, finalizeCombined=1 }
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    let file: File | null = null;
    let fileType: FileType | null = null;
    let monthlyPeriodId: string | null = null;
    let resetCombined = false;
    let finalizeCombined = false;
    let providedFileName: string | null = null;
    let sheetNameRaw: string | null = null;
    let headersInput: unknown = null;
    let rowsInput: unknown = null;
    let chunkIndexRaw: string | null = null;
    let chunkTotalRaw: string | null = null;

    if (contentType.includes('application/json')) {
      const body = await req.json() as Record<string, unknown>;
      fileType = (typeof body.fileType === 'string' ? body.fileType : null) as FileType | null;
      monthlyPeriodId = typeof body.monthlyPeriodId === 'string' ? body.monthlyPeriodId : null;
      resetCombined = body.resetCombined === true || body.resetCombined === '1';
      finalizeCombined = body.finalizeCombined === true || body.finalizeCombined === '1';
      providedFileName = typeof body.fileName === 'string' ? body.fileName.trim() || null : null;
      sheetNameRaw = typeof body.sheetName === 'string' ? body.sheetName.trim() || null : null;
      headersInput = body.headers ?? null;
      rowsInput = body.rows ?? null;
      chunkIndexRaw = body.chunkIndex == null ? null : String(body.chunkIndex);
      chunkTotalRaw = body.chunkTotal == null ? null : String(body.chunkTotal);
    } else {
      const formData = await req.formData();
      file             = formData.get('file') as File | null;
      fileType         = formData.get('fileType') as FileType | null;
      monthlyPeriodId  = formData.get('monthlyPeriodId') as string | null;
      resetCombined    = formData.get('resetCombined') === '1';
      finalizeCombined = formData.get('finalizeCombined') === '1';
      providedFileName = (formData.get('fileName') as string | null)?.trim() || null;
      sheetNameRaw     = (formData.get('sheetName') as string | null)?.trim() || null;
      headersInput     = formData.get('headers');
      rowsInput        = formData.get('rows');
      chunkIndexRaw    = formData.get('chunkIndex') as string | null;
      chunkTotalRaw    = formData.get('chunkTotal') as string | null;
    }

    const chunkIndex = Number.parseInt(chunkIndexRaw ?? '', 10);
    const chunkTotal = Number.parseInt(chunkTotalRaw ?? '', 10);
    const hasChunkMeta = Number.isFinite(chunkIndex)
      && Number.isFinite(chunkTotal)
      && chunkIndex > 0
      && chunkTotal > 0;

    const isCombinedJsonChunk = fileType === 'COMBINED_WORKBOOK'
      && !!sheetNameRaw
      && headersInput != null
      && rowsInput != null;

    if (!fileType)        return NextResponse.json({ error: 'fileType is required.' }, { status: 400 });
    if (!monthlyPeriodId) return NextResponse.json({ error: 'monthlyPeriodId is required.' }, { status: 400 });
    if (!file && !isCombinedJsonChunk && !finalizeCombined) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    await connectDB();

    const periodObjectId = new mongoose.Types.ObjectId(monthlyPeriodId);
    const periodExists = await MonthlyPeriod.exists({ _id: periodObjectId });
    if (!periodExists) return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });

    if (finalizeCombined) {
      if (fileType !== 'COMBINED_WORKBOOK') {
        return NextResponse.json({ error: 'finalizeCombined is only valid for COMBINED_WORKBOOK.' }, { status: 400 });
      }

      const combinedDocs = await RawFileStore.find({
        monthlyPeriodId: periodObjectId,
        fileType: /^COMBINED_WORKBOOK::/,
      })
        .select('_id fileName sheets.sheetName')
        .lean();

      if (combinedDocs.length === 0) {
        return NextResponse.json({ error: 'No combined workbook chunks found to finalize.' }, { status: 422 });
      }

      const allSheets = Array.from(
        new Set(combinedDocs.flatMap(r => (r.sheets ?? []).map(s => s.sheetName))),
      );
      const missingSheets = getMissingSheets(allSheets);

      const fileId = combinedDocs[0]._id;
      const uploadedEntry = {
        fileType: 'COMBINED_WORKBOOK',
        fileName: providedFileName || combinedDocs[0].fileName || 'combined-workbook',
        uploadedAt: new Date(),
        sheetsFound: allSheets,
        fileId,
      };

      const updatedPeriod = await MonthlyPeriod.findOneAndUpdate(
        { _id: periodObjectId },
        [
          {
            $set: {
              uploadedFiles: {
                $concatArrays: [
                  {
                    $filter: {
                      input: { $ifNull: ['$uploadedFiles', []] },
                      as: 'f',
                      cond: { $ne: ['$$f.fileType', 'COMBINED_WORKBOOK'] },
                    },
                  },
                  [uploadedEntry],
                ],
              },
              availableSheets: allSheets,
              missingSheets,
            },
          },
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
        .select('status')
        .lean();

      if (!updatedPeriod) {
        return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });
      }

      return NextResponse.json({
        fileId: fileId.toString(),
        sheetsDetected: allSheets,
        rawSheetNames: allSheets,
        availableSheets: allSheets,
        missingSheets,
        periodStatus: updatedPeriod.status,
        finalized: true,
      });
    }

    const uploadFileName = providedFileName || file?.name || 'combined-workbook';

    let sheetData: Array<{ sheetName: string; headers: string[]; data: unknown[][]; rowCount: number }> = [];
    let sheetsDetected: string[] = [];
    let rawSheetNames: string[] = [];

    if (isCombinedJsonChunk) {
      let parsedHeaders: unknown = headersInput;
      let parsedRows: unknown = rowsInput;

      try {
        if (typeof parsedHeaders === 'string') {
          parsedHeaders = JSON.parse(parsedHeaders);
        }
        if (typeof parsedRows === 'string') {
          parsedRows = JSON.parse(parsedRows);
        }
      } catch {
        return NextResponse.json({ error: 'Invalid JSON chunk payload.' }, { status: 400 });
      }

      if (!Array.isArray(parsedHeaders) || !Array.isArray(parsedRows)) {
        return NextResponse.json({ error: 'headers and rows must be arrays.' }, { status: 400 });
      }

      const headers = parsedHeaders.map(h => String(h ?? ''));
      const rows = parsedRows.map((row) => (Array.isArray(row) ? row : [row])) as unknown[][];
      const safeSheetName = sheetNameRaw!;

      sheetData = [{
        sheetName: safeSheetName,
        headers,
        data: rows,
        rowCount: rows.length,
      }];
      sheetsDetected = [safeSheetName];
      rawSheetNames = [safeSheetName];
    } else {
      // Parse the uploaded xlsx
      const buffer = await file!.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

      // Extract and normalise sheet data
      sheetData = extractSheetData(wb, fileType);
      sheetsDetected = sheetData.map(s => s.sheetName);

      // Resolve sheet names from this file for the response — include raw names too
      rawSheetNames = wb.SheetNames.map(n => {
        const canonical = resolveSheetName(n, fileType);
        return canonical ?? n;
      }).filter(Boolean);
    }

    if (sheetData.length === 0) {
      return NextResponse.json({ error: 'No valid sheet data found in uploaded file.' }, { status: 422 });
    }

    const shouldRefreshPeriod = fileType !== 'COMBINED_WORKBOOK' || !hasChunkMeta;

    let fileId: mongoose.Types.ObjectId;
    let sheetsFoundForEntry: string[] = sheetsDetected;

    if (fileType === 'COMBINED_WORKBOOK') {
      // Combined mode stores one document per sheet to avoid a single huge BSON document.
      if (resetCombined) {
        await RawFileStore.deleteMany({
          monthlyPeriodId: periodObjectId,
          fileType: /^COMBINED_WORKBOOK(?:::.*)?$/,
        });
      } else if (!hasChunkMeta) {
        await RawFileStore.deleteMany({
          monthlyPeriodId: periodObjectId,
          fileType: 'COMBINED_WORKBOOK',
        });
      }

      const upsertedIds: mongoose.Types.ObjectId[] = [];

      for (const sheet of sheetData) {
        const chunkSuffix = hasChunkMeta
          ? `::chunk::${String(chunkIndex).padStart(6, '0')}`
          : '';
        const scopedFileType = `COMBINED_WORKBOOK::${sheet.sheetName}${chunkSuffix}`;
        const upserted = await RawFileStore.findOneAndUpdate(
          { monthlyPeriodId: periodObjectId, fileType: scopedFileType },
          {
            $set: {
              fileName: uploadFileName,
              sheets: [sheet],
              uploadedAt: new Date(),
            },
            $setOnInsert: {
              monthlyPeriodId: periodObjectId,
              fileType: scopedFileType,
            },
          },
          { upsert: true, returnDocument: 'after' },
        )
          .select('_id')
          .lean();

        if (upserted?._id) upsertedIds.push(upserted._id);
      }

      if (!upsertedIds[0]) {
        return NextResponse.json({ error: 'Failed to store combined workbook sheets.' }, { status: 500 });
      }
      fileId = upsertedIds[0];

      if (shouldRefreshPeriod) {
        const combinedDocs = await RawFileStore.find({
          monthlyPeriodId: periodObjectId,
          fileType: /^COMBINED_WORKBOOK::/,
        })
          .select('sheets.sheetName')
          .lean();

        sheetsFoundForEntry = Array.from(
          new Set(combinedDocs.flatMap(r => (r.sheets ?? []).map(s => s.sheetName))),
        );
      }
    } else {
      // Upsert: if this file type was already uploaded, replace it
      const existingFile = await RawFileStore.findOne({
        monthlyPeriodId: periodObjectId,
        fileType,
      });

      if (existingFile) {
        existingFile.fileName  = uploadFileName;
        existingFile.sheets    = sheetData;
        existingFile.uploadedAt = new Date();
        await existingFile.save();
        fileId = existingFile._id;
      } else {
        const newRaw = await RawFileStore.create({
          monthlyPeriodId: periodObjectId,
          fileType,
          fileName: uploadFileName,
          sheets: sheetData,
        });
        fileId = newRaw._id;
      }

      const sheetsForPeriodFileType = await RawFileStore.findOne({
        monthlyPeriodId: periodObjectId,
        fileType,
      })
        .select('sheets.sheetName')
        .lean();
      sheetsFoundForEntry = sheetsForPeriodFileType?.sheets?.map(s => s.sheetName) ?? sheetsDetected;
    }

    if (!shouldRefreshPeriod) {
      return NextResponse.json({
        fileId: fileId.toString(),
        sheetsDetected,
        rawSheetNames,
        partial: true,
        chunkIndex,
        chunkTotal,
      });
    }

    // Rebuild availableSheets from all uploaded files
    const allRaw = await RawFileStore.find({
      monthlyPeriodId: periodObjectId,
    })
      .select('sheets.sheetName')
      .lean();
    const allSheets = Array.from(
      new Set(allRaw.flatMap(r => (r.sheets ?? []).map(s => s.sheetName)))
    );

    // Recompute missingSheets based on canonical required sheet names
    const missingSheets = getMissingSheets(allSheets);

    // Atomic update avoids optimistic-concurrency VersionError during parallel uploads.
    const uploadedEntry = {
      fileType,
      fileName: uploadFileName,
      uploadedAt: new Date(),
      sheetsFound: sheetsFoundForEntry,
      fileId,
    };

    const updatedPeriod = await MonthlyPeriod.findOneAndUpdate(
      { _id: periodObjectId },
      [
        {
          $set: {
            uploadedFiles: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ['$uploadedFiles', []] },
                    as: 'f',
                    cond: { $ne: ['$$f.fileType', fileType] },
                  },
                },
                [uploadedEntry],
              ],
            },
            availableSheets: allSheets,
            missingSheets,
          },
        },
      ],
      { returnDocument: 'after', updatePipeline: true },
    )
      .select('status')
      .lean();

    if (!updatedPeriod) {
      return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });
    }

    return NextResponse.json({
      fileId: fileId.toString(),
      sheetsDetected,
      rawSheetNames,
      availableSheets: allSheets,
      missingSheets,
      periodStatus: updatedPeriod.status,
    });
  } catch (e: any) {
    console.error('[raw-upload POST]', e);
    return NextResponse.json({ error: e?.message ?? 'Upload failed.' }, { status: 500 });
  }
}

// DELETE /api/raw-upload?fileId=xxx&monthlyPeriodId=yyy
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const fileId          = searchParams.get('fileId');
    const monthlyPeriodId = searchParams.get('monthlyPeriodId');

    if (!fileId || !monthlyPeriodId) {
      return NextResponse.json({ error: 'fileId and monthlyPeriodId are required.' }, { status: 400 });
    }

    await connectDB();

    const raw = await RawFileStore.findById(fileId);
    if (!raw) return NextResponse.json({ error: 'File not found.' }, { status: 404 });

    const removedFileType = raw.fileType;
    await raw.deleteOne();

    // Remove from MonthlyPeriod.uploadedFiles
    await MonthlyPeriod.findByIdAndUpdate(monthlyPeriodId, {
      $pull: { uploadedFiles: { fileId: new mongoose.Types.ObjectId(fileId) } },
    });

    // Rebuild availableSheets
    const remaining = await RawFileStore.find({
      monthlyPeriodId: new mongoose.Types.ObjectId(monthlyPeriodId),
    })
      .select('sheets.sheetName')
      .lean();
    const allSheets = Array.from(
      new Set(remaining.flatMap(r => (r.sheets ?? []).map(s => s.sheetName)))
    );
    const { getMissingSheets } = await import('@/lib/fileTypeRegistry');
    const missingSheets = getMissingSheets(allSheets);

    await MonthlyPeriod.findByIdAndUpdate(monthlyPeriodId, {
      availableSheets: allSheets,
      missingSheets,
    });

    return NextResponse.json({ removed: removedFileType, availableSheets: allSheets, missingSheets });
  } catch (e: any) {
    console.error('[raw-upload DELETE]', e);
    return NextResponse.json({ error: e?.message ?? 'Delete failed.' }, { status: 500 });
  }
}
