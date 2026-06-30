export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json([]); // Return empty list if no channel connected
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (videoId) {
      const video = await prisma.video.findUnique({
        where: { id: videoId }
      });

      if (!video || (video.channelId && video.channelId !== channel.id)) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }

      if (video.status === 'COMPLETED' && video.youtubeId && !video.privacyStatus) {
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

          const ytRes = await youtube.videos.list({
            part: 'status',
            id: video.youtubeId
          });

          if (ytRes.data.items && ytRes.data.items[0]) {
            const livePrivacy = ytRes.data.items[0].status?.privacyStatus || 'private';
            await prisma.video.update({
              where: { id: video.id },
              data: { privacyStatus: livePrivacy }
            });
            video.privacyStatus = livePrivacy;
          }
        } catch (ytErr) {
          console.warn(`[Videos GET API] Failed to fetch live status for single video ${video.id}:`, ytErr.message);
        }
      }

      // Determinar si tiene fotogramas y cuántos
      const uploadsDir = path.join(process.cwd(), 'uploads');
      let hasFrames = !!video.rawFrameBase64;
      let extractedFramesCount = 0;

      if (hasFrames && video.rawFrameBase64.startsWith('[')) {
        try {
          const parsed = JSON.parse(video.rawFrameBase64);
          extractedFramesCount = Array.isArray(parsed) ? parsed.length : 1;
        } catch (e) {
          extractedFramesCount = 1;
        }
      }

      try {
        const hasLocalFrames = fs.existsSync(path.join(uploadsDir, `${video.id}-frame-0.jpg`));
        if (hasLocalFrames) {
          hasFrames = true;
          let localCount = 0;
          for (let i = 0; i < 8; i++) {
            if (fs.existsSync(path.join(uploadsDir, `${video.id}-frame-${i}.jpg`))) {
              localCount++;
            } else {
              break;
            }
          }
          extractedFramesCount = Math.max(extractedFramesCount, localCount || 6);
        }
      } catch (fsErr) {
        console.warn('[Videos API] Failed to check frame files on disk:', fsErr.message);
      }

      const thumbnailBase64 = `/api/videos/thumbnail?id=${video.id}`;
      const rawFrameBase64 = hasFrames ? `/api/videos/thumbnail?id=${video.id}&frame=0` : null;

      return NextResponse.json({
        ...video,
        thumbnailBase64,
        rawFrameBase64,
        hasExtractedFrames: hasFrames,
        extractedFramesCount
      });
    }

    const videos = await prisma.video.findMany({
      where: {
        OR: [
          { channelId: channel.id },
          { channelId: null }
        ]
      },
      select: {
        id: true,
        filename: true,
        filePath: true,
        title: true,
        description: true,
        tags: true,
        scheduledAt: true,
        status: true,
        youtubeId: true,
        errorMessage: true,
        uploadProgress: true,
        supabasePath: true,
        playlistId: true,
        userEmail: true,
        channelId: true,
        privacyStatus: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Check if there are completed local videos that are missing privacyStatus
    const missingPrivacyVideos = videos.filter(v => v.status === 'COMPLETED' && v.youtubeId && !v.privacyStatus);
    if (missingPrivacyVideos.length > 0) {
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
        for (let i = 0; i < missingPrivacyVideos.length; i += chunkSize) {
          const chunk = missingPrivacyVideos.slice(i, i + chunkSize);
          const ids = chunk.map(v => v.youtubeId).join(',');
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
        for (const video of missingPrivacyVideos) {
          const livePrivacy = ytStatusMap[video.youtubeId];
          if (livePrivacy) {
            await prisma.video.update({
              where: { id: video.id },
              data: { privacyStatus: livePrivacy }
            });
            video.privacyStatus = livePrivacy;
          } else {
            // If the video was not found on YouTube (e.g. deleted), we fallback to private
            await prisma.video.update({
              where: { id: video.id },
              data: { privacyStatus: 'private' }
            });
            video.privacyStatus = 'private';
          }
        }
      } catch (ytErr) {
        console.warn('[Videos GET API] Failed to fetch live privacyStatus from YouTube:', ytErr.message);
      }
    }

    // 1. Obtener los IDs de vídeos que tienen rawFrameBase64 en la BD de manera ultra-rápida (seleccionando solo id)
    let idsWithFrames = new Set();
    try {
      const videosWithRawFrames = await prisma.video.findMany({
        where: {
          OR: [
            { channelId: channel.id },
            { channelId: null }
          ],
          rawFrameBase64: { not: null }
        },
        select: { id: true }
      });
      idsWithFrames = new Set(videosWithRawFrames.map(v => v.id));
    } catch (dbErr) {
      console.warn('[Videos API] Failed to fetch rawFrameBase64 presence set:', dbErr.message);
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const videosWithFrames = videos.map(video => {
      // Determinar si tiene fotogramas y cuántos
      // Como excluimos rawFrameBase64 de la consulta general por rendimiento,
      // comprobamos su presencia usando idsWithFrames y el disco local.
      let hasFrames = idsWithFrames.has(video.id);
      let extractedFramesCount = hasFrames ? 8 : 0;

      // Intentar comprobar también si hay fotogramas locales en disco
      try {
        const hasLocalFrames = fs.existsSync(path.join(uploadsDir, `${video.id}-frame-0.jpg`));
        if (hasLocalFrames) {
          hasFrames = true;
          // Contar cuántos fotogramas locales hay en disco (hasta 8)
          let localCount = 0;
          for (let i = 0; i < 8; i++) {
            if (fs.existsSync(path.join(uploadsDir, `${video.id}-frame-${i}.jpg`))) {
              localCount++;
            } else {
              break;
            }
          }
          extractedFramesCount = Math.max(extractedFramesCount, localCount || 6);
        }
      } catch (fsErr) {
        console.warn('[Videos API] Failed to check frame files on disk:', fsErr.message);
      }

      // Devolver URLs dinámicas ligeras en lugar de los textos Base64 pesados.
      const thumbnailBase64 = `/api/videos/thumbnail?id=${video.id}`;
      const rawFrameBase64 = hasFrames ? `/api/videos/thumbnail?id=${video.id}&frame=0` : null;

      return {
        ...video,
        thumbnailBase64,
        rawFrameBase64,
        hasExtractedFrames: hasFrames,
        extractedFramesCount
      };
    });

    return NextResponse.json(videosWithFrames);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json({ error: 'Failed to query database' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');
    const onlyLocal = searchParams.get('onlyLocal') === 'true';

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    // Buscar si existe en la base de datos por ID (UUID)
    let video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    let ytId = null;

    if (video) {
      ytId = video.youtubeId;
    } else {
      // Intentar buscar por youtubeId si el videoId recibido es el de YouTube
      const videosByYt = await prisma.video.findMany({
        where: { youtubeId: videoId }
      });
      if (videosByYt.length > 0) {
        video = videosByYt[0];
        ytId = video.youtubeId;
      } else {
        // Si no está en la BD local, asumir que videoId es el youtubeId directo
        ytId = videoId;
      }
    }

    // Si encontramos el registro en la base de datos, validar canal y eliminarlo junto con sus archivos
    if (video) {
      if (video.channelId && video.channelId !== channel.id) {
        return NextResponse.json({ error: 'Forbidden: Video belongs to another channel' }, { status: 403 });
      }

      // Eliminar archivo de vídeo si existe localmente
      if (video.filePath && fs.existsSync(video.filePath)) {
        try {
          fs.unlinkSync(video.filePath);
          console.log(`[API Video Delete] Deleted file from disk: ${video.filePath}`);
        } catch (fileError) {
          console.warn(`[API Video Delete] Failed to delete file: ${video.filePath}`, fileError);
        }
      }

      // Eliminar miniatura local si existe
      const thumbnailPath = path.join(process.cwd(), 'uploads', `${video.id}-thumbnail.jpg`);
      if (fs.existsSync(thumbnailPath)) {
        try {
          fs.unlinkSync(thumbnailPath);
          console.log(`[API Video Delete] Deleted thumbnail from disk: ${thumbnailPath}`);
        } catch (thumbError) {
          console.warn(`[API Video Delete] Failed to delete thumbnail: ${thumbnailPath}`, thumbError);
        }
      }

      // Eliminar de la base de datos
      await prisma.video.delete({
        where: { id: video.id }
      });
    }

    // Intentar borrar también del canal de YouTube si el cliente tiene credenciales activas y disponemos de ytId y no es solo local
    if (!onlyLocal && ytId && ytId.length === 11) {
      try {
        const oauth2Client = await getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: channel.accessToken,
          refresh_token: channel.refreshToken,
          expiry_date: channel.tokenExpiry.getTime()
        });

        // Refrescar token si queda menos de 5 minutos
        if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
          const { credentials } = await oauth2Client.refreshAccessToken();
          await prisma.channel.update({
            where: { dbId: channel.dbId },
            data: {
              accessToken: credentials.access_token,
              tokenExpiry: new Date(credentials.expiry_date)
            }
          });
          oauth2Client.setCredentials({
            access_token: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date)
          });
        }

        const youtube = google.youtube({
          version: 'v3',
          auth: oauth2Client
        });

        console.log(`[API Video Delete] Deleting video ${ytId} from YouTube...`);
        await youtube.videos.delete({
          id: ytId
        });
        console.log('[API Video Delete] Deleted video from YouTube successfully!');
      } catch (ytErr) {
        console.warn('[API Video Delete] Failed to delete video from YouTube (might be already deleted):', ytErr.message);
      }
    }

    return NextResponse.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json({ error: 'Failed to delete video' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video || (video.channelId && video.channelId !== channel.id)) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, description, tags, scheduledAt, status, thumbnailBase64, rawFrameBase64, playlistId, privacyStatus, uploadProgress, youtubeId } = body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) {
      updateData.tags = Array.isArray(tags) ? tags.join(', ') : tags;
    }
    if (status !== undefined) updateData.status = status;
    if (playlistId !== undefined) updateData.playlistId = playlistId;
    if (rawFrameBase64 !== undefined) {
      const existingRaw = video.rawFrameBase64;
      const isExistingArray = existingRaw && existingRaw.startsWith('[');
      const isNewArray = rawFrameBase64 && rawFrameBase64.startsWith('[');
      
      if (isExistingArray && !isNewArray) {
        console.log(`[Videos PATCH] Preserving existing frame array in database, ignoring single image overwrite.`);
      } else {
        updateData.rawFrameBase64 = rawFrameBase64;
      }
    }
    if (privacyStatus !== undefined) updateData.privacyStatus = privacyStatus;
    if (youtubeId !== undefined) updateData.youtubeId = youtubeId;
    if (uploadProgress !== undefined) {
      const progress = Number(uploadProgress);
      if (Number.isFinite(progress)) {
        updateData.uploadProgress = Math.max(0, Math.min(100, Math.round(progress)));
      }
    }
    if (scheduledAt !== undefined) {
      updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    }
    
    // Asociar al canal del editor que está guardando/publicando el vídeo
    if (channel) {
      updateData.channelId = channel.id;
    }

    if (thumbnailBase64 !== undefined) {
      updateData.thumbnailBase64 = thumbnailBase64;
      if (thumbnailBase64) {
        try {
          const base64Data = thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, 'base64');
          const uploadsDir = path.join(process.cwd(), 'uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          fs.writeFileSync(path.join(uploadsDir, `${videoId}-thumbnail.jpg`), buffer);
          console.log(`[API Videos PATCH] Guardada miniatura en disco para vídeo: ${videoId}`);
        } catch (fsErr) {
          console.error(`[API Videos PATCH] Error guardando miniatura en disco:`, fsErr);
        }
      }
    }

    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: updateData
    });

    return NextResponse.json({ success: true, video: updatedVideo });
  } catch (error) {
    console.error('Error updating video:', error);
    return NextResponse.json({ error: 'Failed to update video' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const body = await request.json();
    const { title, description, filename, filePath, playlistId, rawFrameBase64, scheduledAt, status, youtubeId } = body;

    // Buscar si hay canal
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    const video = await prisma.video.create({
      data: {
        filename: filename || 'Vídeo Lote',
        filePath: filePath || 'PDF_PARSED',
        title: title || '',
        description: description || '',
        status: status || 'READY',
        youtubeId: youtubeId || null,
        playlistId: playlistId || null,
        rawFrameBase64: rawFrameBase64 || null,
        userEmail: email,
        channelId: channel ? channel.id : null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null
      }
    });

    return NextResponse.json({ success: true, video });
  } catch (error) {
    console.error('Error creating video:', error);
    return NextResponse.json({ error: 'Failed to create video' }, { status: 500 });
  }
}

