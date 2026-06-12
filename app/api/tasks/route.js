export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth } from '@/lib/auth';

function extractYoutubeId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    const urlPattern = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|user\/[^\/]+\/|embed\/|watch\?(?:.*&)?v=)|youtu\.be\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(urlPattern);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {}
  const cleanIdPattern = /^([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(cleanIdPattern);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
  try { // Force recompilation of stale Next.js cache
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let { youtubeId, title, description, dueDate } = await request.json();
    youtubeId = extractYoutubeId(youtubeId);

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
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Falta el ID de la tarea' }, { status: 400 });
    }

    // Buscar la tarea para obtener su youtubeId y limpiar programaciones activas
    const task = await prisma.videoTask.findUnique({
      where: { id }
    });

    if (task) {
      try {
        const existingScheduled = await prisma.video.findMany({
          where: {
            youtubeId: task.youtubeId,
            status: 'SCHEDULED',
            filePath: 'YOUTUBE_UPDATE'
          }
        });
        const uploadsDir = path.join(process.cwd(), 'uploads');
        for (const oldUpdate of existingScheduled) {
          const oldThumbPath = path.join(uploadsDir, `${oldUpdate.id}-thumbnail.jpg`);
          if (fs.existsSync(oldThumbPath)) {
            try {
              fs.unlinkSync(oldThumbPath);
              console.log(`[Tasks DELETE API] Deleted scheduled custom thumbnail: ${oldThumbPath}`);
            } catch (err) {
              console.warn(`[Tasks DELETE API] Failed to delete scheduled thumbnail:`, err.message);
            }
          }
        }
        await prisma.video.deleteMany({
          where: {
            youtubeId: task.youtubeId,
            status: 'SCHEDULED',
            filePath: 'YOUTUBE_UPDATE'
          }
        });
      } catch (scheduleErr) {
        console.error('[Tasks DELETE API] Error cleaning up associated schedules:', scheduleErr.message);
      }
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

