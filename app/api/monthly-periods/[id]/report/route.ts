import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod, PLResult } from '@/lib/db';
import { exportWorkbook } from '@/lib/export/workbookExporter';
import type {
  PLOutput, IntermediateSheets,
  AmazonStatewisePL,
  AmazonMonthlyPLRow, QuarterlyRollup,
  ComparativePL,
  OrdersSheet, KPISheet,
} from '@/lib/types';


// ── Route handler ─────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await connectDB();

    // The `id` may be a MonthlyPeriod._id OR an Upload._id (from direct uploads).
    // Try each lookup in order of specificity.
    let plDoc: Awaited<ReturnType<typeof PLResult.findById>> | null = null;
    let month: string | undefined;

    // 1. MonthlyPeriod by its own _id
    const period = await MonthlyPeriod.findById(id).lean().catch(() => null);
    if (period) {
      if (!period.plResultId) {
        return NextResponse.json(
          { error: 'This period has not been processed yet.' },
          { status: 422 },
        );
      }
      plDoc = await PLResult.findById(period.plResultId).lean();
      month = period.month;
    }

    // 2. MonthlyPeriod by uploadId field
    if (!plDoc) {
      const periodByUpload = await MonthlyPeriod.findOne({ uploadId: id }).lean().catch(() => null);
      if (periodByUpload?.plResultId) {
        plDoc = await PLResult.findById(periodByUpload.plResultId).lean();
        month = periodByUpload.month;
      }
    }

    // 3. PLResult directly by uploadId (direct uploads without a MonthlyPeriod)
    if (!plDoc) {
      plDoc = await PLResult.findOne({ uploadId: id }).lean().catch(() => null);
      if (plDoc) month = (plDoc as any).month;
    }

    if (!plDoc) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    }

    // typed as any — Mongoose lean() loses document shape; all fields cast below
    const doc = plDoc as any;

    const pl            = doc.data             as PLOutput;
    const intermediates = doc.intermediates     as IntermediateSheets;
    const comparative   = (doc.comparativePL  ?? []) as ComparativePL[];
    const ordersSheet   = doc.ordersSheet       as OrdersSheet;
    const kpiSheet      = doc.kpiSheet          as KPISheet;
    const statewisePL   = doc.amazonStatewisePL as AmazonStatewisePL;
    const quarterly     = doc.quarterlyRollup   as QuarterlyRollup;
    const amazonRow     = doc.amazonMonthlyRow  as AmazonMonthlyPLRow;
    const resolvedMonth = (month ?? doc.month ?? 'Report') as string;

    // Rolling 12-month Amazon history for the Monthwise sheet (oldest → newest)
    const historyDocs = await PLResult
      .find({})
      .sort({ createdAt: 1 })
      .limit(24)
      .select('amazonMonthlyRow')
      .lean();

    const amazonHistory: AmazonMonthlyPLRow[] = historyDocs
      .map(d => (d as any).amazonMonthlyRow as AmazonMonthlyPLRow)
      .filter(Boolean)
      .slice(-12);

    // Ensure current month is present
    if (amazonRow?.month && !amazonHistory.find(r => r.month === String(amazonRow.month))) {
      amazonHistory.push(amazonRow);
    }

    const buf = exportWorkbook({
      pl,
      month: resolvedMonth,
      intermediates,
      comparative,
      ordersSheet,
      kpiSheet,
      amazonStatewise: statewisePL,
      quarterly,
      amazonHistory,
    });

    const safeMonth = resolvedMonth.replace(/[^a-zA-Z0-9 ]/g, '-');
    const fileName  = encodeURIComponent(`IAV Report ${safeMonth}.xlsx`);

    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length':      String(buf.length),
        'Cache-Control':       'no-store',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to generate report.';
    console.error('[monthly-periods/:id/report GET]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
