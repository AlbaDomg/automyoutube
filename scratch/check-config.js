const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const configs = await prisma.systemConfig.findMany();
  console.log('SystemConfig rows in DB:', JSON.stringify(configs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
