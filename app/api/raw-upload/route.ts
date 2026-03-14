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

    if (!file)            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    if (!fileType)        return NextResponse.json({ error: 'fileType is required.' }, { status: 400 });
    if (!monthlyPeriodId) return NextResponse.json({ error: 'monthlyPeriodId is required.' }, { status: 400 });

    await connectDB();

    const period = await MonthlyPeriod.findById(monthlyPeriodId);
    if (!period) return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });

    // Parse the uploaded xlsx
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

    // Extract and normalise sheet data
    const sheetData = extractSheetData(wb, fileType);
    const sheetsDetected = sheetData.map(s => s.sheetName);

    // Upsert: if this file type was already uploaded, replace it
    const existingFile = await RawFileStore.findOne({
      monthlyPeriodId: new mongoose.Types.ObjectId(monthlyPeriodId),
      fileType,
    });

    let fileId: mongoose.Types.ObjectId;
    if (existingFile) {
      existingFile.fileName  = file.name;
      existingFile.sheets    = sheetData;
      existingFile.uploadedAt = new Date();
      await existingFile.save();
      fileId = existingFile._id;
    } else {
      const newRaw = await RawFileStore.create({
        monthlyPeriodId: new mongoose.Types.ObjectId(monthlyPeriodId),
        fileType,
        fileName: file.name,
        sheets: sheetData,
      });
      fileId = newRaw._id;
    }

    // Update MonthlyPeriod.uploadedFiles entry for this fileType
    const existingEntry = period.uploadedFiles.find((f) => f.fileType === fileType);
    if (existingEntry) {
      existingEntry.fileName   = file.name;
      existingEntry.uploadedAt = new Date();
      existingEntry.sheetsFound = sheetsDetected;
      existingEntry.fileId     = fileId;
    } else {
      period.uploadedFiles.push({
        fileType,
        fileName:   file.name,
        uploadedAt: new Date(),
        sheetsFound: sheetsDetected,
        fileId,
      });
    }

    // Rebuild availableSheets from all uploaded files
    const allRaw = await RawFileStore.find({
      monthlyPeriodId: new mongoose.Types.ObjectId(monthlyPeriodId),
    });
    const allSheets = Array.from(
      new Set(allRaw.flatMap(r => r.sheets.map(s => s.sheetName)))
    );
    period.availableSheets = allSheets;

    // Recompute missingSheets based on canonical required sheet names
    const { getMissingSheets } = await import('@/lib/fileTypeRegistry');
    period.missingSheets = getMissingSheets(allSheets);

    // Resolve sheet names from this file for the response — include raw names too
    const rawSheetNames = wb.SheetNames.map(n => {
      const canonical = resolveSheetName(n, fileType);
      return canonical ?? n;
    }).filter(Boolean);

    await period.save();

    return NextResponse.json({
      fileId: fileId.toString(),
      sheetsDetected,
      rawSheetNames,
      availableSheets: allSheets,
      missingSheets: period.missingSheets,
      periodStatus: period.status,
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
    });
    const allSheets = Array.from(
      new Set(remaining.flatMap(r => r.sheets.map(s => s.sheetName)))
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
