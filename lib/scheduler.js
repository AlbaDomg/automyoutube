import { getOAuth2Client } from './youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';
import prisma from './db';

function slugify(text) {
  if (!text) return "";
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function runScheduler() {
  if (!prisma) return;

  try {
    // 1. Find pending updates (both SCHEDULED and FAILED that need to be retried)
    const pendingUpdates = await prisma.video.findMany({
      where: {
        filePath: 'YOUTUBE_UPDATE',
        status: {
          in: ['SCHEDULED', 'FAILED']
        },
        scheduledAt: {
          lte: new Date()
        }
      }
    });

    if (pendingUpdates.length === 0) return;
    console.log(`[Scheduler] Found ${pendingUpdates.length} scheduled metadata updates ready to apply...`);

    for (const update of pendingUpdates) {
      try {
        // Find the channel connection associated with this video's userEmail or channelId (no fallback to other users' channels)
        let channel = null;
        if (update.userEmail) {
          channel = await prisma.channel.findUnique({
            where: { userEmail: update.userEmail }
          });
        }
        if (!channel && update.channelId) {
          channel = await prisma.channel.findFirst({
            where: { id: update.channelId },
            orderBy: { updatedAt: 'desc' }
          });
        }

        if (!channel) {
          throw new Error(`No connected YouTube channel found for the scheduled user/channel.`);
        }

        console.log(`[Scheduler] Applying update for YouTube video: ${update.youtubeId} using channel: ${channel.title}...`);

        // Mark as UPLOADING (meaning active) to avoid race conditions
        await prisma.video.update({
          where: { id: update.id },
          data: { status: 'UPLOADING' }
        });

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
            console.log(`[Scheduler] Token for channel ${channel.title} is expiring. Refreshing...`);
            const { credentials } = await oauth2Client.refreshAccessToken();
            await prisma.channel.update({
              where: { dbId: channel.dbId },
              data: {
                accessToken: credentials.access_token,
                tokenExpiry: new Date(credentials.expiry_date)
              }
            });
            console.log('[Scheduler] Token refreshed successfully.');
          } catch (err) {
            console.error('[Scheduler] Error refreshing token:', err);
            await prisma.video.update({
              where: { id: update.id },
              data: {
                status: 'FAILED',
                errorMessage: `Fallo al refrescar token de canal: ${err.message}`
              }
            });
            continue;
          }
        }

        const youtube = google.youtube({
          version: 'v3',
          auth: oauth2Client
        });


        // Mark as UPLOADING (meaning active) to avoid race conditions
        await prisma.video.update({
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

        let finalDescription = (update.description || currentSnippet.description || '').trim();
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

        const finalTags = update.tags ? update.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : currentSnippet.tags;

        // Update on YouTube
        await youtube.videos.update({
          part: 'snippet,status',
          requestBody: {
            id: update.youtubeId,
            snippet: {
              ...currentSnippet,
              title: finalTitle,
              description: finalDescription,
              tags: finalTags
            },
            status: {
              privacyStatus: update.privacyStatus || 'private'
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
              await prisma.video.update({
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
        await prisma.video.update({
          where: { id: update.id },
          data: { 
            status: 'COMPLETED',
            privacyStatus: update.privacyStatus || 'private'
          }
        });
        console.log(`[Scheduler] Successfully applied update for YouTube video: ${update.youtubeId}`);

        // Also update the original video record that has the same youtubeId to COMPLETED
        if (update.youtubeId) {
          try {
            await prisma.video.updateMany({
              where: {
                youtubeId: update.youtubeId,
                status: 'SCHEDULED'
              },
              data: {
                status: 'COMPLETED',
                privacyStatus: update.privacyStatus || 'private'
              }
            });
            console.log(`[Scheduler] Also marked original video record(s) for youtubeId ${update.youtubeId} as COMPLETED.`);
          } catch (origErr) {
            console.error('[Scheduler] Failed to update original video status:', origErr.message);
          }
        }

        // Autocompletar la tarea asociada si existe en la base de datos
        try {
          await prisma.videoTask.updateMany({
            where: {
              youtubeId: update.youtubeId,
              channelId: channel.id,
              status: {
                in: ['PENDING', 'PENDIENTE_SINCRONIZACION', 'SCHEDULED']
              }
            },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              playlistId: update.playlistId || null,
              privacyStatus: update.privacyStatus || 'private'
            }
          });
          console.log(`[Scheduler] Automatically completed matching VideoTask for youtubeVideoId: ${update.youtubeId}`);
        } catch (taskError) {
          console.error('[Scheduler] Error autocompleting VideoTask:', taskError.message);
        }
      } catch (error) {
        console.error(`[Scheduler] Failed to apply update for ${update.youtubeId}:`, error);
        await prisma.video.update({
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

// Background worker is disabled. Manual/cron triggers are used instead.

/**
 * Fuerza la ejecución del scheduler para un video concreto,
 * ignorando el filtro de fecha (útil para publicar antes de la hora programada).
 */
export async function runSchedulerForVideo(videoId) {
  if (!prisma || !videoId) return;

  const video = await prisma.video.findFirst({
    where: {
      id: videoId,
      filePath: 'YOUTUBE_UPDATE',
      status: { in: ['SCHEDULED', 'FAILED', 'LOCAL_DRAFT'] }
    }
  });

  if (!video) {
    throw new Error(`Video ${videoId} no encontrado o no tiene estado publicable.`);
  }

  // Reutilizar el loop del scheduler pasando un array de uno
  const originalFindMany = prisma.video.findMany.bind(prisma.video);
  const patchedPrisma = {
    ...prisma,
    video: {
      ...prisma.video,
      findMany: async (args) => {
        // Solo interceptamos la llamada del scheduler principal
        if (args?.where?.scheduledAt?.lte) {
          return [video];
        }
        return originalFindMany(args);
      }
    }
  };

  // Ejecutar con el video forzado reusando la lógica existente
  // Temporalmente sobreescribir el scheduledAt para que pase el filtro
  await prisma.video.update({
    where: { id: videoId },
    data: { scheduledAt: new Date(Date.now() - 1000) } // 1 segundo en el pasado
  });

  try {
    await runScheduler();
  } finally {
    // Si el video falló, restaurar el scheduledAt original para no perderlo
    const updated = await prisma.video.findUnique({ where: { id: videoId } });
    if (updated && updated.status === 'FAILED') {
      await prisma.video.update({
        where: { id: videoId },
        data: { scheduledAt: video.scheduledAt }
      });
    }
  }
}
