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

    // Fetch lean docs and sort in memory to avoid index/hint mismatches across
    // environments and to keep chunk ordering deterministic.
    const rawFiles = await RawFileStore.find({ monthlyPeriodId })
      .select('fileType sheets')
      .lean();

    rawFiles.sort((a: any, b: any) =>
      String(a.fileType ?? '').localeCompare(String(b.fileType ?? '')),
    );

    if (rawFiles.length === 0) {
      return NextResponse.json(
        { error: 'No raw files uploaded for this period. Upload files first.' },
        { status: 422 },
      );
    }

    // Validate required sheets only for individual-file mode.
    // In combined-workbook mode, buildPL can still run and emit partial-data errors
    // instead of hard-failing the whole conversion.
    const hasCombinedSnapshot = rawFiles.some((r: any) => String(r.fileType ?? '').startsWith('COMBINED_WORKBOOK::'));
    if (!hasCombinedSnapshot) {
      const allSheets = Array.from(
        new Set(rawFiles.flatMap((r: any) => (r.sheets ?? []).map((s: { sheetName: string }) => s.sheetName))),
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

