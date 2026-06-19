const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GEMINI_API_KEY' }
  });
  if (!config) {
    console.error("GEMINI_API_KEY not found in DB.");
    return;
  }
  const apiKey = config.value;
  console.log("Found Gemini API Key:", apiKey.substring(0, 8) + "...");

  console.log("Listing models via API...");
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  try {
    const res = await fetch(url);
    console.log(`HTTP Status: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models.map(m => m.name);
      console.log("Available models:", JSON.stringify(models, null, 2));
    } else {
      const errText = await res.text();
      console.error("Error text:", errText);
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
