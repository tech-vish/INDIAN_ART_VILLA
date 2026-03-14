import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod, PLResult, RawFileStore } from '@/lib/db';

// GET /api/monthly-periods/:id
// Returns a single period with full details including all uploaded file metadata
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await connectDB();

    const period = await MonthlyPeriod.findById(id).lean();
    if (!period) {
      return NextResponse.json({ error: 'Period not found.' }, { status: 404 });
    }

    // Fetch the raw file list for this period so the client can see which files are stored
    const rawFiles = await RawFileStore.find({ monthlyPeriodId: id })
      .select('fileType fileName uploadedAt sheets')
      .lean();

    const uploadedFilesDetail = rawFiles.map(f => ({
      fileId:       f._id.toString(),
      fileType:     f.fileType,
      fileName:     f.fileName,
      uploadedAt:   f.uploadedAt,
      sheetCount:   f.sheets.length,
      sheetNames:   f.sheets.map((s: { sheetName: string }) => s.sheetName),
    }));

    // Attach summary counters
    const uploadSummary = {
      totalUploaded:    period.uploadedFiles.length,
      missingCount:     period.missingSheets.length,
      availableCount:   period.availableSheets.length,
      isReadyToProcess: period.missingSheets.length === 0 && period.uploadedFiles.length > 0,
    };

    // If completed, include a lightweight PLResult summary (no heavy data arrays)
    let plSummary: Record<string, unknown> | null = null;
    if (period.plResultId) {
      const pl = await PLResult.findById(period.plResultId)
        .select('month computedAt processingErrors')
        .lean();
      if (pl) {
        plSummary = {
          month:            pl.month,
          computedAt:       pl.computedAt,
          processingErrors: pl.processingErrors,
          errorCount:       pl.processingErrors?.length ?? 0,
        };
      }
    }

    return NextResponse.json({
      period: {
        ...period,
        uploadSummary,
        uploadedFilesDetail,
        plSummary,
      },
    });
  } catch (e: any) {
    console.error('[monthly-periods/:id GET]', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch period.' }, { status: 500 });
  }
}
