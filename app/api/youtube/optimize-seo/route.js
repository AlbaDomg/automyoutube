import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { verifyAppAuth } from '@/lib/auth';

// Helper with retries and exponential backoff
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
      console.warn(`[Gemini API] Optimize SEO - Failed (Attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delayMs}ms...`);
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

    const { text, field } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Falta el texto a optimizar' }, { status: 400 });
    }

    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La API Key de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const isTitle = field === 'title';
    const language = 'Galician'; // Forzado a gallego

    const prompt = isTitle
      ? `
Analiza el siguiente título de un vídeo de YouTube y optimízalo para mejorar el CTR y el SEO.
CRITICAL: Debes generar el título estrictamente en Gallego (${language}). No uses Español ni Inglés.

Título original: ${text}

REGLAS:
1. El título debe ser atractivo, generar curiosidad o urgencia y contener palabras clave relevantes.
2. Debe tener MENOS de 100 caracteres de longitud (límite estricto de la API de YouTube).
3. No uses signos de puntuación extraños ni comillas alrededor del título.
4. Responde en formato JSON con la siguiente estructura:
{
  "optimizedText": "Tu título optimizado aquí"
}
`
      : `
Analiza la siguiente descripción de un vídeo de YouTube y optimízala para mejorar el SEO y el CTR.
CRITICAL: Debes generar la descripción estrictamente en Gallego (${language}). No uses Español ni Inglés.

Descripción original: ${text}

REGLAS:
1. La descripción debe resumir los temas clave del vídeo de forma muy directa, concisa y escueta.
2. Genera todo el contenido en un único párrafo continuo y fluido, sin saltos de línea (\n) de ningún tipo.
3. No incluyas bloques de redes sociales, firmas genéricas ni hashtags (símbolos #), solo el cuerpo de la descripción optimizada.
4. Responde en formato JSON con la siguiente estructura:
{
  "optimizedText": "Tu descripción optimizada aquí"
}
`;

    console.log(`[Optimize SEO API] Optimizing ${field} for text: "${text.substring(0, 50)}"...`);
    let response;
    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json' }
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
        console.warn('[Optimize SEO API] gemini-2.5-flash-lite no disponible, usando fallback gemini-flash-lite-latest...');
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' }
        }));
      } else {
        throw err;
      }
    }

    let result;
    try {
      result = JSON.parse(response.text);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON. Raw text:', response.text);
      throw new Error('Gemini no devolvió una estructura JSON válida');
    }

    let optimizedText = result.optimizedText || text;
    if (optimizedText && field === 'description') {
      // Eliminar hashtags del texto
      optimizedText = optimizedText.replace(/#[a-zA-Z0-9_À-ÿ-]+/g, '');
      // Reemplazar todos los saltos de línea por un espacio para forzar un único párrafo de líneas completas
      optimizedText = optimizedText.replace(/\r?\n/g, ' ');
      // Limpiar espacios múltiples o innecesarios
      optimizedText = optimizedText.replace(/\s+/g, ' ');
      optimizedText = optimizedText.trim();
    }

    return NextResponse.json({
      success: true,
      optimizedText: optimizedText
    });

  } catch (error) {
    console.error('Error en API de optimización SEO:', error);
    return NextResponse.json({ error: error.message || 'Fallo al optimizar el texto con Gemini' }, { status: 500 });
  }
}
