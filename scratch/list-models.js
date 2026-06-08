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

  console.log('Listing available models...');
  const response = await ai.models.list();
  
  console.log('--- Models Response ---');
  console.log(JSON.stringify(response, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
