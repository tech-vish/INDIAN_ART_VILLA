import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod, PLResult } from '@/lib/db';
import type { ComparativePL } from '@/lib/types';

// GET /api/comparative/:monthlyPeriodId?type=group|amazon-monthly|amazon-quarterly
// Returns comparative P&L data for a given processed period.
// The data is pre-computed by buildPL and stored in PLResult.comparativePL.
// If the stored comparative array is empty (e.g. no previous period existed when the
// month was first processed), we attempt a live rebuild from the previous PLResult.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ monthlyPeriodId: string }> },
) {
  try {
    const { monthlyPeriodId } = await params;
    const type = req.nextUrl.searchParams.get('type'); // 'group' | 'amazon-monthly' | 'amazon-quarterly'

    await connectDB();

    // Resolve period → PLResult
    const period = await MonthlyPeriod.findById(monthlyPeriodId).lean();
    if (!period) {
      return NextResponse.json({ error: 'Period not found.' }, { status: 404 });
    }
    if (!period.plResultId) {
      return NextResponse.json(
        { error: 'This period has not been processed yet. Run Process Month first.' },
        { status: 422 },
      );
    }

    const plDoc = await PLResult.findById(period.plResultId).lean();
    if (!plDoc) {
      return NextResponse.json({ error: 'PLResult not found.' }, { status: 404 });
    }

    let comparative: ComparativePL[] = (plDoc.comparativePL ?? []) as ComparativePL[];

    // If stored comparative is empty, try a live rebuild using the previous PLResult
    if (comparative.length === 0 && period.previousMonthId) {
      const prevPeriod = await MonthlyPeriod.findById(period.previousMonthId).lean();
      if (prevPeriod?.plResultId) {
        try {
          const { buildPL } = await import('@/lib/processors/plBuilder');
          const { RawFileStore } = await import('@/lib/db');
          const { assembleWorkbook } = await import('@/lib/processors/workbookAssembler');

          const rawFiles = await RawFileStore.find({ monthlyPeriodId }).sort({ uploadedAt: 1 });
          if (rawFiles.length > 0) {
            const wb = assembleWorkbook(rawFiles);
            const result = await buildPL(wb, `rebuild-${period.month}`, period.month, {
              monthlyPeriodId,
              previousMonthPLId: prevPeriod.plResultId.toString(),
              forceReprocess: false,
            });
            // Re-fetch the updated PLResult to get the rebuilt comparativePL
            const refreshed = await PLResult.findById(period.plResultId).lean();
            comparative = (refreshed?.comparativePL ?? []) as ComparativePL[];
          }
        } catch (rebuildErr) {
          console.error('[comparative] live rebuild failed:', rebuildErr);
          // Return what we have (empty array) rather than crashing
        }
      }
    }

    // Filter by type if requested
    const TYPE_MAP: Record<string, ComparativePL['type']> = {
      'group':             'group_monthly',
      'amazon-monthly':    'amazon_monthly',
      'amazon-quarterly':  'amazon_quarterly',
    };
    let filtered = comparative;
    if (type && TYPE_MAP[type]) {
      filtered = comparative.filter(c => c.type === TYPE_MAP[type]);
    }

    return NextResponse.json({
      monthlyPeriodId,
      month:       period.month,
      fiscalYear:  period.fiscalYear,
      comparative: filtered,
      allTypes:    comparative.map(c => c.type),
    });
  } catch (e: any) {
    console.error('[comparative GET]', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch comparative data.' }, { status: 500 });
  }
}
