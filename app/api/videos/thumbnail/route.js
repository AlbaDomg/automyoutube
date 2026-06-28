import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const frame = searchParams.get('frame');

    if (!id) {
      return new Response('Missing id parameter', { status: 400 });
    }

    // Si se solicita un fotograma específico (0, 1, 2, 3)
    if (frame !== null && frame !== undefined) {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const framePath = path.join(uploadsDir, `${id}-frame-${frame}.jpg`);

      if (fs.existsSync(framePath)) {
        const imageBuffer = fs.readFileSync(framePath);
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
      return new Response('Frame file not found on server disk', { status: 404 });
    }

    // 1. Intentar buscar primero en la base de datos PostgreSQL
    try {
      const video = await prisma.video.findUnique({
        where: { id }
      });

      if (video && video.thumbnailBase64) {
        const base64Data = video.thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch (dbError) {
      console.warn('[Thumbnail API] Database check failed, falling back to disk:', dbError.message);
    }

    // 2. Fallback al sistema de archivos local
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const thumbnailPath = path.join(uploadsDir, `${id}-thumbnail.jpg`);

    if (!fs.existsSync(thumbnailPath)) {
      return new Response('Thumbnail not found', { status: 404 });
    }

    const imageBuffer = fs.readFileSync(thumbnailPath);

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    return new Response('Error serving thumbnail', { status: 500 });
  }
}
