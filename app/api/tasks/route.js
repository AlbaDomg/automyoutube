import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';

export async function GET(request) {
  try {
    const tasks = await prisma.videoTask.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(tasks);
  } catch (error) {
    console.error('[Tasks GET API Error]:', error);
    return NextResponse.json({ error: 'Error al obtener las tareas' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { youtubeId, title, description, dueDate } = await request.json();

    if (!youtubeId || !title || !description) {
      return NextResponse.json({ error: 'Faltan campos requeridos (ID de YouTube, título y descripción)' }, { status: 400 });
    }

    let uploadDate = new Date();

    // Intentar obtener la fecha de subida original de YouTube
    try {
      const channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });

      if (channel) {
        const oauth2Client = await getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: channel.accessToken,
          refresh_token: channel.refreshToken,
          expiry_date: channel.tokenExpiry.getTime()
        });

        // Refrescar token si expira pronto
        if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
          const { credentials } = await oauth2Client.refreshAccessToken();
          await prisma.channel.update({
            where: { id: channel.id },
            data: {
              accessToken: credentials.access_token,
              tokenExpiry: new Date(credentials.expiry_date)
            }
          });
        }

        const youtube = google.youtube({
          version: 'v3',
          auth: oauth2Client
        });

        const videoRes = await youtube.videos.list({
          part: 'snippet',
          id: youtubeId
        });

        if (videoRes.data.items && videoRes.data.items.length > 0) {
          const publishedAt = videoRes.data.items[0].snippet.publishedAt;
          if (publishedAt) {
            uploadDate = new Date(publishedAt);
          }
        }
      }
    } catch (ytError) {
      console.warn('[Tasks API] No se pudo obtener la fecha de subida original de YouTube:', ytError.message);
      // Fallback a la fecha actual por defecto
    }

    const newTask = await prisma.videoTask.create({
      data: {
        youtubeId,
        title,
        description,
        uploadDate,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'PENDING'
      }
    });

    return NextResponse.json(newTask);
  } catch (error) {
    console.error('[Tasks POST API Error]:', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Ya existe una tarea registrada con este ID de YouTube' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Error al crear la tarea' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { id, dueDate } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Falta el ID de la tarea' }, { status: 400 });
    }
    const updatedTask = await prisma.videoTask.update({
      where: { id },
      data: {
        dueDate: dueDate ? new Date(dueDate) : null
      }
    });
    return NextResponse.json(updatedTask);
  } catch (error) {
    console.error('[Tasks PATCH API Error]:', error);
    return NextResponse.json({ error: 'Error al actualizar la fecha límite de la tarea' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Falta el ID de la tarea' }, { status: 400 });
    }
    await prisma.videoTask.delete({
      where: { id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Tasks DELETE API Error]:', error);
    return NextResponse.json({ error: 'Error al eliminar la tarea' }, { status: 500 });
  }
}

