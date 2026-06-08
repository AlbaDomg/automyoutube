import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const chunkFile = formData.get('chunk');
    const fileName = formData.get('fileName');
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const totalChunks = parseInt(formData.get('totalChunks'));

    if (!chunkFile || !fileName || !uploadId) {
      return NextResponse.json({ error: 'Missing required upload parameters' }, { status: 400 });
    }

    // Ensure uploads directory exists within the workspace
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const tempFilePath = path.join(uploadsDir, `temp-${uploadId}-${fileName}`);

    // Read chunk data
    const arrayBuffer = await chunkFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Append buffer to the temp file
    // We assume sequential uploads on the client
    fs.appendFileSync(tempFilePath, buffer);

    // If it's the last chunk, finalize the file
    if (chunkIndex === totalChunks - 1) {
      const finalFilePath = path.join(uploadsDir, `${uploadId}-${fileName}`);
      fs.renameSync(tempFilePath, finalFilePath);

      // Create video entry in the database
      const video = await prisma.video.create({
        data: {
          id: uploadId,
          filename: fileName,
          filePath: finalFilePath,
          status: 'READY'
        }
      });

      return NextResponse.json({
        success: true,
        completed: true,
        videoId: video.id,
        message: 'File upload complete'
      });
    }

    return NextResponse.json({
      success: true,
      completed: false,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded`
    });
  } catch (error) {
    console.error('Error during chunk upload:', error);
    return NextResponse.json({ error: 'Chunk upload failed' }, { status: 500 });
  }
}
