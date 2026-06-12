const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Searching for task with youtubeId: 67ApefnIT70...');
    const task = await prisma.videoTask.findFirst({
      where: { youtubeId: '67ApefnIT70' }
    });

    if (task) {
      console.log('Found task to delete:', task);
      
      // Clean up associated scheduled video records first
      console.log('Checking for associated scheduled updates...');
      const deletedVideos = await prisma.video.deleteMany({
        where: {
          youtubeId: task.youtubeId,
          status: 'SCHEDULED',
          filePath: 'YOUTUBE_UPDATE'
        }
      });
      console.log('Deleted associated scheduled updates count:', deletedVideos.count);

      // Delete the task
      const deletedTask = await prisma.videoTask.delete({
        where: { id: task.id }
      });
      console.log('Successfully deleted task:', deletedTask);
    } else {
      console.log('No task found with youtubeId 67ApefnIT70');
    }
  } catch (err) {
    console.error('Error deleting task:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
