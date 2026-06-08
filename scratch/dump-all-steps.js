const fs = require('fs');

const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\1b2dd572-f9fb-41e0-87af-328994d06603\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log("No log file found.");
  process.exit();
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
console.log(`Total lines: ${lines.length}`);
for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue;
  const obj = JSON.parse(lines[i]);
  console.log(`Line ${i}: Step ${obj.step_index}, Source ${obj.source}, Type ${obj.type}`);
  if (obj.type === 'tool_response' && typeof obj.content === 'string' && obj.content.length > 0) {
    console.log(`  Content: ${obj.content.substring(0, 150)}...`);
  }
}
