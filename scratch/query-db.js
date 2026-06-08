const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const channels = await prisma.channel.findMany();
  console.log("CHANNELS:", JSON.stringify(channels, null, 2));
  
  const videos = await prisma.video.findMany();
  console.log("VIDEOS:", JSON.stringify(videos, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
