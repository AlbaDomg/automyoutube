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

    // 2. Obtener nombres de programas activos desde el catálogo de logos en la base de datos
    let programNames = [];
    try {
      const dbLogos = await prisma.programLogo.findMany({
        select: { name: true }
      });
      
      // Si por alguna razón la BD está vacía, hacer una lectura rápida del directorio estático
      if (dbLogos.length === 0) {
        const STATIC_LOGOS_DIR = path.join(process.cwd(), "public", "static_program_logos");
        if (fs.existsSync(STATIC_LOGOS_DIR)) {
          const files = fs.readdirSync(STATIC_LOGOS_DIR);
          const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
          const logos = files.filter(file =>
            imageExtensions.includes(path.extname(file).toLowerCase())
          );
          logos.forEach(logo => {
            const name = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
            if (name && !programNames.includes(name)) programNames.push(name);
          });
        }
      } else {
        dbLogos.forEach(logo => {
          const name = logo.name.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
          if (name && !programNames.includes(name)) programNames.push(name);
        });
      }
    } catch (dbErr) {
      console.warn("[Playlists API] Error reading DB logos for filter:", dbErr);
    }

    // 3. Obtener IDs de playlists actualmente en uso en la base de datos local
    let usedPlaylistIds = new Set();
    try {
      const dbVideos = await prisma.video.findMany({
        where: { playlistId: { not: null } },
        select: { playlistId: true }
      });
      const dbTasks = await prisma.videoTask.findMany({
        where: { playlistId: { not: null } },
        select: { playlistId: true }
      });
      dbVideos.forEach(v => usedPlaylistIds.add(v.playlistId));
      dbTasks.forEach(t => usedPlaylistIds.add(t.playlistId));
    } catch (dbErr) {
      console.warn("[Playlists API] Error fetching used playlist IDs:", dbErr);
    }

    // 4. Filtrar listas de reproducción: creadas en el último año, en uso local o de programas activos
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const filteredPlaylists = youtubePlaylists.filter(item => {
      // Regla A: Incluir si está en uso en videos existentes en la base de datos
      if (usedPlaylistIds.has(item.id)) return true;

      // Regla B: Incluir si la lista se creó en el último año en YouTube
      const publishedAt = item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null;
      if (publishedAt && publishedAt >= oneYearAgo) return true;

      // Regla C: Incluir si el nombre de la lista coincide con alguno de nuestros programas activos
      const titleUpper = item.snippet.title.toUpperCase();
      const matchesProgram = programNames.some(prog => {
        const cleanProg = prog.toUpperCase();
        return titleUpper.includes(cleanProg) || cleanProg.includes(titleUpper);
      });
      if (matchesProgram) return true;

      return false;
    });

    const activePlaylistIds = filteredPlaylists.map(item => item.id);

    // 5. Sincronizar las listas filtradas con la base de datos (upsert)
    for (const item of filteredPlaylists) {
      await prisma.playlist.upsert({
        where: { id: item.id },
        update: {
          title: item.snippet.title,
          description: item.snippet.description || '',
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          channelId: channel.id
        },
        create: {
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description || '',
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          channelId: channel.id
        }
      });
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
