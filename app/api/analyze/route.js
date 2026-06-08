import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import path from 'path';

// Función helper con reintentos y backoff exponencial para llamadas a Gemini ante saturación (errores 503, 429, etc.)
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
  let videoId = null;
  try {
    const body = await request.json();
    videoId = body.videoId;
    const language = body.language || 'Spanish';

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId }
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Update status to ANALYZING in database
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'ANALYZING', errorMessage: null }
    });

    const ai = new GoogleGenAI({ apiKey });

    // Detect mime type based on extension
    const ext = path.extname(video.filename).toLowerCase();
    let mimeType = 'video/mp4';
    if (ext === '.mov') mimeType = 'video/quicktime';
    if (ext === '.webm') mimeType = 'video/webm';
    if (ext === '.mkv') mimeType = 'video/x-matroska';
    if (ext === '.avi') mimeType = 'video/x-msvideo';

    console.log(`[Gemini API] Uploading local file to Gemini Files API: ${video.filePath}`);

    // Upload to Gemini Files API con reintentos en caso de saturación
    const uploadResult = await callGeminiWithRetry(() => ai.files.upload({
      file: video.filePath,
      config: {
        mimeType,
        displayName: video.filename,
      }
    }));

    console.log(`[Gemini API] Upload completed. Name: ${uploadResult.name}. Processing...`);

    // Poll until the file is active (usando reintentos al consultar estado)
    let fileState = await callGeminiWithRetry(() => ai.files.get({ name: uploadResult.name }));
    let attempts = 0;
    while (fileState.state === 'PROCESSING' && attempts < 120) { // Up to 10 minutes (120 * 5s)
      console.log(`[Gemini API] Processing video, attempt ${attempts + 1}...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      fileState = await callGeminiWithRetry(() => ai.files.get({ name: uploadResult.name }));
      attempts++;
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`Gemini file processing did not succeed. Current state: ${fileState.state}`);
    }

    console.log('[Gemini API] File is active. Generating titles, description and tags...');

    const prompt = `
Analyze this video and generate metadata for a YouTube upload in the following language: ${language}.
1. Three options for title (optimized for high CTR and SEO) in ${language}. CRITICAL: Each title option MUST be under 100 characters in length (YouTube API limit).
2. A compelling description including key topics and estimated timestamps if applicable in ${language}.
3. Relevant hashtags (all starting with the '#' symbol, e.g. ["#keyword1", "#keyword2"]) in ${language}.

Respond in JSON format with the following keys:
{
  "titles": ["Title 1", "Title 2", "Title 3"],
  "description": "Suggested description...",
  "tags": ["#tag1", "#tag2", "#tag3"]
}
`;

    let response;
    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                fileData: {
                  fileUri: uploadResult.uri,
                  mimeType: uploadResult.mimeType,
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        }
      }));
    } catch (err) {
      // Si el modelo 2.5-flash ha agotado la cuota de la cuenta (429 / RESOURCE_EXHAUSTED),
      // intentamos usar gemini-1.5-flash como fallback automático.
      const isQuotaExceeded = err.message && (
        err.message.includes('429') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('quota') ||
        err.message.includes('Quota exceeded')
      );

      if (isQuotaExceeded) {
        console.warn('[Gemini API] Límite de cuota excedido para gemini-2.5-flash. Intentando fallback con gemini-1.5-flash...');
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  fileData: {
                    fileUri: uploadResult.uri,
                    mimeType: uploadResult.mimeType,
                  }
                }
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

    console.log('[Gemini API] AI generated metadata successfully.');

    // Parse metadata JSON
    let metadata;
    try {
      metadata = JSON.parse(response.text);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON. Raw text:', response.text);
      throw new Error('Gemini did not return a valid JSON structure');
    }

    const suggestedTitle = metadata.titles?.[0] || 'Untitled Video';
    const suggestedDescription = metadata.description || '';
    const hashtagsString = metadata.tags && metadata.tags.length > 0
      ? '\n\n' + metadata.tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
      : '';
    const finalDescription = suggestedDescription + hashtagsString;
    const tags = metadata.tags ? metadata.tags.join(', ') : '';

    // Guardar los metadatos generados en la base de datos
    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: {
        title: suggestedTitle,
        description: finalDescription,
        tags,
        status: 'READY'
      }
    });

    // Clean up from Gemini API servers to avoid storage overhead
    try {
      await ai.files.delete({ name: uploadResult.name });
      console.log('[Gemini API] Cleaned up file from Gemini Files storage.');
    } catch (deleteError) {
      console.warn('[Gemini API] Failed to delete file from Gemini storage:', deleteError);
    }

    return NextResponse.json({
      success: true,
      video: updatedVideo,
      titles: metadata.titles || [suggestedTitle],
      description: finalDescription,
      tags: metadata.tags || []
    });
  } catch (error) {
    console.error('Error during video analysis:', error);
    if (videoId) {
      try {
        await prisma.video.update({
          where: { id: videoId },
          data: {
            status: 'FAILED',
            errorMessage: error.message || 'Video analysis failed'
          }
        });
      } catch (dbError) {
        console.error('Failed to update video status to FAILED:', dbError);
      }
    }
    return NextResponse.json({ error: error.message || 'Video analysis failed' }, { status: 500 });
  }
}
