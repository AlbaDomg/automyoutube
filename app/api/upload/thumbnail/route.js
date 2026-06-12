import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAppAuth } from '@/lib/auth';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { videoId, thumbnail } = await request.json();

    if (!videoId || !thumbnail) {
      return NextResponse.json({ error: 'Missing videoId or thumbnail parameter' }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Strip the Data URL prefix if it exists
    const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    const thumbnailPath = path.join(uploadsDir, `${videoId}-thumbnail.jpg`);
    fs.writeFileSync(thumbnailPath, buffer);

    console.log(`[API Thumbnail Upload] Saved thumbnail for video ${videoId} at ${thumbnailPath}`);

    return NextResponse.json({ success: true, message: 'Thumbnail saved successfully' });
  } catch (error) {
    console.error('Error saving thumbnail:', error);
    return NextResponse.json({ error: 'Failed to save thumbnail' }, { status: 500 });
  }
}
