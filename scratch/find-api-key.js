const fs = require('fs');
const path = require('path');
const readline = require('readline');

const brainDir = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain';

async function searchLogFile(logPath) {
  if (!fs.existsSync(logPath)) {
    console.log(`Log file does not exist: ${logPath}`);
    return;
  }

  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      const str = JSON.stringify(obj);
      // Search for Gemini API Key pattern (starts with AIzaSy)
      const match = str.match(/AIzaSy[A-Za-z0-9_-]{35}/);
      if (match) {
        console.log(`FOUND KEY: ${match[0]} in ${logPath} at step ${obj.step_index || 'unknown'}`);
      }
    } catch (e) {
      // Ignore JSON parse errors
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
}

main().catch(console.error);
