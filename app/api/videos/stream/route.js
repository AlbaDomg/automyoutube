export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return new Response('Missing id parameter', { status: 400 });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video || !video.filePath) {
      return new Response('Video not found', { status: 404 });
    }

    // Verify file exists
    if (!fs.existsSync(video.filePath)) {
      return new Response('Video file not found on server disk', { status: 404 });
    }

    const stat = fs.statSync(video.filePath);
    const fileSize = stat.size;
    const range = request.headers.get('range');

    const contentType = 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      
      // Prevent range overflow
      const cleanEnd = Math.min(end, fileSize - 1);
      const cleanStart = Math.min(start, cleanEnd);
      const chunksize = (cleanEnd - cleanStart) + 1;
      const fileStream = fs.createReadStream(video.filePath, { start: cleanStart, end: cleanEnd });

      const head = {
        'Content-Range': `bytes ${cleanStart}-${cleanEnd}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      return new Response(fileStream, {
        status: 206,
        headers: head
      });
    } else {
      const fileStream = fs.createReadStream(video.filePath);
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      };
      return new Response(fileStream, {
        status: 200,
        headers: head
      });
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
