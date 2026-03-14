import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod, RawFileStore } from '@/lib/db';
import { assembleWorkbook } from '@/lib/processors/workbookAssembler';
import { buildPL } from '@/lib/processors/plBuilder';
import { getMissingSheets } from '@/lib/fileTypeRegistry';

// POST /api/process-month
// Body: { monthlyPeriodId: string, month?: string }
// Validates all required files are present, assembles a virtual workbook from
// all RawFileStore documents, and runs the full buildPL() pipeline.
export async function POST(req: NextRequest) {
  try {
    const { monthlyPeriodId, month } = await req.json() as {
      monthlyPeriodId?: string;
      month?: string;
    };

    if (!monthlyPeriodId) {
      return NextResponse.json({ error: 'monthlyPeriodId is required.' }, { status: 400 });
    }

    await connectDB();

    const period = await MonthlyPeriod.findById(monthlyPeriodId);
    if (!period) {
      return NextResponse.json({ error: 'Monthly period not found.' }, { status: 404 });
    }

    const reportingMonth = (month ?? period.month).trim();

    // Fetch all raw files for this period, sorted oldest first so newer files
    // win during sheet-name deduplication inside assembleWorkbook()
    const rawFiles = await RawFileStore.find({ monthlyPeriodId }).sort({ uploadedAt: 1 });

    if (rawFiles.length === 0) {
      return NextResponse.json(
        { error: 'No raw files uploaded for this period. Upload files first.' },
        { status: 422 },
      );
    }

    // Validate: check which required sheets are still missing
    const allSheets = Array.from(
      new Set(rawFiles.flatMap(r => r.sheets.map((s: { sheetName: string }) => s.sheetName))),
    );
    const missingSheets = getMissingSheets(allSheets);
    if (missingSheets.length > 0) {
      return NextResponse.json(
        {
          error: `${missingSheets.length} required sheet(s) are still missing.`,
          missingSheets,
        },
        { status: 422 },
      );
    }

    // Assemble a virtual workbook from all uploaded files
    const wb = assembleWorkbook(rawFiles);

    // Run the full P&L pipeline (buildPL updates period status internally)
    const { uploadId, pl, errors, intermediates, ordersSheet, kpiSheet, amazonStatewisePL } = await buildPL(
      wb,
      `assembled-${reportingMonth}`,
      reportingMonth,
      { monthlyPeriodId },
    );

    return NextResponse.json({
      uploadId,
      pl,
      errors,
      intermediates,
      ordersSheet,
      kpiSheet,
      amazonStatewisePL,
      month: reportingMonth,
    });
  } catch (e: any) {
    console.error('[process-month POST]', e);
    return NextResponse.json({ error: e?.message ?? 'Processing failed.' }, { status: 500 });
  }
}

