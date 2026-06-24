import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyAppAuth, getCurrentUserEmail, getUserRole } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    
    // Buscar el canal vinculado a este correo
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
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

export async function DELETE(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    
    await prisma.channel.deleteMany({
      where: { userEmail: email }
    });
    
    return NextResponse.json({ success: true, message: 'Disconnected channel successfully' });
  } catch (error) {
    console.error('Error disconnecting channel:', error);
    return NextResponse.json({ error: 'Failed to disconnect channel' }, { status: 500 });
  }
}
