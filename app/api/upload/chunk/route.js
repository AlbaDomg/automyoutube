import { NextResponse } from 'next/server';

// Necesario para permitir subidas de fragmentos de vídeo grandes (hasta 50MB por fragmento)
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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

    // Guardar cada fragmento en un archivo temporal numerado para permitir subidas en paralelo sin corrupción
    const chunkPath = path.join(uploadsDir, `temp-${uploadId}-${chunkIndex}`);

    // Leer los datos del fragmento
    const arrayBuffer = await chunkFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Escribir el fragmento en su archivo indexado
    fs.writeFileSync(chunkPath, buffer);

    // Verificar si todos los fragmentos han sido subidos con éxito
    let allChunksUploaded = true;
    for (let i = 0; i < totalChunks; i++) {
      if (!fs.existsSync(path.join(uploadsDir, `temp-${uploadId}-${i}`))) {
        allChunksUploaded = false;
        break;
      }
    }

    // Si todos los fragmentos están listos, los fusionamos en el archivo final
    if (allChunksUploaded) {
      const finalFilePath = path.join(uploadsDir, `${uploadId}-${fileName}`);
      const lockFilePath = path.join(uploadsDir, `lock-${uploadId}`);

      // Evitar que peticiones concurrentes intenten fusionar el archivo al mismo tiempo
      if (!fs.existsSync(finalFilePath) && !fs.existsSync(lockFilePath)) {
        try {
          fs.writeFileSync(lockFilePath, 'locked');

          const writeStream = fs.createWriteStream(finalFilePath);
          for (let i = 0; i < totalChunks; i++) {
            const chunkPartPath = path.join(uploadsDir, `temp-${uploadId}-${i}`);
            const data = fs.readFileSync(chunkPartPath);
            writeStream.write(data);
          }
          writeStream.end();

          // Esperar a que la escritura del archivo termine por completo
          await new Promise((resolve) => {
            writeStream.on('finish', resolve);
          });

          // Limpiar archivos temporales de los fragmentos
          for (let i = 0; i < totalChunks; i++) {
            const chunkPartPath = path.join(uploadsDir, `temp-${uploadId}-${i}`);
            if (fs.existsSync(chunkPartPath)) {
              fs.unlinkSync(chunkPartPath);
            }
          }

          // Eliminar el archivo de bloqueo
          if (fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
          }

          // Crear la entrada del video en la base de datos
          const email = await getCurrentUserEmail(request);
          const channel = await prisma.channel.findUnique({
            where: { userEmail: email }
          });

          const video = await prisma.video.create({
            data: {
              id: uploadId,
              filename: fileName,
              filePath: finalFilePath,
              status: 'LOCAL_DRAFT',
              userEmail: email,
              channelId: channel ? channel.id : null
            }
          });

          return NextResponse.json({
            success: true,
            completed: true,
            videoId: video.id,
            message: 'Archivo subido y ensamblado correctamente.'
          });
        } catch (mergeErr) {
          console.error('Error al fusionar fragmentos:', mergeErr);
          if (fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
          }
          return NextResponse.json({ error: 'Fallo al fusionar los fragmentos en el servidor.' }, { status: 500 });
        }
      } else {
        // Si otro hilo ya está fusionando, esperamos a que termine para devolver éxito
        let checkAttempts = 0;
        while (!fs.existsSync(finalFilePath) && checkAttempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 500));
          checkAttempts++;
        }

        if (fs.existsSync(finalFilePath)) {
          return NextResponse.json({
            success: true,
            completed: true,
            videoId: uploadId,
            message: 'Archivo subido y ensamblado por otra petición paralela.'
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      completed: false,
      message: `Fragmento ${chunkIndex + 1}/${totalChunks} subido correctamente.`
    });
  } catch (error) {
    console.error('Error durante la subida del fragmento:', error);
    return NextResponse.json({ error: 'Error interno en la subida del fragmento.' }, { status: 500 });
  }
}
