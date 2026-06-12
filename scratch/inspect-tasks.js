const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- VideoTasks ---');
    const tasks = await prisma.videoTask.findMany();
    console.log(tasks);

    console.log('\n--- Videos ---');
    const videos = await prisma.video.findMany();
    console.log(videos);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
