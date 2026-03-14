import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Upload } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { uploadId } = body as { uploadId: string };

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    await connectDB();
    const upload = await Upload.findById(uploadId).lean();

    if (!upload) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      uploadId: upload._id,
      status:   upload.status,
      month:    upload.month,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal server error' }, { status: 500 });
  }
}
