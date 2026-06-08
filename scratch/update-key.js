const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const newKey = 'YOUR_GEMINI_API_KEY';
  
  const updated = await prisma.systemConfig.upsert({
    where: { key: 'GEMINI_API_KEY' },
    update: { value: newKey },
    create: { key: 'GEMINI_API_KEY', value: newKey }
  });
  
  console.log('Database updated successfully with new Gemini API Key:', updated.value);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
