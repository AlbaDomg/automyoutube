// List all VideoTask entries using Prisma (CommonJS)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listTasks() {
  const tasks = await prisma.videoTask.findMany({ orderBy: { createdAt: 'desc' } });
  console.log('All VideoTasks:');
  console.log(JSON.stringify(tasks, null, 2));
}

listTasks()
  .catch(e => console.error('Error listing tasks:', e))
  .finally(() => prisma.$disconnect());
