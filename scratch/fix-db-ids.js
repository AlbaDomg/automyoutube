const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function cleanYoutubeId(id) {
  if (!id) return "";
  const match = id.trim().match(/^([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : id.trim();
}

async function main() {
  try {
    const tasks = await prisma.videoTask.findMany();
    for (const task of tasks) {
      const cleanId = cleanYoutubeId(task.youtubeId);
      if (cleanId !== task.youtubeId) {
        console.log(`Updating VideoTask ${task.id}: ${task.youtubeId} -> ${cleanId}`);
        const existing = await prisma.videoTask.findUnique({
          where: { youtubeId: cleanId }
        });
        if (existing) {
          console.log(`Task with cleanId ${cleanId} already exists! Deleting the duplicate task with bad ID.`);
          await prisma.videoTask.delete({
            where: { id: task.id }
          });
        } else {
          await prisma.videoTask.update({
            where: { id: task.id },
            data: { youtubeId: cleanId }
          });
          console.log(`Update successful!`);
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
