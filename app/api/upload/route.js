import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  try {
    const { videoId, title, description, tags, scheduledAt } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    // Fetch video details
    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Get the connected YouTube channel
    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    // Save final metadata updates and change status to UPLOADING
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
        errorMessage: null
      }
    });

    // Run the upload process asynchronously in the background so it doesn't block the request (which would timeout)
    uploadToYouTubeBackground(updatedVideo.id, channel.id);

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

async function uploadToYouTubeBackground(videoId, channelId) {
  try {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });

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

    // Refresh credentials if expired or near expiry (within 5 minutes)
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      console.log('[YouTube Upload] Access token is expiring. Refreshing...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.channel.update({
        where: { id: channel.id },
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

    // Ensure title does not exceed 100 characters
    let finalTitle = video.title || 'Uploaded Video';
    if (finalTitle.length > 100) {
      console.warn(`[YouTube Upload] Title "${finalTitle}" exceeds 100 characters. Truncating to 100 characters.`);
      finalTitle = finalTitle.substring(0, 100);
    }

    const requestBody = {
      snippet: {
        title: finalTitle,
        description: video.description || '',
        tags: video.tags ? video.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : [],
      },
      status: {
        privacyStatus: 'private' // Required to enable scheduling
      }
    };

    if (video.scheduledAt) {
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
        // Update database if progress has increased and at least 1 second elapsed since last write
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

    // Upload custom thumbnail if exists
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

    // Update video entry in DB
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: video.scheduledAt ? 'SCHEDULED' : 'COMPLETED',
        youtubeId: youtubeVideoId,
        uploadProgress: 100
      }
    });

    // Cleanup local video file to save server space
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
