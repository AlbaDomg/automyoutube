import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { verifyAppAuth } from '@/lib/auth';

async function callGeminiWithRetry(fn, maxRetries = 1, delayMs = 1000) {
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
      console.warn(`[Gemini API] Generate Emoji - Failed (Attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title, description } = await request.json();

    if (!title) {
      return NextResponse.json({ error: 'Falta el título para generar el emoji' }, { status: 400 });
    }

    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La API Key de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analiza el siguiente título y descripción de un vídeo y devuelve un único emoji adecuado que guarde una relación directa y clara con el contenido principal de la noticia o tema.

Título: ${title}
Descripción: ${description || ''}

REGLAS DE GENERACIÓN:
1. Debes responder EXCLUSIVAMENTE con un único emoji (por ejemplo: 🚗, 🚨, ⛈️, ⚽, ⛽, 🌊, 🏥).
2. NO devuelvas texto adicional, explicaciones, comillas ni espacios. Solo el carácter del emoji.
3. Si no encuentras un emoji idóneo, devuelve el emoji genérico 📺.

Responde exclusivamente con el emoji.
`;

    console.log(`[Generate Emoji API] Generating emoji for title: "${title.substring(0, 50)}"...`);
    let response;
    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      }));
    } catch (err) {
      const isTransient = err.message && (
        err.message.includes('429') ||
        err.message.includes('RESOURCE_EXHAUSTED') ||
        err.message.includes('quota') ||
        err.message.includes('Quota exceeded') ||
        err.message.includes('503') ||
        err.message.includes('UNAVAILABLE') ||
        err.message.includes('high demand') ||
        err.message.includes('overloaded')
      );

      if (isTransient) {
        console.warn('[Generate Emoji API] gemini-2.5-flash-lite no disponible, usando fallback gemini-flash-lite-latest...');
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        }));
      } else {
        throw err;
      }
    }

    const emoji = (response.text || '📺').trim();
    // Validar que sea un emoji de longitud corta para asegurarnos de que no haya texto residual
    const finalEmoji = emoji.length <= 10 ? emoji : '📺';

    return NextResponse.json({
      success: true,
      emoji: finalEmoji
    });

  } catch (error) {
    console.error('Error en API de generación de emoji:', error);
    return NextResponse.json({ error: error.message || 'Fallo al generar el emoji con Gemini' }, { status: 500 });
  }
}
