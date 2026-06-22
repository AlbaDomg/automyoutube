import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';
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

function slugify(text) {
  if (!text) return "";
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function POST(request) {
  try { // Force recompilation of stale Next.js cache
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let { youtubeVideoId, title, description, tags, thumbnail, scheduledAt, playlistId, privacyStatus } = await request.json();
    youtubeVideoId = extractYoutubeId(youtubeVideoId);

    if (!youtubeVideoId) {
      return NextResponse.json({ error: 'Missing youtubeVideoId parameter' }, { status: 400 });
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

    if (scheduledAt) {
      // 1. Delete previous scheduled updates for this video to avoid conflicts & orphaned files
      try {
        const existingScheduled = await prisma.video.findMany({
          where: {
            youtubeId: youtubeVideoId,
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
              console.log(`[Update Video API] Deleted old scheduled custom thumbnail: ${oldThumbPath}`);
            } catch (unlinkErr) {
              console.warn(`[Update Video API] Failed to delete old scheduled thumbnail:`, unlinkErr.message);
            }
          }
        }
        await prisma.video.deleteMany({
          where: {
            youtubeId: youtubeVideoId,
            status: 'SCHEDULED',
            filePath: 'YOUTUBE_UPDATE',
            channelId: channel.id
          }
        });
      } catch (cleanupErr) {
        console.error('[Update Video API] Error cleaning up previous scheduled updates:', cleanupErr.message);
      }

      // Create scheduled update entry in db
      const cleanedTags = tags ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean).join(', ') : '';
      const newVideoUpdate = await prisma.video.create({
        data: {
          filename: `Actualización: ${title ? title.substring(0, 40) : youtubeVideoId}`,
          filePath: 'YOUTUBE_UPDATE',
          title: title || '',
          description: description || '',
          tags: cleanedTags,
          scheduledAt: new Date(scheduledAt),
          status: 'SCHEDULED',
          youtubeId: youtubeVideoId,
          thumbnailBase64: thumbnail || null,
          playlistId: playlistId || null,
          userEmail: email,
          channelId: channel.id,
          privacyStatus: 'private'
        }
      });

      if (thumbnail) {
        console.log(`[Update Video API] Saved scheduled custom thumbnail in database (ID: ${newVideoUpdate.id})`);
      }

      // 2. Crear o actualizar la tarea (VideoTask) a 'SCHEDULED'
      try {
        await prisma.videoTask.upsert({
          where: { youtubeId: youtubeVideoId },
          update: {
            status: 'SCHEDULED',
            title: title || '',
            description: description || '',
            playlistId: playlistId || null,
            userEmail: email,
            channelId: channel.id,
            privacyStatus: 'private',
            updatedAt: new Date()
          },
          create: {
            youtubeId: youtubeVideoId,
            status: 'SCHEDULED',
            title: title || '',
            description: description || '',
            playlistId: playlistId || null,
            userEmail: email,
            channelId: channel.id,
            privacyStatus: 'private'
          }
        });
        console.log(`[Update Video API] Upserted VideoTask status to SCHEDULED for youtubeVideoId: ${youtubeVideoId}`);
      } catch (taskError) {
        console.error('[Update Video API] Error setting VideoTask to SCHEDULED:', taskError.message);
      }

      console.log(`[Update Video API] Successfully scheduled metadata update for YouTube video ${youtubeVideoId} at ${scheduledAt}`);
      return NextResponse.json({ success: true, message: 'YouTube video update scheduled successfully', scheduled: true });
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
        console.error('Error refreshing token in update api:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // 1. Fetch current video details to preserve categoryId and other required fields
    const videoGetRes = await youtube.videos.list({
      part: 'snippet',
      id: youtubeVideoId
    });

    if (!videoGetRes.data.items || videoGetRes.data.items.length === 0) {
      return NextResponse.json({ error: 'Video not found on YouTube' }, { status: 404 });
    }

    const currentSnippet = videoGetRes.data.items[0].snippet;

    // 2. Update the snippet fields (ensuring title is within YouTube's 100-character limit)
    let finalTitle = title || currentSnippet.title;
    if (finalTitle && finalTitle.length > 100) {
      console.warn(`[Update Video API] Title "${finalTitle}" exceeds 100 characters. Truncating to 100 characters.`);
      finalTitle = finalTitle.substring(0, 100);
    }

    let programUrlSlug = 'horagalega';
    if (finalTitle) {
      const suffixMatch = finalTitle.match(/\|\s*([a-zA-Z0-9_\sÀ-ÿ\-]+)$/);
      if (suffixMatch) {
        const cleanProg = suffixMatch[1].toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
        if (cleanProg) {
          programUrlSlug = cleanProg;
        }
      }
    }

    const customSocialBlock = `\n\nPodes ver o programa completo en tvg.gal/${programUrlSlug}\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;

    let finalDescription = (description || currentSnippet.description || '').trim();
    if (finalDescription) {
      if (finalDescription.includes("seguirnos en todas as nosas redes sociais") || finalDescription.includes("tvg.gal/")) {
        const urlRegex = /tvg\.gal\/[a-z0-9]+/gi;
        if (urlRegex.test(finalDescription)) {
          finalDescription = finalDescription.replace(urlRegex, `tvg.gal/${programUrlSlug}`);
        }
      } else {
        finalDescription = finalDescription + customSocialBlock;
      }
    } else {
      finalDescription = customSocialBlock.trim();
    }

    const updatedSnippet = {
      ...currentSnippet,
      title: finalTitle,
      description: finalDescription,
      tags: tags ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : currentSnippet.tags
    };

    console.log(`[Update Video API] Updating YouTube metadata and privacy status (${privacyStatus || 'no change'}) for video ${youtubeVideoId}...`);
    
    const requestBody = {
      id: youtubeVideoId,
      snippet: updatedSnippet
    };

    if (privacyStatus) {
      requestBody.status = {
        privacyStatus: privacyStatus
      };
    }

    await youtube.videos.update({
      part: privacyStatus ? 'snippet,status' : 'snippet',
      requestBody
    });

    // 3. Upload custom thumbnail if provided
    let thumbnailError = null;
    if (thumbnail) {
      const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      const tempThumbPath = path.join(os.tmpdir(), `temp-update-${youtubeVideoId}.jpg`);

      try {
        fs.writeFileSync(tempThumbPath, buffer);
        console.log(`[Update Video API] Uploading new custom thumbnail for video ${youtubeVideoId}...`);
        await youtube.thumbnails.set({
          videoId: youtubeVideoId,
          media: {
            mimeType: 'image/jpeg',
            body: fs.createReadStream(tempThumbPath)
          }
        });
        console.log('[Update Video API] Custom thumbnail uploaded successfully!');
      } catch (thumbErr) {
        thumbnailError = thumbErr.message;
        console.warn('[Update Video API] Failed to upload custom thumbnail (your channel might need phone verification):', thumbErr.message);
        // We do not fail the request if ONLY the thumbnail upload fails (often due to channel verification)
      } finally {
        if (fs.existsSync(tempThumbPath)) {
          fs.unlinkSync(tempThumbPath);
        }
      }
    }

    // 3.5 Añadir a lista de reproducción de YouTube si se solicita
    if (playlistId) {
      try {
        console.log(`[Update Video API] Adding video ${youtubeVideoId} to playlist ${playlistId}...`);
        await youtube.playlistItems.insert({
          part: 'snippet',
          requestBody: {
            snippet: {
              playlistId: playlistId,
              resourceId: {
                kind: 'youtube#video',
                videoId: youtubeVideoId
              }
            }
          }
        });
        console.log('[Update Video API] Video added to playlist successfully!');
      } catch (playlistErr) {
        console.warn(`[Update Video API] Failed to add video to playlist:`, playlistErr.message);
      }
    }

    // 4. Crear o actualizar la tarea (VideoTask) a 'COMPLETED'
    try {
      await prisma.videoTask.upsert({
        where: { youtubeId: youtubeVideoId },
        update: {
          status: 'COMPLETED',
          completedAt: new Date(),
          title: title || '',
          description: description || '',
          playlistId: playlistId || null,
          userEmail: email,
          channelId: channel.id,
          privacyStatus: privacyStatus || 'private',
          updatedAt: new Date()
        },
        create: {
          youtubeId: youtubeVideoId,
          status: 'COMPLETED',
          completedAt: new Date(),
          title: title || '',
          description: description || '',
          playlistId: playlistId || null,
          userEmail: email,
          channelId: channel.id,
          privacyStatus: privacyStatus || 'private'
        }
      });
      console.log(`[Update Video API] Upserted VideoTask for youtubeVideoId: ${youtubeVideoId} to COMPLETED`);
    } catch (taskError) {
      console.error('[Update Video API] Error upserting VideoTask:', taskError.message);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'YouTube video updated successfully',
      thumbnailError: thumbnailError
    });
  } catch (error) {
    console.error('Error updating YouTube video:', error);
    return NextResponse.json({ error: error.message || 'Failed to update YouTube video' }, { status: 500 });
  }
}
