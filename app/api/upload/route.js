import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import crypto from 'crypto';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'complete') {
      return await handleCompleteUpload(request);
    } else {
      return await handleInitiateUpload(request);
    }
  } catch (error) {
    console.error('Error in upload route:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

// Fase 1: Iniciar sesión de subida resumible con la API de YouTube
async function handleInitiateUpload(request) {
  const body = await request.json();
  const { title, description, fileName, fileSize, fileType, rawFrameBase64, playlistId } = body;

  if (!fileName || !fileSize) {
    return NextResponse.json({ error: 'Missing fileName or fileSize' }, { status: 400 });
  }

  const email = await getCurrentUserEmail(request);
  const channel = await prisma.channel.findUnique({
    where: { userEmail: email }
  });

  if (!channel) {
    return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
  }

  const oauth2Client = await getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: channel.accessToken,
    refresh_token: channel.refreshToken,
    expiry_date: channel.tokenExpiry.getTime()
  });

  // Refrescar el token de acceso si va a expirar en los próximos 5 minutos
  let accessToken = channel.accessToken;
  if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
    console.log('[YouTube Resumable API] Access token is expiring. Refreshing...');
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.channel.update({
        where: { dbId: channel.dbId },
        data: {
          accessToken: credentials.access_token,
          tokenExpiry: new Date(credentials.expiry_date)
        }
      });
      accessToken = credentials.access_token;
      console.log('[YouTube Resumable API] Access token refreshed.');
    } catch (refreshErr) {
      console.error('[YouTube Resumable API] Error refreshing access token:', refreshErr);
      return NextResponse.json({ error: 'Failed to refresh YouTube access token' }, { status: 500 });
    }
  }

  // Estructurar metadatos del vídeo para la API de YouTube
  const videoMetadata = {
    snippet: {
      title: (title || fileName || 'Video sin título').substring(0, 100),
      description: description || '',
      tags: []
    },
    status: {
      privacyStatus: 'private' // Inicialmente siempre privado
    }
  };

  const origin = request.headers.get('origin');
  console.log(`[YouTube Resumable API] Initiating session for ${fileName} (${fileSize} bytes). Client Origin: ${origin}`);

  // Solicitar URL de sesión resumible a la API de YouTube
  const youtubeUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Length': String(fileSize),
    'X-Upload-Content-Type': fileType || 'video/mp4'
  };

  if (origin) {
    headers['Origin'] = origin;
  }

  const response = await fetch(youtubeUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(videoMetadata)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[YouTube Resumable API] Failed to initiate session:', errorText);
    return NextResponse.json({ error: `YouTube API Error: ${response.statusText} (${errorText})` }, { status: response.status });
  }

  const uploadUrl = response.headers.get('Location');
  if (!uploadUrl) {
    return NextResponse.json({ error: 'Missing Location header from YouTube API' }, { status: 502 });
  }

  // Si se proporciona un videoId existente, actualizamos el registro en lugar de crear uno nuevo
  let finalVideoId = body.videoId;

  if (finalVideoId) {
    await prisma.video.update({
      where: { id: finalVideoId },
      data: {
        status: 'UPLOADING',
        title: title || undefined,
        description: description || undefined,
        playlistId: playlistId || undefined
      }
    });
  } else {
    finalVideoId = crypto.randomUUID();
    // Guardar en base de datos local con estado UPLOADING
    await prisma.video.create({
      data: {
        id: finalVideoId,
        filename: fileName,
        filePath: 'YOUTUBE_UPLOAD',
        title: title || '',
        description: description || '',
        status: 'UPLOADING',
        uploadProgress: 0,
        rawFrameBase64: rawFrameBase64 || null,
        playlistId: playlistId || null,
        userEmail: email,
        channelId: channel.id
      }
    });
  }

  return NextResponse.json({
    success: true,
    uploadUrl,
    videoId: finalVideoId
  });
}

// Fase 2: Finalizar la subida en la base de datos tras subida directa del cliente
async function handleCompleteUpload(request) {
  const { videoId, youtubeId } = await request.json();

  if (!videoId || !youtubeId) {
    return NextResponse.json({ error: 'Missing videoId or youtubeId' }, { status: 400 });
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId }
  });

  if (!video) {
    return NextResponse.json({ error: 'Video record not found' }, { status: 404 });
  }

  const email = await getCurrentUserEmail(request);
  const channel = await prisma.channel.findUnique({
    where: { userEmail: email }
  });

  // Si hay playlist seleccionada, añadir a la playlist en YouTube
  if (video.playlistId && channel) {
    try {
      const oauth2Client = await getOAuth2Client();
      oauth2Client.setCredentials({
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.tokenExpiry.getTime()
      });

      // Refrescar token si es necesario
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

      const google = require('googleapis').google;
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      console.log(`[YouTube Resumable API] Adding video ${youtubeId} to playlist ${video.playlistId}...`);
      await youtube.playlistItems.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            playlistId: video.playlistId,
            resourceId: {
              kind: 'youtube#video',
              videoId: youtubeId
            }
          }
        }
      });
      console.log('[YouTube Resumable API] Playlist insertion succeeded!');
    } catch (playlistErr) {
      console.warn('[YouTube Resumable API] Failed to add video to playlist:', playlistErr.message);
    }
  }

  // Actualizar base de datos
  const updatedVideo = await prisma.video.update({
    where: { id: videoId },
    data: {
      youtubeId: youtubeId,
      status: 'READY',
      uploadProgress: 100
    }
  });

  return NextResponse.json({
    success: true,
    video: updatedVideo
  });
}
