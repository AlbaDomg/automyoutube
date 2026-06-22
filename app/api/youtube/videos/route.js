import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

function extractVideoId(query) {
  if (!query) return null;
  const trimmed = query.trim();

  // Expresión regular para varias formas de URLs de YouTube
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = trimmed.match(regExp);

  if (match && match[2].length === 11) {
    return match[2];
  }

  // Si no es URL, pero tiene 11 caracteres y es un ID de video válido
  if (trimmed.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

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

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refresh token if needed
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await prisma.channel.update({
          where: { dbId: channel.dbId },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date)
          }
        });
      } catch (err) {
        console.error('Error refreshing token in videos api:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    let videos = [];
    let videoIds = [];
    let isSearchById = false;

    if (q) {
      const targetVideoId = extractVideoId(q);
      if (targetVideoId) {
        videoIds = [targetVideoId];
        isSearchById = true;
      }
    }

    if (!isSearchById) {
      // Obtener la lista de reproducción de subidas del canal
      const channelRes = await youtube.channels.list({
        part: 'contentDetails',
        id: channel.id
      });

      if (!channelRes.data.items || channelRes.data.items.length === 0) {
        return NextResponse.json({ error: 'No se encontraron los detalles del canal' }, { status: 404 });
      }

      const uploadsPlaylistId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;

      // Obtener los elementos de la lista de reproducción de subidas (hasta 50 videos)
      const playlistRes = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: 50
      });

      videoIds = (playlistRes.data.items || []).map(item => item.snippet.resourceId.videoId).filter(Boolean);
    }

    // Función auxiliar para parsear la duración ISO 8601 de YouTube (ej. PT1M15S)
    const parseDurationToSeconds = (duration) => {
      if (!duration) return 0;
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;
      const hours = parseInt(match[1] || 0, 10);
      const minutes = parseInt(match[2] || 0, 10);
      const seconds = parseInt(match[3] || 0, 10);
      return (hours * 3600) + (minutes * 60) + seconds;
    };

    if (videoIds.length > 0) {
      // Realizar una única consulta por lotes para traer snippets, detalles de contenido, estado de privacidad y detalles de archivo
      const videoDetailsRes = await youtube.videos.list({
        part: 'snippet,contentDetails,status,fileDetails',
        id: videoIds.join(',')
      });

      videos = (videoDetailsRes.data.items || []).map(item => {
        // Si buscamos por un ID específico (q está presente), verificar que pertenece a este canal
        if (isSearchById && item.snippet?.channelId !== channel.id) {
          return null;
        }

        // Filtro de privacidad: Solo detectar videos en estado PRIVADO u OCULTO
        const privacy = item.status?.privacyStatus;
        if (privacy !== 'private' && privacy !== 'unlisted') {
          return null;
        }

        const durationStr = item.contentDetails?.duration || '';
        const durationSeconds = parseDurationToSeconds(durationStr);
        // YouTube considera Shorts a los videos de menos de 60 segundos
        const isShort = durationSeconds > 0 && durationSeconds <= 60;

        return {
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          publishedAt: item.snippet.publishedAt,
          tags: item.snippet.tags ? item.snippet.tags.join(', ') : '',
          isShort: isShort,
          privacyStatus: privacy,
          fileName: item.fileDetails?.fileName || ''
        };
      }).filter(Boolean);

      // Si no es búsqueda por ID directo y se especificó consulta 'q', filtrar por título en el servidor
      if (q && !isSearchById) {
        const queryClean = q.toLowerCase().trim();
        videos = videos.filter(v => v.title.toLowerCase().includes(queryClean));
      }

      // Si buscamos por ID y la lista final está vacía (no era privado/oculto o no existe)
      if (isSearchById && videos.length === 0) {
        if (!videoDetailsRes.data.items || videoDetailsRes.data.items.length === 0) {
          return NextResponse.json({ error: 'No se encontró ningún video con ese ID en YouTube.' }, { status: 404 });
        } else {
          return NextResponse.json({ error: 'El video no cumple los requisitos (debe estar en estado privado u oculto).' }, { status: 400 });
        }
      }
    }

    return NextResponse.json(videos);
  } catch (error) {
    console.error('Error fetching YouTube videos:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch YouTube videos' }, { status: 500 });
  }
}
