import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response('Missing id parameter', { status: 400 });
    }

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
