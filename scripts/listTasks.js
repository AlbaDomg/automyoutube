// List all VideoTask entries using Prisma
import prisma from '@/lib/db';

async function main() {
  try {
    const tasks = await prisma.videoTask.findMany({ orderBy: { createdAt: 'desc' } });
    console.log(JSON.stringify(tasks, null, 2));
  } catch (e) {
    console.error('Error fetching tasks:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
