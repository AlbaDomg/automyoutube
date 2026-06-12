import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
import { verifyAppAuth } from '@/lib/auth';

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
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { youtubeVideoId } = await request.json();
    const language = 'Galician'; // Forzado a gallego siempre

    if (!youtubeVideoId) {
      return NextResponse.json({ error: 'Missing youtubeVideoId parameter' }, { status: 400 });
    }

    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refresh token if needed
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
        console.error('Error refreshing token in optimize api:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // Fetch video details from YouTube
    const videoRes = await youtube.videos.list({
      part: 'snippet',
      id: youtubeVideoId
    });

    if (!videoRes.data.items || videoRes.data.items.length === 0) {
      return NextResponse.json({ error: 'Video not found on YouTube' }, { status: 404 });
    }

    const videoItem = videoRes.data.items[0];
    const currentTitle = videoItem.snippet.title;
    const currentDescription = videoItem.snippet.description;
    const currentTags = videoItem.snippet.tags ? videoItem.snippet.tags.join(', ') : '';

    // Initialize Gemini
    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analyze the following metadata of an existing YouTube video and optimize it for a professional, high-CTR, and SEO-optimized YouTube upload in the following language: ${language}. CRITICAL: You MUST generate all title options, the description, hashtags, and SEO tags strictly in ${language}. Do not use Spanish or English.

Current Title: ${currentTitle}
Current Description: ${currentDescription}
Current Tags: ${currentTags}

Generate the following:
1. Three options for an attractive title (optimized for high CTR and SEO) in ${language}. CRITICAL: Each title option MUST be under 100 characters in length (YouTube API limit).
2. An engaging description (including key topics, call to action, and placeholder timestamps if applicable) in ${language}.
3. Relevant hashtags (all starting with the '#' symbol, e.g. ["#keyword1", "#keyword2"]) in ${language} to be appended to the video description.
4. A list of 10-15 highly relevant SEO tags/keywords (WITHOUT the '#' symbol, e.g. ["keyword1", "keyword2", "keyword3"]) in ${language} for the video tags field.
5. A high-impact SEO phrase of exactly 4 words in ${language} to print on the video thumbnail.

Respond in JSON format with the following keys:
{
  "titles": ["Title 1", "Title 2", "Title 3"],
  "description": "Suggested description...",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "tags": ["seo tag 1", "seo tag 2", "seo tag 3"],
  "thumbnailText": "Exactly four word phrase"
}
`;

    console.log(`[Optimize API] Generating optimization suggestions for video ${youtubeVideoId}...`);
    let response;
    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        }
      }));
    } catch (err) {
      // Si el modelo 2.5-flash ha agotado la cuota de la cuenta (429 / RESOURCE_EXHAUSTED),
      // intentamos usar gemini-flash-latest como fallback automático.
      const isQuotaExceeded = err.message && (
        err.message.includes('429') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('quota') ||
        err.message.includes('Quota exceeded')
      );

      if (isQuotaExceeded) {
        console.warn('[Gemini API] Límite de cuota excedido para gemini-2.5-flash. Intentando fallback con gemini-flash-latest...');
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
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
      console.error('Failed to parse Gemini response as JSON. Raw text:', response.text);
      throw new Error('Gemini did not return a valid JSON structure');
    }

    const suggestedDescription = metadata.description || '';
    const hashtagsString = metadata.hashtags && metadata.hashtags.length > 0
      ? '\n\n' + metadata.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
      : '';
    const finalDescription = suggestedDescription + hashtagsString;

    return NextResponse.json({
      success: true,
      current: {
        title: currentTitle,
        description: currentDescription,
        tags: currentTags
      },
      suggestions: {
        titles: metadata.titles || [currentTitle],
        description: finalDescription,
        tags: metadata.tags || [],
        thumbnailText: metadata.thumbnailText || ''
      }
    });

  } catch (error) {
    console.error('Error during video optimization:', error);
    return NextResponse.json({ error: error.message || 'Video optimization failed' }, { status: 500 });
  }
}
