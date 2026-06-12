import { getOAuth2Client } from './youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

let localPrisma = null;

export async function runScheduler() {
  if (!localPrisma) return;

  try {
    // 1. Get channel (OAuth credentials)
    const channel = await localPrisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });
    if (!channel) return;

    // 2. Find pending updates
    const pendingUpdates = await localPrisma.video.findMany({
      where: {
        filePath: 'YOUTUBE_UPDATE',
        status: 'SCHEDULED',
        scheduledAt: {
          lte: new Date()
        }
      }
    });

    if (pendingUpdates.length === 0) return;
    console.log(`[Scheduler] Found ${pendingUpdates.length} scheduled metadata updates ready to apply...`);

    // Initialize YouTube client
    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refresh credentials if expiring (within 5 minutes)
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      try {
        console.log('[Scheduler] Token is expiring. Refreshing...');
        const { credentials } = await oauth2Client.refreshAccessToken();
        await localPrisma.channel.update({
          where: { id: channel.id },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date)
          }
        });
        console.log('[Scheduler] Token refreshed successfully.');
      } catch (err) {
        console.error('[Scheduler] Error refreshing token:', err);
        return;
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    for (const update of pendingUpdates) {
      try {
        console.log(`[Scheduler] Applying update for YouTube video: ${update.youtubeId}...`);

        // Mark as UPLOADING (meaning active) to avoid race conditions
        await localPrisma.video.update({
          where: { id: update.id },
          data: { status: 'UPLOADING' }
        });

        // Fetch current details
        const videoRes = await youtube.videos.list({
          part: 'snippet',
          id: update.youtubeId
        });

        if (!videoRes.data.items || videoRes.data.items.length === 0) {
          throw new Error('Video not found on YouTube');
        }

        const currentSnippet = videoRes.data.items[0].snippet;

        // Clean title and tags
        let finalTitle = update.title || currentSnippet.title;
        if (finalTitle && finalTitle.length > 100) {
          finalTitle = finalTitle.substring(0, 100);
        }
        const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/horagalega\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;

        let finalDescription = update.description || currentSnippet.description || '';
        if (finalDescription && !finalDescription.includes("tvg.gal/horagalega")) {
          finalDescription = finalDescription.trim() + socialBlock;
        }

        const finalTags = update.tags ? update.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : currentSnippet.tags;

        // Update on YouTube
        await youtube.videos.update({
          part: 'snippet',
          requestBody: {
            id: update.youtubeId,
            snippet: {
              ...currentSnippet,
              title: finalTitle,
              description: finalDescription,
              tags: finalTags
            }
          }
        });

        // Set custom thumbnail if exists in database
        if (update.thumbnailBase64) {
          const tempThumbPath = path.join(os.tmpdir(), `${update.id}-thumbnail.jpg`);
          try {
            console.log(`[Scheduler] Uploading custom thumbnail for video ${update.youtubeId} from DB...`);
            const base64Data = update.thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(tempThumbPath, buffer);

            await youtube.thumbnails.set({
              videoId: update.youtubeId,
              media: {
                mimeType: 'image/jpeg',
                body: fs.createReadStream(tempThumbPath)
              }
            });
            console.log('[Scheduler] Custom thumbnail uploaded successfully from DB!');
          } catch (thumbErr) {
            console.warn('[Scheduler] Failed to upload scheduled custom thumbnail:', thumbErr.message);
            try {
              await localPrisma.video.update({
                where: { id: update.id },
                data: { errorMessage: `Error de miniatura: ${thumbErr.message}` }
              });
            } catch (dbErr) {
              console.error('[Scheduler] Failed to update video record with thumbnail error:', dbErr.message);
            }
          } finally {
            if (fs.existsSync(tempThumbPath)) {
              try {
                fs.unlinkSync(tempThumbPath);
              } catch (e) {
                console.warn('[Scheduler] Failed to clean up temp thumbnail file:', e.message);
              }
            }
          }
        }

        // Añadir a lista de reproducción de YouTube si está configurado
        if (update.playlistId) {
          try {
            console.log(`[Scheduler] Adding video ${update.youtubeId} to playlist ${update.playlistId}...`);
            await youtube.playlistItems.insert({
              part: 'snippet',
              requestBody: {
                snippet: {
                  playlistId: update.playlistId,
                  resourceId: {
                    kind: 'youtube#video',
                    videoId: update.youtubeId
                  }
                }
              }
            });
            console.log('[Scheduler] Video added to playlist successfully!');
          } catch (playlistErr) {
            console.warn(`[Scheduler] Failed to add video to playlist:`, playlistErr.message);
          }
        }

        // Mark completed
        await localPrisma.video.update({
          where: { id: update.id },
          data: { status: 'COMPLETED' }
        });
        console.log(`[Scheduler] Successfully applied update for YouTube video: ${update.youtubeId}`);

        // Autocompletar la tarea asociada si existe en la base de datos
        try {
          await localPrisma.videoTask.updateMany({
            where: {
              youtubeId: update.youtubeId,
              status: {
                in: ['PENDING', 'PENDIENTE_SINCRONIZACION', 'SCHEDULED']
              }
            },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              playlistId: update.playlistId || null
            }
          });
          console.log(`[Scheduler] Automatically completed matching VideoTask for youtubeVideoId: ${update.youtubeId}`);
        } catch (taskError) {
          console.error('[Scheduler] Error autocompleting VideoTask:', taskError.message);
        }
      } catch (error) {
        console.error(`[Scheduler] Failed to apply update for ${update.youtubeId}:`, error);
        await localPrisma.video.update({
          where: { id: update.id },
          data: {
            status: 'FAILED',
            errorMessage: error.message || 'Failed to apply scheduled update'
          }
        });
      }
    }
  } catch (globalErr) {
    console.error('[Scheduler] Global scheduler error:', globalErr);
  }
}

export function initScheduler(prismaInstance) {
  localPrisma = prismaInstance;
  if (global.schedulerInterval) {
    clearInterval(global.schedulerInterval);
  }
  console.log('[Scheduler] Initialized (background worker disabled).');
}
