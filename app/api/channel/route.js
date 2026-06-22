import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyAppAuth, getCurrentUserEmail, getUserRole } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    
    // Buscar primero el canal vinculado a este correo
    let channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    // Fallback: buscar cualquier canal conectado en el sistema (canal central del Administrador)
    if (!channel) {
      channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
    }

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
    
    // Proteger para que solo Administradores puedan desconectar el canal central
    const role = await getUserRole(email);
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden: Se requiere rol de Administrador' }, { status: 403 });
    }

    await prisma.channel.deleteMany();
    
    return NextResponse.json({ success: true, message: 'Disconnected channel successfully' });
  } catch (error) {
    console.error('Error disconnecting channel:', error);
    return NextResponse.json({ error: 'Failed to disconnect channel' }, { status: 500 });
  }
}
