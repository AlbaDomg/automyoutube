export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

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
      return NextResponse.json([]); // Return empty list if no channel connected
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (videoId) {
      const video = await prisma.video.findUnique({
        where: { id: videoId }
      });

      if (!video || video.channelId !== channel.id) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }

      return NextResponse.json(video);
    }

    const videos = await prisma.video.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json({ error: 'Failed to query database' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video || video.channelId !== channel.id) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Delete local video file if it exists
    if (video.filePath && fs.existsSync(video.filePath)) {
      try {
        fs.unlinkSync(video.filePath);
        console.log(`[API Video Delete] Deleted file from disk: ${video.filePath}`);
      } catch (fileError) {
        console.warn(`[API Video Delete] Failed to delete file: ${video.filePath}`, fileError);
      }
    }

    // Delete local thumbnail if it exists
    const thumbnailPath = path.join(process.cwd(), 'uploads', `${videoId}-thumbnail.jpg`);
    if (fs.existsSync(thumbnailPath)) {
      try {
        fs.unlinkSync(thumbnailPath);
        console.log(`[API Video Delete] Deleted thumbnail from disk: ${thumbnailPath}`);
      } catch (thumbError) {
        console.warn(`[API Video Delete] Failed to delete thumbnail: ${thumbnailPath}`, thumbError);
      }
    }

    // Delete database record
    await prisma.video.delete({
      where: { id: videoId }
    });

    return NextResponse.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json({ error: 'Failed to delete video' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({
      where: { userEmail: email }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No channel connected' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video || video.channelId !== channel.id) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, description, tags, scheduledAt, status } = body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) {
      updateData.tags = Array.isArray(tags) ? tags.join(', ') : tags;
    }
    if (status !== undefined) updateData.status = status;
    if (scheduledAt !== undefined) {
      updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    }

    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: updateData
    });

    return NextResponse.json({ success: true, video: updatedVideo });
  } catch (error) {
    console.error('Error updating video:', error);
    return NextResponse.json({ error: 'Failed to update video' }, { status: 500 });
  }
}

