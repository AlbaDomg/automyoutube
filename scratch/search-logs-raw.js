const fs = require('fs');
const path = require('path');
const readline = require('readline');

const brainDir = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain';

async function searchLogFile(logPath) {
  if (!fs.existsSync(logPath)) return;

  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('AIzaSy')) {
      console.log(`FOUND 'AIzaSy' in ${logPath}:`);
      console.log(line);
    }
  }
}

async function main() {
  const folders = fs.readdirSync(brainDir);
  for (const folder of folders) {
    const folderPath = path.join(brainDir, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      const logPath = path.join(folderPath, '.system_generated', 'logs', 'transcript.jsonl');
      await searchLogFile(logPath);
    }
  }
  console.log("Search complete.");
}

main().catch(console.error);
