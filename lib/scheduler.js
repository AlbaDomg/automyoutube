import { getOAuth2Client } from './youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

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
        const finalTags = update.tags ? update.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : currentSnippet.tags;

        // Update on YouTube
        await youtube.videos.update({
          part: 'snippet',
          requestBody: {
            id: update.youtubeId,
            snippet: {
              ...currentSnippet,
              title: finalTitle,
              description: update.description || currentSnippet.description,
              tags: finalTags
            }
          }
        });

        // Set custom thumbnail if exists
        const thumbnailPath = path.join(process.cwd(), 'uploads', `${update.id}-thumbnail.jpg`);
        if (fs.existsSync(thumbnailPath)) {
          try {
            console.log(`[Scheduler] Uploading custom thumbnail for video ${update.youtubeId}...`);
            await youtube.thumbnails.set({
              videoId: update.youtubeId,
              media: {
                mimeType: 'image/jpeg',
                body: fs.createReadStream(thumbnailPath)
              }
            });
            console.log('[Scheduler] Custom thumbnail uploaded successfully!');
            fs.unlinkSync(thumbnailPath);
          } catch (thumbErr) {
            console.warn('[Scheduler] Failed to upload scheduled custom thumbnail:', thumbErr.message);
          }
        }

        // Mark completed
        await localPrisma.video.update({
          where: { id: update.id },
          data: { status: 'COMPLETED' }
        });
        console.log(`[Scheduler] Successfully applied update for YouTube video: ${update.youtubeId}`);
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
    return;
  }
  console.log('[Scheduler] Starting scheduled metadata updates worker...');
  global.schedulerInterval = setInterval(() => {
    runScheduler().catch(err => console.error('[Scheduler] Critical error in background runner:', err));
  }, 60000); // every 60 seconds
}
