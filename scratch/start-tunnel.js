const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(1000);
    socket.once('error', onError);
    socket.once('timeout', onError);
    socket.connect(port, '127.0.0.1', () => {
      socket.end();
      resolve(true);
    });
  });
}

async function waitForPort(port) {
  while (!(await isPortOpen(port))) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function start() {
  const port = 3000;
  let devProcess = null;

  const portActive = await isPortOpen(port);
  if (!portActive) {
    console.log(`Port ${port} is not active. Starting Next.js dev server...`);
    // Spawn Next.js dev server and inherit stdio so user sees output
    devProcess = spawn('npm run dev', { shell: true, stdio: 'inherit' });
    
    // Ensure devProcess is killed if this process is terminated
    const cleanup = () => {
      if (devProcess) {
        console.log('\nStopping Next.js dev server...');
        devProcess.kill();
        devProcess = null;
      }
      process.exit();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    console.log('Waiting for Next.js to start on port 3000...');
    await waitForPort(port);
    console.log('Next.js dev server is ready!');
  } else {
    console.log(`Next.js dev server is already running on port ${port}.`);
  }

  console.log(`Starting Tunnelmole on port ${port}...`);
  
  // Spawn tunnelmole child process. Pass command as a single string to avoid DEP0190 deprecation warning
  const child = spawn(`npx tunnelmole ${port}`, { shell: true });

  child.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);

    // Find the https tunnelmole URL
    const match = output.match(/https:\/\/[a-z0-9-]+\.tunnelmole\.net/);
    if (match) {
      const url = match[0];
      console.log('====================================');
      console.log('Detected Tunnelmole URL:', url);
      console.log('====================================');
      
      const urlFilePath = path.join(__dirname, 'tunnel-url.txt');
      fs.writeFileSync(urlFilePath, url);
      console.log('Saved URL to:', urlFilePath);

      // Update database config dynamically
      prisma.systemConfig.upsert({
        where: { key: 'NEXT_PUBLIC_APP_URL' },
        update: { value: url },
        create: { key: 'NEXT_PUBLIC_APP_URL', value: url }
      })
      .then((config) => {
        console.log('Updated NEXT_PUBLIC_APP_URL in database to:', config.value);
      })
      .catch((err) => {
        console.error('Error updating NEXT_PUBLIC_APP_URL in database:', err);
      });
    }
  });

  child.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  child.on('close', (code) => {
    console.log(`Tunnelmole exited with code ${code}`);
    if (devProcess) {
      devProcess.kill();
    }
    prisma.$disconnect();
  });
}

start();

