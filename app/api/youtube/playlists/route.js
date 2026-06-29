export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

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
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refrescar el token de acceso si expira pronto (menos de 5 minutos)
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
        console.error('[Playlists API] Error refreshing OAuth token:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // 1. Obtener todas las listas de reproducción del canal usando paginación
    let youtubePlaylists = [];
    let nextPageToken = null;
    do {
      const response = await youtube.playlists.list({
        part: 'snippet,contentDetails',
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken || undefined
      });
      if (response.data.items) {
        youtubePlaylists.push(...response.data.items);
      }
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);


    const activePlaylistIds = youtubePlaylists.map(item => item.id);

    // 4. Obtener las playlists existentes en la base de datos para comparar y evitar escrituras innecesarias
    const dbPlaylistsBefore = await prisma.playlist.findMany({
      where: { channelId: channel.id }
    });
    const existingMap = new Map(dbPlaylistsBefore.map(p => [p.id, p]));
    const upsertPromises = [];

    // 5. Sincronizar las listas filtradas con la base de datos (upsert)
    for (const item of youtubePlaylists) {
      const existing = existingMap.get(item.id);
      const newTitle = item.snippet.title;
      const newDesc = item.snippet.description || '';
      const newThumb = item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '';

      // Solo hacemos upsert si no existe en la BD o si algún dato ha cambiado
      if (!existing || existing.title !== newTitle || existing.description !== newDesc || existing.thumbnail !== newThumb) {
        upsertPromises.push(
          prisma.playlist.upsert({
            where: { id: item.id },
            update: {
              title: newTitle,
              description: newDesc,
              thumbnail: newThumb,
              channelId: channel.id
            },
            create: {
              id: item.id,
              title: newTitle,
              description: newDesc,
              thumbnail: newThumb,
              channelId: channel.id
            }
          })
        );
      }
    }

    if (upsertPromises.length > 0) {
      console.log(`[Playlists API] Syncing ${upsertPromises.length} changed playlists in parallel...`);
      await Promise.all(upsertPromises);
    } else {
      console.log(`[Playlists API] No playlists changes detected. Skipping DB writes.`);
    }

    // 6. Eliminar listas locales que ya no estén en el conjunto activo filtrado
    await prisma.playlist.deleteMany({
      where: {
        channelId: channel.id,
        id: {
          notIn: activePlaylistIds
        }
      }
    });

    // Obtener la lista definitiva de la base de datos
    const dbPlaylists = await prisma.playlist.findMany({
      where: { channelId: channel.id },
      orderBy: { title: 'asc' }
    });

    return NextResponse.json(dbPlaylists);
  } catch (error) {
    console.error('Error fetching/syncing playlists:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch playlists' }, { status: 500 });
  }
}
