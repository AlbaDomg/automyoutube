export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  try {
    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      channel: {
        id: channel.id,
        title: channel.title,
        thumbnail: channel.thumbnail,
        updatedAt: channel.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching channel connection:', error);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await prisma.channel.deleteMany({});
    return NextResponse.json({ success: true, message: 'Disconnected channel successfully' });
  } catch (error) {
    console.error('Error disconnecting channel:', error);
    return NextResponse.json({ error: 'Failed to disconnect channel' }, { status: 500 });
  }
}
