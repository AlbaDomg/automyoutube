import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyAppAuth } from '@/lib/auth';

export async function DELETE(request, { params }) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    if (!id) {
      return NextResponse.json({ error: 'Missing video id' }, { status: 400 });
    }

    await prisma.video.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Delete Video] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete video' }, { status: 500 });
  }
}
