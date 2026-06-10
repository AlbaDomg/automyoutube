const { PrismaClient } = require('@prisma/client');
const { GoogleGenAI } = require('@google/genai');
const prisma = new PrismaClient();

async function main() {
  try {
    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      console.error('No connected channel found in database.');
      return;
    }

    const key = await prisma.systemConfig.findUnique({ where: { key: 'GEMINI_API_KEY' } });
    if (!key || !key.value) {
      console.error('No GEMINI_API_KEY found in database.');
      return;
    }

    console.log(`Using channel: ${channel.title}`);
    console.log(`Using API key: ${key.value.substring(0, 5)}...`);

    const ai = new GoogleGenAI({ apiKey: key.value });

    const currentTitle = "Niño grande en carrito de bebé: ¡Una situación hilarante!";
    const currentDescription = "¡Prepárense para una escena que les sacará una carcajada! 😂 En este divertido video...";
    const currentTags = "HumorFamiliar, NiñosGraciosos, MaternidadReal";

    const prompt = `
Analyze the following metadata of an existing YouTube video and optimize it for a professional, high-CTR, and SEO-optimized YouTube upload in the following language: Spanish.

Current Title: ${currentTitle}
Current Description: ${currentDescription}
Current Tags: ${currentTags}

Generate the following:
1. Three options for an attractive title (optimized for high CTR and SEO) in Spanish. CRITICAL: Each title option MUST be under 100 characters in length (YouTube API limit).
2. An engaging description (including key topics, call to action, and placeholder timestamps if applicable) in Spanish.
3. Relevant hashtags (all starting with the '#' symbol, e.g. ["#keyword1", "#keyword2"]) in Spanish.

Respond in JSON format with the following keys:
{
  "titles": ["Title 1", "Title 2", "Title 3"],
  "description": "Suggested description...",
  "tags": ["#tag1", "#tag2", "#tag3"]
}
`;

    console.log("Calling Gemini model...");
    const response = await ai.models.generateContent({
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
    });

    console.log("Raw Response text:");
    console.log(response.text);

    const parsed = JSON.parse(response.text);
    console.log("Parsed suggestions:", JSON.stringify(parsed, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
