const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\1b2dd572-f9fb-41e0-87af-328994d06603\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log("No log file found.");
  process.exit();
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
console.log(`Total lines: ${lines.length}`);
for (let i = Math.max(0, lines.length - 20); i < lines.length; i++) {
  if (!lines[i]) continue;
  try {
    const parsed = JSON.parse(lines[i]);
    console.log(`Line ${i} (Step ${parsed.step_index}, Type ${parsed.type}):`);
    console.log(JSON.stringify(parsed).substring(0, 500));
  } catch (e) {
    console.log(`Line ${i} failed to parse:`, e.message);
  }
}
