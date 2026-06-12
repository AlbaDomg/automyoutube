const { GoogleGenAI } = require('@google/genai');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function main() {
  const prisma = new PrismaClient();
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GEMINI_API_KEY' }
  });
  
  if (!config) {
    console.log("No Gemini API key found in DB.");
    process.exit();
  }

  const ai = new GoogleGenAI({ apiKey: config.value });
  const pdfPath = 'uploads/reference_doc.pdf';
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        },
        { text: "Por favor, extrae y transcribe todo el texto de este PDF de forma literal, página por página." }
      ]
    });
    console.log("PDF TEXT:\n", response.text);
  } catch (err) {
    console.error("Gemini failed, trying gemini-flash-latest fallback...");
    response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [
        {
          inlineData: {
            data: pdfBase64,
            mimeType: 'application/pdf'
          }
        },
        { text: "Por favor, extrae y transcribe todo el texto de este PDF de forma literal, página por página." }
      ]
    });
    console.log("PDF TEXT:\n", response.text);
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
