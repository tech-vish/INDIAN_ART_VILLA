import { NextResponse } from 'next/server';
import { connectDB, Upload } from '@/lib/db';

export async function GET() {
  try {
    await connectDB();
    const uploads = await Upload.find({})
      .sort({ uploadedAt: -1 })
      .limit(20)
      .select('fileName uploadedAt month status')
      .lean();

    return NextResponse.json({ uploads });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    const isDBError = /ECONNREFUSED|buffering timed out|MongoNetworkError|MongoServerSelectionError/.test(msg);
    console.error('[api/uploads]', e);
    return NextResponse.json(
      { error: isDBError ? 'Database unavailable. Please try again later.' : msg },
      { status: isDBError ? 503 : 500 },
    );
  }
}
