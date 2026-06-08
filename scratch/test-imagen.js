const { GoogleGenAI } = require('@google/genai');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GEMINI_API_KEY' }
  });
  if (!config) {
    console.error('No API key found in DB');
    return;
  }

  const ai = new GoogleGenAI({ apiKey: config.value });

  console.log('Testing Imagen 4.0 generation...');
  const response = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: 'A high-contrast cinematic YouTube thumbnail showing technology automation, professional design, tech background',
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',
    },
  });

  console.log('Image generated successfully! Number of images:', response.generatedImages?.length);
  if (response.generatedImages && response.generatedImages.length > 0) {
    const bytes = response.generatedImages[0].image.imageBytes;
    console.log('Image bytes (base64):', bytes.substring(0, 100) + '...');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
