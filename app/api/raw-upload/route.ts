import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { connectDB, MonthlyPeriod, RawFileStore } from '@/lib/db';
import { extractSheetData } from '@/lib/processors/workbookAssembler';
import { resolveSheetName } from '@/lib/fileTypeRegistry';
import type { FileType } from '@/lib/fileTypeRegistry';

// POST /api/raw-upload
// Body: FormData { file, fileType, monthlyPeriodId }
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file             = formData.get('file') as File | null;
    const fileType         = formData.get('fileType') as FileType | null;
    const monthlyPeriodId  = formData.get('monthlyPeriodId') as string | null;
    const resetCombined    = formData.get('resetCombined') === '1';

    if (!file)            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    if (!fileType)        return NextResponse.json({ error: 'fileType is required.' }, { status: 400 });
    if (!monthlyPeriodId) return NextResponse.json({ error: 'monthlyPeriodId is required.' }, { status: 400 });

    await connectDB();

    const periodObjectId = new mongoose.Types.ObjectId(monthlyPeriodId);
    const periodExists = await MonthlyPeriod.exists({ _id: periodObjectId });
    if (!periodExists) return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });

    // Parse the uploaded xlsx
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

    // Extract and normalise sheet data
    const sheetData = extractSheetData(wb, fileType);
    const sheetsDetected = sheetData.map(s => s.sheetName);

    if (sheetData.length === 0) {
      return NextResponse.json({ error: 'No valid sheet data found in uploaded file.' }, { status: 422 });
    }

    let fileId: mongoose.Types.ObjectId;
    let sheetsFoundForEntry: string[] = sheetsDetected;

    if (fileType === 'COMBINED_WORKBOOK') {
      // Combined mode stores one document per sheet to avoid a single huge BSON document.
      if (resetCombined) {
        await RawFileStore.deleteMany({
          monthlyPeriodId: periodObjectId,
          fileType: /^COMBINED_WORKBOOK(?:::.*)?$/,
        });
      } else {
        await RawFileStore.deleteMany({
          monthlyPeriodId: periodObjectId,
          fileType: 'COMBINED_WORKBOOK',
        });
      }

      const upsertedIds: mongoose.Types.ObjectId[] = [];

      for (const sheet of sheetData) {
        const scopedFileType = `COMBINED_WORKBOOK::${sheet.sheetName}`;
        const upserted = await RawFileStore.findOneAndUpdate(
          { monthlyPeriodId: periodObjectId, fileType: scopedFileType },
          {
            $set: {
              fileName: file.name,
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

      const combinedDocs = await RawFileStore.find({
        monthlyPeriodId: periodObjectId,
        fileType: /^COMBINED_WORKBOOK::/,
      })
        .select('sheets.sheetName')
        .lean();

      sheetsFoundForEntry = Array.from(
        new Set(combinedDocs.flatMap(r => (r.sheets ?? []).map(s => s.sheetName))),
      );
    } else {
      // Upsert: if this file type was already uploaded, replace it
      const existingFile = await RawFileStore.findOne({
        monthlyPeriodId: periodObjectId,
        fileType,
      });

      if (existingFile) {
        existingFile.fileName  = file.name;
        existingFile.sheets    = sheetData;
        existingFile.uploadedAt = new Date();
        await existingFile.save();
        fileId = existingFile._id;
      } else {
        const newRaw = await RawFileStore.create({
          monthlyPeriodId: periodObjectId,
          fileType,
          fileName: file.name,
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
    const { getMissingSheets } = await import('@/lib/fileTypeRegistry');
    const missingSheets = getMissingSheets(allSheets);

    // Atomic update avoids optimistic-concurrency VersionError during parallel uploads.
    const uploadedEntry = {
      fileType,
      fileName: file.name,
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

    // Resolve sheet names from this file for the response — include raw names too
    const rawSheetNames = wb.SheetNames.map(n => {
      const canonical = resolveSheetName(n, fileType);
      return canonical ?? n;
    }).filter(Boolean);

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
