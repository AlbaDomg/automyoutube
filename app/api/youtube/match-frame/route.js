import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { verifyAppAuth } from '@/lib/auth';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { frameBase64, videos } = await request.json();

    if (!frameBase64) {
      return NextResponse.json({ error: 'Falta la imagen del fotograma en Base64.' }, { status: 400 });
    }

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      return NextResponse.json({ error: 'Falta la lista de vídeos candidatos para emparejar.' }, { status: 400 });
    }

    // 1. Inicializar Gemini
    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'La clave de API de Gemini no está configurada.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    // 2. Prompt para el análisis visual
    const prompt = `
Analyze the provided video frame.
Your task is to identify which video from the provided list of candidate videos (from a television program escaleta) matches this scene/frame.

Here is the list of candidate videos:
${JSON.stringify(videos.map(v => ({ index: v.index, title: v.title, description: v.description, programName: v.programName })))}

Use visual cues in the frame:
- Look for on-screen text overlays (rótulos, banners, title cards).
- Look at the presenter or guest faces/identities.
- Look at the scenery, colors, logos, or studio setting.
Match these visual elements against the candidate titles and descriptions.

Respond strictly in JSON format with the index of the matching video.
If you cannot identify any match with high confidence, return null for matchedIndex.

Response format:
{
  "matchedIndex": 3
}
`;

    // Limpiar el base64 si contiene el prefijo "data:image/jpeg;base64,"
    const cleanBase64 = frameBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: 'image/jpeg'
              }
            },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
      }
    });

    let result;
    try {
      result = JSON.parse(response.text);
    } catch (e) {
      console.error('[Match Frame API] Error parsing Gemini JSON response:', response.text);
      return NextResponse.json({ error: 'Gemini no devolvió una estructura JSON válida.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      matchedIndex: result.matchedIndex !== undefined ? result.matchedIndex : null
    });

  } catch (error) {
    console.error('Error en API de emparejamiento visual de fotograma:', error);
    return NextResponse.json({ error: error.message || 'Fallo al emparejar fotograma con Gemini.' }, { status: 500 });
  }
}
