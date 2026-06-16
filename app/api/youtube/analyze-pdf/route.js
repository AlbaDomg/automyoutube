import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { verifyAppAuth } from '@/lib/auth';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

function slugify(text) {
  if (!text) return "";
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function detectProgramLocally(title, description, fileName, availableLogos) {
  // 1. Intentar detectar desde el nombre del archivo original (Opción A)
  if (fileName && availableLogos) {
    const cleanFileName = fileName.toLowerCase().replace(/\.[^/.]+$/, "");
    const slugFile = slugify(cleanFileName);
    const fileParts = cleanFileName.split(/[^a-z0-9]/i);
    
    const abbreviations = {
      "hg": "horagalega"
    };

    // Buscar coincidencia por abreviación
    for (const part of fileParts) {
      if (abbreviations[part]) {
        const targetSlug = abbreviations[part];
        const found = availableLogos.find(logo => slugify(logo.replace(/\.[^/.]+$/, "")) === targetSlug);
        if (found) return found;
      }
    }

    // Buscar coincidencia de nombre completo del programa contenido en el archivo
    const sortedLogos = [...availableLogos].sort((a, b) => b.length - a.length);
    for (const logo of sortedLogos) {
      const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
      const slugLogo = slugify(cleanLogoName);
      if (slugLogo.length > 2 && slugFile.includes(slugLogo)) {
        return logo;
      }
    }
  }

  // 2. Intentar detectar desde el sufijo del título (ej. "| HORA GALEGA")
  let detectedProg = "";
  const suffixMatch = (title || "").match(/\|\s*([a-zA-Z0-9_\sÀ-ÿ\-]+)$/);
  if (suffixMatch) {
    detectedProg = suffixMatch[1].toUpperCase().trim();
  } else {
    // 3. Intentar detectar desde el enlace de la descripción (ej. tvg.gal/luar)
    const descMatch = (description || "").match(/tvg\.gal\/([a-z0-9]+)/i);
    if (descMatch) {
      detectedProg = descMatch[1].toUpperCase();
    }
  }

  if (detectedProg && availableLogos) {
    const found = availableLogos.find(logo => {
      const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
      const slugLogo = slugify(cleanLogoName);
      const slugProg = slugify(detectedProg);
      return (
        cleanLogoName === detectedProg ||
        slugLogo === slugProg ||
        (slugLogo.length > 3 && slugProg.includes(slugLogo)) ||
        (slugProg.length > 3 && slugLogo.includes(slugProg))
      );
    });
    if (found) return found;
  }
  return null;
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

    // Cargar catálogo de logotipos disponibles en el backend (desde la base de datos)
    let availableLogos = [];
    try {
      const dbLogos = await prisma.programLogo.findMany({
        select: { name: true }
      });
      availableLogos = dbLogos.map(l => l.name);

      // Si por alguna razón la BD está vacía, hacer una lectura rápida del directorio estático
      if (availableLogos.length === 0) {
        const STATIC_LOGOS_DIR = path.join(process.cwd(), "public", "static_program_logos");
        if (fs.existsSync(STATIC_LOGOS_DIR)) {
          const files = fs.readdirSync(STATIC_LOGOS_DIR);
          const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
          availableLogos = files.filter(file => 
            imageExtensions.includes(path.extname(file).toLowerCase())
          );
        }
      }
    } catch (dbErr) {
      console.warn("[Analyze PDF] Error reading program logos catalog from DB:", dbErr.message);
    }

    // Detectar programa para vídeos de YouTube
    let annotatedYoutubeVideos = [];
    let quotaExceeded = false;

    if (youtubeVideos && youtubeVideos.length > 0) {
      console.log(`[Analyze PDF] Processing ${youtubeVideos.length} YouTube videos for program detection...`);
      for (const video of youtubeVideos) {
        let programLogoName = detectProgramLocally(video.title, video.description, video.fileName, availableLogos);
        
        // Si no se puede detectar por texto localmente, analizar visualmente su miniatura (si la cuota no se ha excedido)
        if (!programLogoName && video.id && !quotaExceeded) {
          console.log(`[Analyze PDF] Video ${video.id} has generic text metadata. Attempting visual analysis of default thumbnail...`);
          try {
            const thumbnailUrl = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
            const imageResponse = await fetch(thumbnailUrl);
            if (imageResponse.ok) {
              const arrayBufferImage = await imageResponse.arrayBuffer();
              const imageBase64 = Buffer.from(arrayBufferImage).toString('base64');
              
              const detectPrompt = `
Analyze the provided YouTube video thumbnail frame.
Your task is to identify which television program this frame/scene belongs to.
The possible program names/logos are:
${JSON.stringify(availableLogos.map(l => l.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase()))}

Identify the program by looking at screen logos/watermarks (usually in corners), watermarks in video scenes, graphic style, or overlay texts.
Respond strictly in JSON format with the matching program name from the list above, in uppercase.
If you cannot identify any of the matching programs from the list, respond "NONE".

Response format:
{
  "detectedProgram": "PROGRAM_NAME_OR_NONE"
}
`;
              // Llamada directa sin reintentos largos para prevenir timeouts de pasarela en Vercel
              const visionResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        inlineData: {
                          data: imageBase64,
                          mimeType: 'image/jpeg'
                        }
                      },
                      { text: detectPrompt }
                    ]
                  }
                ],
                config: {
                  responseMimeType: 'application/json',
                }
              });
              
              const visionResult = JSON.parse(visionResponse.text);
              const detected = visionResult.detectedProgram ? visionResult.detectedProgram.toUpperCase().trim() : "NONE";
              if (detected && detected !== "NONE") {
                const foundLogo = availableLogos.find(logo => {
                  const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
                  return cleanLogoName === detected || slugify(cleanLogoName) === slugify(detected);
                });
                if (foundLogo) {
                  programLogoName = foundLogo;
                }
              }
              console.log(`[Analyze PDF] Visual detection result for video ${video.id}: ${programLogoName || "NONE"}`);
            } else {
              console.warn(`[Analyze PDF] Failed to fetch thumbnail for video ${video.id} (HTTP status: ${imageResponse.status})`);
            }
          } catch (visionErr) {
            console.warn(`[Analyze PDF] Visual program detection failed for video ${video.id}:`, visionErr.message);
            // Si el fallo es de cuota/rate limit (429), activamos la bandera para omitir las siguientes miniaturas
            const isQuotaErr = visionErr.message && (
              visionErr.message.includes('429') ||
              visionErr.message.includes('RESOURCE_EXHAUSTED') ||
              visionErr.message.includes('quota') ||
              visionErr.message.includes('Quota exceeded')
            );
            if (isQuotaErr) {
              console.warn(`[Analyze PDF] Quota exceeded during visual detection. Skipping subsequent video thumbnail analyses to preserve main call...`);
              quotaExceeded = true;
            }
          }
        }
        
        annotatedYoutubeVideos.push({
          id: video.id,
          title: video.title,
          description: video.description,
          fileName: video.fileName || '',
          detectedProgramLogo: programLogoName || "none",
          detectedProgramName: programLogoName && programLogoName !== "none" 
            ? programLogoName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase().trim()
            : "NONE"
        });
      }
    }

    const cleanProgramNames = availableLogos.map(l => l.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase().trim());

    const prompt = `
Analiza el documento de referencia adjunto. Este documento contiene la planificación o tabla con los metadatos de los videos de redes sociales/YouTube de uno o varios programas de televisión.
El nombre del archivo de este documento subido es: "${file.name}".
Los nombres de programas/logotipos válidos registrados en el sistema son: ${JSON.stringify(cleanProgramNames)}.

Extrae la información de los vídeos que estén definidos y listados en la tabla o el texto del documento.

REGLA CRÍTICA DE FILTRADO (MUY IMPORTANTE): Debes ignorar por completo cualquier fila, celda o sección de vídeo que esté vacía o que sirva como plantilla sin contenido real (por ejemplo, si el documento tiene una fila llamada 'Vídeo 4' o 'Vídeo 5' pero no contiene un título ni una descripción redactados en sus celdas correspondientes). Únicamente debes extraer y devolver los vídeos que tengan un título y una descripción/sinopsis reales y definidos en el documento.

Para CADA vídeo válido detectado en el documento, extrae de forma EXACTA y LITERAL (copia y pega sin modificar, resumir, formatear ni optimizar):
1. El título del video (generalmente de una columna llamada 'Titular', 'Título', 'Tema' o similar).
2. La descripción del video (generalmente de una columna llamada 'Sinopse', 'Sinopsis', 'Descripción' o similar).

Además, genera usando IA para cada vídeo:
1. El nombre del programa de televisión al que corresponde el contenido de la lista de programas válidos.
   - FUENTES DE INFORMACIÓN: Utiliza tanto el texto del documento (planilla) como el nombre del archivo del documento "${file.name}" y la información del video coincidente de YouTube si está disponible.
   - PRIORIDAD DE DETECCIÓN (CRÍTICA):
     a) La prioridad número 1 es el contenido literal del documento (la planilla). Si el titular o la sinopsis de la planilla contienen palabras clave asociadas a un programa (por ejemplo, "Luar", "Hola", "A Coroa", "Hora Galega"), ese es el programa correcto.
     b) La prioridad número 2 es el nombre del archivo del documento ("${file.name}"). Si el nombre del archivo contiene indicios claros o el nombre de alguno de los programas registrados (ej. si se llama "Luar_12_05.pdf" o contiene "LUAR", "HG", "Hora_Galega", etc.), asócialo como el programa de los vídeos que no especifiquen otro dentro del texto.
     c) La prioridad número 3 es la información del vídeo coincidente de YouTube (su título, descripción o detectedProgramName). Puedes usarlo para identificar el programa (por ejemplo, si tiene un sufijo como "| LUAR" o un enlace como "tvg.gal/luar").
     d) REGLA DE CONFLICTO: Si hay un conflicto (por ejemplo, el nombre del archivo o la planilla indica claramente el programa "HOLA", pero el vídeo coincidente de YouTube tiene el título con "| LUAR"), prevalece siempre el documento / nombre de archivo (el programa es "HOLA"). No te dejes guiar por sufijos obsoletos de YouTube si el documento indica otra cosa.
     e) Si no se puede identificar ningún programa por ninguna vía, devuelve el campo "programName" como una cadena vacía "". NO inventes un nombre de programa.
   - Devuélvelo en el campo "programName" en MAYÚSCULAS y exactamente como figura en el catálogo de programas válidos si coincide.
2. Una frase SEO de alto impacto de exactamente 4 palabras en Gallego (Galician) para imprimir en la miniatura, basada en el tema de ese video.
   - REGLA CRÍTICA: NO debes copiar simplemente las primeras 4 palabras del título. Debe ser una frase creada con sentido lógico coherente completo.
   - ESTRUCTURA DE DISEÑO: Imagina la frase dividida conceptualmente en un "título de 2 palabras" y un "subtítulo de 2 palabras" que tengan relación y coherencia entre sí (por ejemplo: "ALERTA MOS" + "EVITA PICADURAS", o "CONCURSO TVG" + "PREMIO FINAL", o "MANTER BATEAS" + "CONSELLO PRÁCTICO").
   - Las palabras deben estar muy optimizadas para capturar el interés (SEO / CTR alto).
   - REGLA DE FORMATO ESTRICTO: La frase debe contener EXCLUSIVAMENTE las 4 palabras en gallego separadas por espacios. NO incluyas barras (/), guiones (-), comillas, ni ningún signo de puntuación en el texto.

${annotatedYoutubeVideos && annotatedYoutubeVideos.length > 0 
  ? `Se te proporciona la lista de vídeos en estado privado u oculto actualmente subidos al canal de YouTube (cada uno tiene su 'id', 'title', 'description', 'fileName' (nombre original de archivo subido), 'detectedProgramLogo' y 'detectedProgramName'):
