import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { verifyAppAuth } from '@/lib/auth';
import mammoth from 'mammoth';

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
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'Por favor, selecciona un documento de referencia (PDF o Word).' }, { status: 400 });
    }

    const youtubeVideosRaw = formData.get('youtubeVideos');
    let youtubeVideos = [];
    if (youtubeVideosRaw) {
      try {
        youtubeVideos = JSON.parse(youtubeVideosRaw);
      } catch (e) {
        console.error('Error parsing youtubeVideos in api:', e);
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name.toLowerCase();
    const isDocx = fileName.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    let pdfBase64 = "";
    let docxText = "";

    if (isDocx) {
      console.log(`[Analyze File API] Extracting text from DOCX: ${file.name}...`);
      const result = await mammoth.extractRawText({ buffer });
      docxText = result.value;
      if (!docxText.trim()) {
        return NextResponse.json({ error: 'El archivo Word parece estar vacío o no contiene texto legible.' }, { status: 400 });
      }
    } else {
      console.log(`[Analyze File API] Preparing PDF file: ${file.name}...`);
      pdfBase64 = buffer.toString('base64');
    }

    // 3. Inicializar Gemini
    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La clave de API de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analiza el documento de referencia adjunto. Este documento contiene la planificación o tabla con los metadatos de los videos de redes para "Hora Galega" u otros programas.
Extrae la información de TODOS los vídeos que estén definidos y listados en la tabla o el texto del documento.

Para CADA vídeo detectado en el documento, extrae de forma EXACTA y LITERAL (copia y pega sin modificar, resumir, formatear ni optimizar):
1. El título del video (generalmente de una columna llamada 'Titular', 'Título', 'Tema' o similar).
2. La descripción del video (generalmente de una columna llamada 'Sinopse', 'Sinopsis', 'Descripción' o similar).

Además, genera usando IA para cada vídeo:
1. El nombre del programa de televisión al que corresponde el contenido (por ejemplo: "HORA GALEGA", "LUAR", "A COROA", "HOLA", etc.).
   - FUENTES DE INFORMACIÓN: Utiliza tanto el texto del documento (planilla) como la información del video coincidente de YouTube si está disponible.
   - PRIORIDAD DE DETECCIÓN (CRÍTICA):
     a) La prioridad número 1 es el contenido literal del documento (la planilla). Si el titular o la sinopsis de la planilla contienen palabras clave asociadas a un programa (por ejemplo, "Luar", "Hola", "A Coroa", "Hora Galega"), ese es el programa correcto.
     b) La prioridad número 2 es la información del vídeo coincidente de YouTube (su título y descripción). Puedes usarlo para identificar el programa (por ejemplo, si tiene un sufijo como "| LUAR" o un enlace como "tvg.gal/luar").
     c) REGLA DE CONFLICTO: Si hay un conflicto (por ejemplo, la planilla habla claramente del programa "HOLA", pero el vídeo coincidente de YouTube tiene el título con "| LUAR"), prevalece siempre la planilla (el programa es "HOLA"). No te dejes guiar por sufijos obsoletos de YouTube si el texto del documento indica otra cosa.
     d) Si no se puede identificar ningún programa a través de la planilla ni de YouTube, asume "HORA GALEGA" como valor por defecto.
   - Devuélvelo en el campo "programName" en MAYÚSCULAS.
2. Una frase SEO de alto impacto de exactamente 4 palabras en Gallego (Galician) para imprimir en la miniatura, basada en el tema de ese video.
   - REGLA CRÍTICA: NO debes copiar simplemente las primeras 4 palabras del título. Debe ser una frase creada con sentido lógico coherente completo.
   - ESTRUCTURA DE DISEÑO: Imagina la frase dividida conceptualmente en un "título de 2 palabras" y un "subtítulo de 2 palabras" que tengan relación y coherencia entre sí (por ejemplo: "ALERTA MOS" + "EVITA PICADURAS", o "CONCURSO TVG" + "PREMIO FINAL", o "MANTER BATEAS" + "CONSELLO PRÁCTICO").
   - Las palabras deben estar muy optimizadas para capturar el interés (SEO / CTR alto).
   - REGLA DE FORMATO ESTRICTO: La frase debe contener EXCLUSIVAMENTE las 4 palabras en gallego separadas por espacios. NO incluyas barras (/), guiones (-), comillas, ni ningún signo de puntuación en el texto.

