const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const configs = await prisma.systemConfig.findMany();
  console.log('--- System Configs in Database ---');
  console.log(JSON.stringify(configs, null, 2));

  const channels = await prisma.channel.findMany();
  console.log('--- Channels in Database ---');
  console.log(JSON.stringify(channels, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
