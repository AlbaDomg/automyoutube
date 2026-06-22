export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

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

    const email = await getCurrentUserEmail(request);
    let channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
    }

    if (!channel) {
      return NextResponse.json([]); // Return empty if no channel connected
    }

    const tasks = await prisma.videoTask.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' }
    });

    // Check if there are completed tasks that are missing privacyStatus
    const missingPrivacyTasks = tasks.filter(t => t.status === 'COMPLETED' && !t.privacyStatus);
    if (missingPrivacyTasks.length > 0) {
      try {
        const oauth2Client = await getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: channel.accessToken,
          refresh_token: channel.refreshToken,
          expiry_date: channel.tokenExpiry.getTime()
        });

        if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
          const { credentials } = await oauth2Client.refreshAccessToken();
          await prisma.channel.update({
            where: { dbId: channel.dbId },
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

        // Batch query in chunks of 50
        const chunkSize = 50;
        const ytStatusMap = {};
        for (let i = 0; i < missingPrivacyTasks.length; i += chunkSize) {
          const chunk = missingPrivacyTasks.slice(i, i + chunkSize);
          const ids = chunk.map(t => t.youtubeId).join(',');
          const ytRes = await youtube.videos.list({
            part: 'status',
            id: ids
          });
          if (ytRes.data.items) {
            for (const item of ytRes.data.items) {
              ytStatusMap[item.id] = item.status?.privacyStatus;
            }
          }
        }

        // Update database and in-memory list
        for (const task of missingPrivacyTasks) {
          const livePrivacy = ytStatusMap[task.youtubeId];
          if (livePrivacy) {
            await prisma.videoTask.update({
              where: { id: task.id },
              data: { privacyStatus: livePrivacy }
            });
            task.privacyStatus = livePrivacy;
          } else {
            // If the video was not found on YouTube (e.g. deleted), we fallback to private
            await prisma.videoTask.update({
              where: { id: task.id },
              data: { privacyStatus: 'private' }
            });
            task.privacyStatus = 'private';
          }
        }
      } catch (ytErr) {
        console.warn('[Tasks GET API] Failed to fetch live privacyStatus from YouTube:', ytErr.message);
      }
    }

    return NextResponse.json(tasks);
  } catch (error) {
    console.error('[Tasks GET API Error]:', error);
    return NextResponse.json({ error: 'Error al obtener las tareas' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    let channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
    }

    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    let { youtubeId, title, description, dueDate } = await request.json();
    youtubeId = extractYoutubeId(youtubeId);

    if (!youtubeId || !title || !description) {
      return NextResponse.json({ error: 'Faltan campos requeridos (ID de YouTube, título y descripción)' }, { status: 400 });
    }

    let uploadDate = new Date();

    // Intentar obtener la fecha de subida original de YouTube
    try {
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
          where: { dbId: channel.dbId },
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
    } catch (ytError) {
      console.warn('[Tasks API] No se pudo obtener la fecha de subida original de YouTube:', ytError.message);
    }

    const newTask = await prisma.videoTask.create({
      data: {
        youtubeId,
        title,
        description,
        uploadDate,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'PENDING',
        userEmail: email,
        channelId: channel.id
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

    const email = await getCurrentUserEmail(request);
    let channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
    }

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
    }

    const { id, dueDate } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Falta el ID de la tarea' }, { status: 400 });
    }

    const task = await prisma.videoTask.findUnique({
      where: { id }
    });

    if (!task || task.channelId !== channel.id) {
      return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
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

    const email = await getCurrentUserEmail(request);
    let channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      channel = await prisma.channel.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
    }

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
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

    if (!task || task.channelId !== channel.id) {
      return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    }

    try {
      const existingScheduled = await prisma.video.findMany({
        where: {
          youtubeId: task.youtubeId,
          status: 'SCHEDULED',
          filePath: 'YOUTUBE_UPDATE',
          channelId: channel.id
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
          filePath: 'YOUTUBE_UPDATE',
          channelId: channel.id
        }
      });
    } catch (scheduleErr) {
      console.error('[Tasks DELETE API] Error cleaning up associated schedules:', scheduleErr.message);
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


