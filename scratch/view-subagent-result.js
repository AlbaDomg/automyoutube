const fs = require('fs');

const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\1b2dd572-f9fb-41e0-87af-328994d06603\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log("No log file found.");
  process.exit();
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue;
  const obj = JSON.parse(lines[i]);
  if (obj.step_index === 99) {
    fs.writeFileSync('scratch/subagent-result-99.txt', obj.content);
    console.log("Wrote step 99 to scratch/subagent-result-99.txt");
  }
}
