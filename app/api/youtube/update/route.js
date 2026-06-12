import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

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

export async function POST(request) {
  try { // Force recompilation of stale Next.js cache
    let { youtubeVideoId, title, description, tags, thumbnail, scheduledAt } = await request.json();
    youtubeVideoId = extractYoutubeId(youtubeVideoId);

    if (!youtubeVideoId) {
      return NextResponse.json({ error: 'Missing youtubeVideoId parameter' }, { status: 400 });
    }

    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

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
            filePath: 'YOUTUBE_UPDATE'
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
          youtubeId: youtubeVideoId
        }
      });

      // Save custom thumbnail base64 if provided
      if (thumbnail) {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const tempThumbPath = path.join(uploadsDir, `${newVideoUpdate.id}-thumbnail.jpg`);
        fs.writeFileSync(tempThumbPath, buffer);
        console.log(`[Update Video API] Saved scheduled custom thumbnail at ${tempThumbPath}`);
      }

      // 2. Actualizar el estado de la tarea (VideoTask) a 'SCHEDULED'
      try {
        await prisma.videoTask.updateMany({
          where: {
            youtubeId: youtubeVideoId,
            status: {
              in: ['PENDING', 'PENDIENTE_SINCRONIZACION']
            }
          },
          data: {
            status: 'SCHEDULED',
            title: title || '',
            description: description || ''
          }
        });
        console.log(`[Update Video API] Updated VideoTask status to SCHEDULED for youtubeVideoId: ${youtubeVideoId}`);
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
          where: { id: channel.id },
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

    const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/horagalega\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;

    let finalDescription = description || currentSnippet.description || '';
    if (finalDescription && !finalDescription.includes("tvg.gal/horagalega")) {
      finalDescription = finalDescription.trim() + socialBlock;
    }

    const updatedSnippet = {
      ...currentSnippet,
      title: finalTitle,
      description: finalDescription,
      tags: tags ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : currentSnippet.tags
    };

    console.log(`[Update Video API] Updating YouTube metadata for video ${youtubeVideoId}...`);
    await youtube.videos.update({
      part: 'snippet',
      requestBody: {
        id: youtubeVideoId,
        snippet: updatedSnippet
      }
    });

    // 3. Upload custom thumbnail if provided
    let thumbnailError = null;
    if (thumbnail) {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      const tempThumbPath = path.join(uploadsDir, `temp-update-${youtubeVideoId}.jpg`);

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

    // 4. Autocompletar la tarea si existe en la base de datos
    try {
      await prisma.videoTask.updateMany({
        where: {
          youtubeId: youtubeVideoId,
          status: {
            in: ['PENDING', 'PENDIENTE_SINCRONIZACION']
          }
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          title: title || '',
          description: description || ''
        }
      });
      console.log(`[Update Video API] Automatically completed matching VideoTask for youtubeVideoId: ${youtubeVideoId}`);
    } catch (taskError) {
      console.error('[Update Video API] Error autocompleting VideoTask:', taskError.message);
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
