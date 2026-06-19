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
      console.warn(`[Gemini API] Generate SEO Phrase - Failed (Attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delayMs}ms...`);
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
      return NextResponse.json({ error: 'Falta el título del video para generar la frase' }, { status: 400 });
    }

    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La API Key de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analiza el siguiente título y descripción de un vídeo de YouTube y genera una frase SEO de alto impacto en Gallego (Galician) para imprimir en la miniatura.

Título: ${title}
Descripción: ${description || ''}

REGLAS CRÍTICAS DE GENERACIÓN:
1. La frase debe tener EXACTAMENTE 4 palabras en Gallego. Ni más ni menos.
2. No debe ser una copia de las primeras palabras del título. Debe tener sentido lógico completo.
3. ESTRUCTURA: Imagina la frase dividida conceptualmente en un "título de 2 palabras" y un "subtítulo de 2 palabras" que tengan relación y coherencia entre sí (por ejemplo: "ALERTA MOS" + "EVITA PICADURAS", o "CONCURSO TVG" + "PREMIO FINAL", o "MANTER BATEAS" + "CONSELLO PRÁCTICO").
4. Las palabras deben estar muy optimizadas para capturar el interés de la audiencia gallega (SEO / CTR alto).
5. REGLA DE FORMATO ESTRICTO: La frase debe contener EXCLUSIVAMENTE las 4 palabras en gallego separadas por espacios. NO incluyas barras (/), guiones (-), comillas, ni ningún signo de puntuación en el texto.

Responde exclusivamente en formato JSON con la siguiente estructura exacta:
{
  "thumbnailText": "Frase de exactamente cuatro palabras en Gallego"
}
`;

    console.log(`[SEO Phrase API] Generating 4-word SEO phrase for title: "${title.substring(0, 50)}"...`);
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
        console.warn('[SEO Phrase API] gemini-2.5-flash-lite no disponible, usando fallback gemini-flash-lite-latest...');
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

    const finalThumbnailText = ensureFourWords(result.thumbnailText || '', title);

    return NextResponse.json({
      success: true,
      thumbnailText: finalThumbnailText
    });

  } catch (error) {
    console.error('Error en API de generación de frase SEO:', error);
    return NextResponse.json({ error: error.message || 'Fallo al generar la frase SEO con Gemini' }, { status: 500 });
  }
}

// Función helper para garantizar exactamente 4 palabras en el texto de la miniatura
function ensureFourWords(text, fallbackContext = "") {
  if (!text) text = "";
  // Limpiar caracteres especiales
  let cleanText = text.replace(/[\/\-\"\']/g, " ").replace(/\s+/g, " ").trim();
  let words = cleanText ? cleanText.split(/\s+/) : [];

  // Filtrar palabras vacías
  words = words.filter(w => w.trim().length > 0);

  if (words.length === 4) {
    return words.join(" ");
  }

  if (words.length > 4) {
    return words.slice(0, 4).join(" ");
  }

  // Si tiene menos de 4 palabras, autocompletar usando palabras significativas del contexto (título)
  const contextWords = fallbackContext
    ? fallbackContext.replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ").replace(/\s+/g, " ").trim().split(/\s+/)
    : [];

  // Filtrar palabras significativas que no estén ya en la frase
  const significantContextWords = contextWords.filter(w => w.length >= 3 && !words.map(x => x.toLowerCase()).includes(w.toLowerCase()));

  const defaultPool = ["ALERTA", "AVISO", "INFO", "GALEGO", "HOXE", "NOVA", "TVG"];

  for (const word of significantContextWords) {
    if (words.length >= 4) break;
    words.push(word);
  }

  for (const word of defaultPool) {
    if (words.length >= 4) break;
    if (!words.map(x => x.toLowerCase()).includes(word.toLowerCase())) {
      words.push(word);
    }
  }

  while (words.length < 4) {
    words.push("HOXE");
  }

  return words.slice(0, 4).join(" ");
}
