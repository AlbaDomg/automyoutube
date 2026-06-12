import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { getConfig, setConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

function extractYoutubeId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    const urlPattern = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|user\/[^\/]+\/|embed\/|watch\?(?:.*&)?v=)|youtu\.be\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(urlPattern);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {}
  const cleanIdPattern = /^([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(cleanIdPattern);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

// Función helper con reintentos y backoff exponencial para llamadas a Gemini
async function callGeminiWithRetry(fn, maxRetries = 3, delayMs = 3000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isTransient = err.message && (
        err.message.includes('503') || 
        err.message.includes('UNAVAILABLE') || 
        err.message.includes('high demand') || 
        err.message.includes('429') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('overloaded') ||
        err.message.includes('Rate limit')
      );
      if (attempt >= maxRetries || !isTransient) {
        throw err;
      }
      console.warn(`[Gemini API] Falló la llamada a Gemini (Intento ${attempt}/${maxRetries}): ${err.message}. Reintentando en ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2; // Backoff exponencial
    }
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    let youtubeVideoId = formData.get('youtubeVideoId');
    youtubeVideoId = extractYoutubeId(youtubeVideoId);
    const videoIndex = formData.get('videoIndex') || '1';

    if (!youtubeVideoId) {
      return NextResponse.json({ error: 'Falta el parámetro youtubeVideoId' }, { status: 400 });
    }



    // 1. Verificar canal y recuperar token de YouTube
    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No hay ningún canal de YouTube conectado. Autentícate primero.' }, { status: 400 });
    }

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refrescar token si expira pronto
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await prisma.channel.update({
          where: { id: channel.id },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date)
          }
        });
      } catch (err) {
        console.error('Error al refrescar el token en la API de análisis PDF:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // Obtener detalles del video en YouTube para asegurar que existe (no bloqueante)
    let currentSnippet = { title: `Video (${youtubeVideoId})`, description: '' };
    try {
      const videoRes = await youtube.videos.list({
        part: 'snippet',
        id: youtubeVideoId
      });

      if (videoRes.data.items && videoRes.data.items.length > 0) {
        currentSnippet = videoRes.data.items[0].snippet;
      } else {
        console.warn(`[PDF Analyze API] El video ${youtubeVideoId} no se encontró en YouTube (list vacío).`);
      }
    } catch (ytError) {
      console.warn('[PDF Analyze API] Error al consultar video en YouTube:', ytError.message);
    }

    // 2. Procesar el archivo PDF (cargar desde FormData o desde el servidor si ya existe)
    let pdfBase64 = "";
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const activeFilePath = path.join(process.cwd(), 'public', 'active_reference.pdf');
      fs.writeFileSync(activeFilePath, buffer);
      
      await setConfig('ACTIVE_PDF_NAME', file.name);
      pdfBase64 = buffer.toString('base64');
    } else {
      const activeFilePath = path.join(process.cwd(), 'public', 'active_reference.pdf');
      if (!fs.existsSync(activeFilePath)) {
        return NextResponse.json({ error: 'No hay ningún PDF de referencia guardado en el servidor. Sube uno primero.' }, { status: 400 });
      }
      const buffer = fs.readFileSync(activeFilePath);
      pdfBase64 = buffer.toString('base64');
    }

    // 3. Inicializar Gemini
    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La clave de API de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analiza el documento PDF de referencia adjunto. Este documento contiene una tabla con los metadatos de los videos de redes para "Hora Galega".
Localiza la fila de la tabla de videos correspondiente al número de vídeo ${videoIndex} (por ejemplo, 'Vídeo ${videoIndex}', 'Video ${videoIndex}', etc.).

Extrae de forma EXACTA y LITERAL (copia y pega sin modificar, resumir ni optimizar):
1. El valor de la columna 'Titular' (que servirá como el título del video).
2. El valor de la columna 'Sinopse' (que servirá como la descripción del video).

Además, genera usando IA:
1. Una frase SEO de alto impacto de exactamente 4 palabras en Gallego (Galician) para imprimir en la miniatura, basada en el tema de este video.
   - REGLA CRÍTICA: NO debes copiar simplemente las primeras 4 palabras del título. Debe ser una frase creada con sentido lógico coherente completo.
   - ESTRUCTURA DE DISEÑO: Imagina la frase dividida conceptualmente en un "título de 2 palabras" y un "subtítulo de 2 palabras" que tengan relación y coherencia entre sí (por ejemplo: "ALERTA MOS" + "EVITA PICADURAS", o "CONCURSO TVG" + "PREMIO FINAL", o "MANTER BATEAS" + "CONSELLO PRÁCTICO").
   - Las palabras deben estar muy optimizadas para capturar el interés (SEO / CTR alto).

Responde obligatoriamente en formato JSON con la siguiente estructura exacta:
{
  "title": "Titular literal extraído",
  "description": "Sinopse literal extraído",
  "thumbnailText": "Frase de cuatro palabras en Gallego"
}
`;

    console.log(`[PDF Analyze API] Enviando PDF de referencia a Gemini para el video ${youtubeVideoId}...`);
    let response;
    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: pdfBase64,
                  mimeType: 'application/pdf'
                }
              },
              { text: prompt }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        }
      }));
    } catch (err) {
      // Fallback a gemini-flash-latest si excedemos cuota
      const isQuotaExceeded = err.message && (
        err.message.includes('429') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('quota') ||
        err.message.includes('Quota exceeded')
      );

      if (isQuotaExceeded) {
        console.warn('[Gemini API] Cuota de gemini-2.5-flash superada. Usando fallback gemini-flash-latest...');
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: pdfBase64,
                    mimeType: 'application/pdf'
                  }
                },
                { text: prompt }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
          }
        }));
      } else {
        throw err;
      }
    }

    let metadata;
    try {
      metadata = JSON.parse(response.text);
    } catch (parseError) {
      console.error('Fallo al parsear respuesta JSON de Gemini. Texto bruto:', response.text);
      throw new Error('Gemini no devolvió una estructura JSON válida');
    }

    const suggestedTitle = metadata.title || metadata.titles?.[0] || currentSnippet.title;
    const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/horagalega\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;
    const baseDescription = metadata.description || '';
    const finalDescription = baseDescription.trim() ? `${baseDescription.trim()}${socialBlock}` : socialBlock.trim();
    const tagsString = metadata.tags ? metadata.tags.join(', ') : '';

    // 4. Crear o actualizar la tarea VideoTask en estado PENDIENTE_SINCRONIZACION
    console.log(`[PDF Analyze API] Upserting VideoTask para el video ${youtubeVideoId} en estado PENDIENTE_SINCRONIZACION...`);
    const task = await prisma.videoTask.upsert({
      where: { youtubeId: youtubeVideoId },
      update: {
        title: suggestedTitle,
        description: finalDescription,
        thumbnailText: metadata.thumbnailText || '',
        status: 'PENDIENTE_SINCRONIZACION',
        completedAt: null,
        updatedAt: new Date()
      },
      create: {
        youtubeId: youtubeVideoId,
        title: suggestedTitle,
        description: finalDescription,
        thumbnailText: metadata.thumbnailText || '',
        status: 'PENDIENTE_SINCRONIZACION'
      }
    });

    const activePdfName = await getConfig('ACTIVE_PDF_NAME') || '';
    return NextResponse.json({
      success: true,
      task,
      suggestions: {
        titles: [suggestedTitle],
        description: finalDescription,
        tags: metadata.tags || [],
        thumbnailText: metadata.thumbnailText || ''
      },
      activePdfName
    });

  } catch (error) {
    console.error('Error en API de análisis PDF:', error);
    return NextResponse.json({ error: error.message || 'Fallo al analizar el PDF con Gemini' }, { status: 500 });
  }
}
