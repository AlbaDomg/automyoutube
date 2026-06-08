const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'NEXT_PUBLIC_APP_URL' }
    });
    console.log('NEXT_PUBLIC_APP_URL in database:', config?.value);
  } catch (err) {
    console.error('Database query error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