${youtubeVideos && youtubeVideos.length > 0 
  ? `Se te proporciona la lista de vídeos en estado privado u oculto actualmente subidos al canal de YouTube (cada uno tiene su 'id', 'title' y 'description'):
${JSON.stringify(youtubeVideos.map(v => ({ id: v.id, title: v.title, description: v.description })))}

Analiza semánticamente el contenido y temática de cada uno de los vídeos que extraigas del documento de la planilla y compáralo con esta lista de YouTube.
Si encuentras una correspondencia clara (por palabras clave, temática similar o título equivalente), asocia el campo "matchedVideoId" de ese vídeo con el "id" del vídeo de YouTube correspondiente de la lista.
Si no encuentras una correspondencia clara y lógica (o la lista no tiene relación alguna con el tema de la planilla), deja "matchedVideoId" como una cadena vacía "".`
  : 'Deja el campo "matchedVideoId" como una cadena vacía "" para todos los vídeos.'
}

Responde obligatoriamente en formato JSON con la siguiente estructura exacta:
{
  "videos": [
    {
      "index": 1,
      "title": "Título o titular literal extraído",
      "description": "Sinopsis o sinopse literal extraído",
      "thumbnailText": "Frase de cuatro palabras en Gallego",
      "matchedVideoId": "id_del_video_coincidente_o_vacio",
      "programName": "NOMBRE_DEL_PROGRAMA_EN_MAYUSCULAS"
    }
  ]
}
`;

    console.log(`[Analyze File API] Sending document to Gemini to parse videos...`);
    let response;
    
    // Preparar el contenido a enviar según el tipo de archivo
    const geminiContents = [
      {
        role: 'user',
        parts: isDocx 
          ? [
              { text: `Aquí está el texto extraído del documento de Word de referencia:\n\n${docxText}` },
              { text: prompt }
            ]
          : [
              {
                inlineData: {
                  data: pdfBase64,
                  mimeType: 'application/pdf'
                }
              },
              { text: prompt }
            ]
      }
    ];

    try {
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: geminiContents,
        config: {
          responseMimeType: 'application/json',
        }
      }));
    } catch (err) {
      console.warn(`[Gemini API] Falló gemini-2.5-flash: ${err.message}. Intentando con gemini-1.5-flash como fallback...`);
      try {
        response = await callGeminiWithRetry(() => ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: geminiContents,
          config: {
            responseMimeType: 'application/json',
          }
        }));
      } catch (fallbackErr) {
        console.error('[Gemini API] Falló también el modelo de fallback gemini-1.5-flash:', fallbackErr.message);
        throw err;
      }
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(response.text);
    } catch (parseError) {
      console.error('Fallo al parsear respuesta JSON de Gemini. Texto bruto:', response.text);
      return NextResponse.json({ error: 'Gemini no devolvió una estructura JSON válida' }, { status: 500 });
    }

    if (!parsedResult.videos || !Array.isArray(parsedResult.videos)) {
      return NextResponse.json({ error: 'El documento no contiene videos con el formato esperado.' }, { status: 400 });
    }

    // Añadir el bloque social por defecto a la descripción de cada video
    const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/horagalega\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;

    const processedVideos = parsedResult.videos.map(v => {
      const baseDesc = v.description || '';
      
      // Personalizar el enlace del programa en el bloque social
      let programUrlSlug = 'horagalega';
      if (v.programName && v.programName.trim()) {
        const cleanedSlug = v.programName.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
        if (cleanedSlug) {
          programUrlSlug = cleanedSlug;
        }
      }
      
      const customSocialBlock = `\n\nPodes ver o programa completo en tvg.gal/${programUrlSlug}\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;
      const finalDesc = baseDesc.trim() ? `${baseDesc.trim()}${customSocialBlock}` : customSocialBlock.trim();
      
      // Asegurarse de que el título tenga el formato "Título | NOMBRE_DEL_PROGRAMA"
      let finalTitle = (v.title || '').trim();
      if (v.programName && v.programName.trim()) {
        const progUpper = v.programName.toUpperCase().trim();
        const suffix = `| ${progUpper}`;
        // Si no termina con la barra y el programa, lo añadimos
        if (!finalTitle.toUpperCase().endsWith(suffix.toUpperCase())) {
          if (finalTitle.endsWith('|')) {
            finalTitle = `${finalTitle} ${progUpper}`;
          } else {
            finalTitle = `${finalTitle} | ${progUpper}`;
          }
        }
      }

      return {
        index: v.index,
        title: finalTitle,
        description: finalDesc,
        thumbnailText: v.thumbnailText || '',
        matchedVideoId: v.matchedVideoId || '',
        programName: v.programName || ''
      };
    });

    return NextResponse.json({
      success: true,
      videos: processedVideos,
      fileName: file.name
    });

  } catch (error) {
    console.error('Error en API de análisis del archivo:', error);
    return NextResponse.json({ error: error.message || 'Fallo al analizar el archivo con Gemini' }, { status: 500 });
  }
}
