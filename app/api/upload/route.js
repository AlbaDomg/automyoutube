import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId, title, description, tags, scheduledAt, privacyStatus } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    // Obtener detalles del video
    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Obtener el canal de YouTube conectado
    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    // Guardar las actualizaciones finales de metadatos y cambiar el estado a UPLOADING
    const parsedScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    const formattedTags = Array.isArray(tags) ? tags.join(', ') : (tags || video.tags);
    
    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: {
        title: title || video.title,
        description: description || video.description,
        tags: formattedTags,
        scheduledAt: parsedScheduledAt,
        status: 'UPLOADING',
        privacyStatus: privacyStatus || (parsedScheduledAt ? 'private' : 'public'),
        errorMessage: null
      }
    });

    // Ejecutar el proceso de subida de forma asíncrona en segundo plano para que no bloquee la petición (lo cual causaría un tiempo de espera agotado)
    uploadToYouTubeBackground(updatedVideo.id, channel.dbId, privacyStatus);

    return NextResponse.json({
      success: true,
      message: 'Upload started in background',
      status: 'UPLOADING'
    });
  } catch (error) {
    console.error('Error initiating upload:', error);
    return NextResponse.json({ error: error.message || 'Failed to start upload' }, { status: 500 });
  }
}

async function uploadToYouTubeBackground(videoId, channelDbId, privacyStatus) {
  try {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    const channel = await prisma.channel.findUnique({ where: { dbId: channelDbId } });

    if (!video || !channel) return;

    if (!fs.existsSync(video.filePath)) {
      throw new Error(`Video file does not exist at path: ${video.filePath}`);
    }

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Actualizar las credenciales si han caducado o están cerca de caducar (dentro de 5 minutos)
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      console.log('[YouTube Upload] Access token is expiring. Refreshing...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.channel.update({
        where: { dbId: channel.dbId },
        data: {
          accessToken: credentials.access_token,
          tokenExpiry: new Date(credentials.expiry_date)
        }
      });
      console.log('[YouTube Upload] Refreshed access token.');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // Asegurar que el título no exceda los 100 caracteres
    let finalTitle = video.title || 'Uploaded Video';
    if (finalTitle.length > 100) {
      console.warn(`[YouTube Upload] Title "${finalTitle}" exceeds 100 characters. Truncating to 100 characters.`);
      finalTitle = finalTitle.substring(0, 100);
    }

    const isScheduled = !!video.scheduledAt;
    const isTargetPublic = video.privacyStatus === 'public';

    const requestBody = {
      snippet: {
        title: finalTitle,
        description: video.description || '',
        tags: video.tags ? video.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : [],
      },
      status: {
        privacyStatus: isScheduled ? 'private' : (isTargetPublic ? 'public' : 'private')
      }
    };

    if (isScheduled && isTargetPublic) {
      requestBody.status.publishAt = video.scheduledAt.toISOString();
    }

    console.log(`[YouTube Upload] Uploading file: ${video.filePath} to channel: ${channel.title}...`);

    const fileSize = fs.statSync(video.filePath).size;
    let lastProgressUpdate = 0;
    let currentProgress = 0;

    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody,
      media: {
        body: fs.createReadStream(video.filePath)
      }
    }, {
      onUploadProgress: async (evt) => {
        const progress = Math.min(Math.round((evt.bytesRead / fileSize) * 100), 99);
        const now = Date.now();
        // Actualiza la base de datos si el progreso ha aumentado y ha transcurrido al menos 1 segundo desde la última escritura
        if (progress > currentProgress && (now - lastProgressUpdate > 1000)) {
          currentProgress = progress;
          lastProgressUpdate = now;
          console.log(`[YouTube Upload] Video ${videoId} upload progress: ${progress}%`);
          try {
            await prisma.video.update({
              where: { id: videoId },
              data: { uploadProgress: progress }
            });
          } catch (dbErr) {
            console.error('[YouTube Upload] Failed to update progress in DB:', dbErr);
          }
        }
      }
    });

    const youtubeVideoId = res.data.id;
    console.log(`[YouTube Upload] Successfully uploaded to YouTube. ID: ${youtubeVideoId}`);

    // Subir miniatura personalizada si existe
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const thumbnailPath = path.join(uploadsDir, `${videoId}-thumbnail.jpg`);
    if (fs.existsSync(thumbnailPath)) {
      try {
        console.log(`[YouTube Upload] Uploading custom thumbnail for video ${youtubeVideoId}...`);
        await youtube.thumbnails.set({
          videoId: youtubeVideoId,
          media: {
            mimeType: 'image/jpeg',
            body: fs.createReadStream(thumbnailPath)
          }
        });
        console.log('[YouTube Upload] Custom thumbnail uploaded successfully!');
        fs.unlinkSync(thumbnailPath);
      } catch (thumbError) {
        console.warn('[YouTube Upload] Failed to upload custom thumbnail (your channel might need phone verification to enable custom thumbnails):', thumbError.message);
      }
    }

    // Actualizar la entrada del video en la base de datos
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: video.scheduledAt ? 'SCHEDULED' : 'COMPLETED',
        youtubeId: youtubeVideoId,
        uploadProgress: 100
      }
    });

    // Limpiar el archivo de video local para ahorrar espacio en el servidor
    try {
      fs.unlinkSync(video.filePath);
      console.log(`[YouTube Upload] Deleted temporary video file: ${video.filePath}`);
    } catch (unlinkError) {
      console.warn(`[YouTube Upload] Failed to delete temporary file: ${video.filePath}`, unlinkError);
    }
  } catch (error) {
    console.error(`[YouTube Upload] Error in background upload for video ${videoId}:`, error);
    try {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: 'FAILED',
          errorMessage: error.message || 'Upload failed'
        }
      });
    } catch (dbErr) {
      console.error('[YouTube Upload] Failed to write failure state in DB:', dbErr);
    }
  }
}
