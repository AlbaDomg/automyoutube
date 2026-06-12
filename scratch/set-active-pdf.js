const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Copy reference_doc.pdf to public/active_reference.pdf
    const sourcePath = path.join(__dirname, '..', 'uploads', 'reference_doc.pdf');
    const destPath = path.join(__dirname, '..', 'public', 'active_reference.pdf');
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`Copied ${sourcePath} to ${destPath}`);
    } else {
      console.error(`Source file not found at ${sourcePath}`);
    }

    // 2. Set ACTIVE_PDF_NAME in DB SystemConfig
    await prisma.systemConfig.upsert({
      where: { key: 'ACTIVE_PDF_NAME' },
      update: { value: 'reference_doc.pdf' },
      create: { key: 'ACTIVE_PDF_NAME', value: 'reference_doc.pdf' }
    });
    console.log('Saved ACTIVE_PDF_NAME: "reference_doc.pdf" to SQLite.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