${JSON.stringify(annotatedYoutubeVideos)}

Analiza semánticamente el contenido y temática de cada uno de los vídeos que extraigas del documento de la planilla y compáralo con esta lista de YouTube.
REGLAS DE VINCULACIÓN:
1. Si encuentras una correspondencia clara por título o descripción, asocia el campo "matchedVideoId" de ese vídeo con el "id" del vídeo de YouTube correspondiente de la lista.
2. Si un vídeo de YouTube tiene un título o descripción genérica que no aporta coincidencia textual directa (por ejemplo, 'MVI_1234.MP4', 'Video_1.mp4' o la fecha), pero su nombre de archivo de origen ('fileName') coincide semánticamente con el tema o titular del vídeo del documento (por ejemplo, habla de la misma entrevista, concurso o tema), asocia su "matchedVideoId" con el "id" de ese vídeo de YouTube correspondientemente.
3. Si el programa del vídeo de la planilla (programName) coincide con el del vídeo de YouTube (detectedProgramName), y no hay otros vídeos de YouTube que encajen mejor, utilízalo como criterio para asociar su "matchedVideoId" con el "id" de ese vídeo.
4. Si no encuentras ninguna correspondencia lógica, deja "matchedVideoId" como una cadena vacía "".`
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



    const processedVideos = parsedResult.videos.map(v => {
      const baseDesc = v.description || '';
      
      // Personalizar el enlace del programa en el bloque social (solo si se detectó un programa)
      let programUrlSlug = '';
      if (v.programName && v.programName.trim()) {
        const cleanedSlug = v.programName.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
        if (cleanedSlug) {
          programUrlSlug = cleanedSlug;
        }
      }
      
      let finalDesc = baseDesc.trim();
      if (programUrlSlug) {
        const customSocialBlock = `\n\nPodes ver o programa completo en tvg.gal/${programUrlSlug}\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;
        if (finalDesc) {
          if (finalDesc.includes("seguirnos en todas as nosas redes sociais") || finalDesc.includes("tvg.gal/")) {
            const urlRegex = /tvg\.gal\/[a-z0-9]+/gi;
            if (urlRegex.test(finalDesc)) {
              finalDesc = finalDesc.replace(urlRegex, `tvg.gal/${programUrlSlug}`);
            }
          } else {
            finalDesc = finalDesc + customSocialBlock;
          }
        } else {
          finalDesc = customSocialBlock.trim();
        }
      }
      
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
