import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import crypto from 'crypto';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Registra un vídeo en la base de datos local después de que el cliente lo haya
// subido directamente a Supabase Storage. Devuelve el videoId generado.
export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, filename, fileSize, supabasePath, rawFrameBase64, extractedFrames, playlistId } = body;

    if (!supabasePath) {
      return NextResponse.json({ error: 'Missing supabasePath' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }, { status: 500 });
    }

    // URL pública completa que el editor usará para descargar el video
    const publicVideoUrl = `${supabaseUrl}/storage/v1/object/public/videos/${supabasePath}`;

    const email = await getCurrentUserEmail(request);
    const channel = await prisma.channel.findUnique({ where: { userEmail: email } });

    const videoId = crypto.randomUUID();

    const video = await prisma.video.create({
      data: {
        id: videoId,
        filename: filename || 'video.mp4',
        filePath: publicVideoUrl,    // URL pública completa → el editor descarga desde aquí
        supabasePath: supabasePath,  // Path relativo → se usa para borrar el archivo tras subir a YouTube
        title: title || '',
        description: description || '',
        status: 'READY', // Listo para que el editor lo procese
        uploadProgress: 0,
        rawFrameBase64: rawFrameBase64 || null,
        playlistId: playlistId || null,
        userEmail: email,
        channelId: channel?.id || null
      }
    });

    // Guardar fotogramas extraídos si se proporcionan
    if (extractedFrames && Array.isArray(extractedFrames)) {
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      extractedFrames.forEach((frameBase64, index) => {
        if (frameBase64 && frameBase64.startsWith('data:image/')) {
          try {
            const base64Data = frameBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const framePath = path.join(uploadsDir, `${videoId}-frame-${index}.jpg`);
            fs.writeFileSync(framePath, buffer);
            console.log(`[Supabase Register] Saved frame ${index} to ${framePath}`);
          } catch (err) {
            console.error(`[Supabase Register] Failed to save frame ${index}:`, err);
          }
        }
      });
    }

    console.log(`[Supabase Register] Video registered in DB: ${videoId}, publicUrl: ${publicVideoUrl}`);
    return NextResponse.json({ success: true, videoId, video });

  } catch (error) {
    console.error('[Supabase Register] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
