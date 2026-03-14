import { NextRequest, NextResponse } from 'next/server';
import { connectDB, MonthlyPeriod } from '@/lib/db';
import { getFiscalQuarter, getFiscalYear } from '@/lib/constants';

// GET /api/monthly-periods — list all periods sorted newest first with upload summary
export async function GET() {
  try {
    await connectDB();
    const periods = await MonthlyPeriod.find({})
      .sort({ year: -1, monthIndex: -1 })
      .lean();

    // Attach an upload summary to each period (file counts, readiness)
    const enriched = periods.map(p => ({
      ...p,
      uploadSummary: {
        totalUploaded:    p.uploadedFiles.length,
        missingCount:     p.missingSheets.length,
        availableCount:   p.availableSheets.length,
        isReadyToProcess: p.missingSheets.length === 0 && p.uploadedFiles.length > 0,
      },
    }));

    return NextResponse.json({ periods: enriched });
  } catch (e: any) {
    console.error('[monthly-periods GET]', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch periods.' }, { status: 500 });
  }
}

// POST /api/monthly-periods — create a new monthly period
// Body: { month: "Jan 2026" }
export async function POST(req: NextRequest) {
  try {
    const { month } = await req.json() as { month?: string };
    if (!month?.trim()) {
      return NextResponse.json({ error: 'month is required (e.g. "Jan 2026").' }, { status: 400 });
    }

    await connectDB();

    // Check for duplicate
    const existing = await MonthlyPeriod.findOne({ month: month.trim() });
    if (existing) {
      return NextResponse.json({ period: existing }, { status: 200 });
    }

    // Parse "Jan 2026" → month index + year
    const parsed = new Date(`1 ${month.trim()}`);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid month format. Use "MMM YYYY" e.g. "Jan 2026".' }, { status: 400 });
    }
    const monthIndex = parsed.getMonth();  // 0=Jan
    const year       = parsed.getFullYear();
    const fiscalYear    = getFiscalYear(monthIndex, year);
    const fiscalQuarter = getFiscalQuarter(monthIndex);

    // Find the previous month's period for carry-forward data
    // Previous calendar month
    const prevDate = new Date(year, monthIndex - 1, 1);
    const prevMonthStr = prevDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const prevPeriod = await MonthlyPeriod.findOne({ month: prevMonthStr }).lean();

    // Carry forward the closing stock from the previous COMPLETE period as opening stock.
    // If the previous period is not complete (no plResultId), walk back until we find one or
    // fall back to zeros so the user can enter it manually.
    let openingStock = { tradedGoods: 0, packingMaterial: 0 };
    if (prevPeriod?.status === 'complete' && prevPeriod.plResultId) {
      // Load the PLResult to get the actual computed closing stock
      const { PLResult } = await import('@/lib/db');
      const prevPL = await PLResult.findById(prevPeriod.plResultId).lean();
      if (prevPL?.data?.closingStock) {
        const cs = prevPL.data.closingStock as { total?: number; byChannel?: Record<string, number> };
        // closingStock.total is the full traded-goods closing stock value
        openingStock = {
          tradedGoods:     cs.total ?? 0,
          packingMaterial: prevPL.data.packingMaterial?.total ?? 0,
        };
      } else {
        // fallback: reuse previous period's openingStock
        openingStock = {
          tradedGoods:     prevPeriod.openingStock?.tradedGoods ?? 0,
          packingMaterial: prevPeriod.openingStock?.packingMaterial ?? 0,
        };
      }
    }

    const newPeriod = await MonthlyPeriod.create({
      month: month.trim(),
      year,
      monthIndex,
      fiscalYear,
      fiscalQuarter,
      status: 'draft',
      previousMonthId: prevPeriod?._id ?? null,
      openingStock,
    });

    return NextResponse.json({ period: newPeriod }, { status: 201 });
  } catch (e: any) {
    console.error('[monthly-periods POST]', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to create period.' }, { status: 500 });
  }
}
