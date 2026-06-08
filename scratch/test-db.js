const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Fetching existing videos from SQLite dev.db...');
    const videos = await prisma.video.findMany({ take: 3 });
    console.log('Videos retrieved successfully:', videos);
    
    console.log('\nTesting Video creation with default values...');
    const testVideo = await prisma.video.create({
      data: {
        id: 'test-uuid-' + Date.now(),
        filename: 'test-file.mp4',
        filePath: 'uploads/test-file.mp4',
        status: 'READY'
      }
    });
    console.log('Test video created successfully:', testVideo);
    
    console.log('\nCleaning up test video...');
    await prisma.video.delete({
      where: { id: testVideo.id }
    });
    console.log('Test video deleted successfully.');
    
    console.log('\nAll database checks passed!');
  } catch (err) {
    console.error('\nDatabase error occurred:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
