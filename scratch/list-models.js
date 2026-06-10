const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function run() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'GEMINI_API_KEY' }
    });

    const apiKey = config ? config.value : null;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      console.error('La clave API de Gemini no está configurada.');
      process.exit(1);
    }

    console.log('Consultando modelos a través de la API REST...');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const models = data.models || [];
    
    const names = models.map(m => m.name);
    console.log('Modelos encontrados:', names);

    // Escribir a un archivo
    const dest = path.join(__dirname, 'models.txt');
    fs.writeFileSync(dest, names.join('\n'));
    console.log('Modelos guardados en:', dest);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
