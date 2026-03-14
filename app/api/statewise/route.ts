import { NextRequest, NextResponse } from 'next/server';
import { connectDB, StatewiseData } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get('uploadId');

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    await connectDB();
    const result = await StatewiseData.findOne({ uploadId }).lean();

    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ uploadId, rows: result.rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    const isDBError = /ECONNREFUSED|buffering timed out|MongoNetworkError|MongoServerSelectionError/.test(msg);
    console.error('[api/statewise]', e);
    return NextResponse.json(
      { error: isDBError ? 'Database unavailable. Please try again later.' : msg },
      { status: isDBError ? 503 : 500 },
    );
  }
}
