const fs = require('fs');

const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\1b2dd572-f9fb-41e0-87af-328994d06603\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(logPath, 'utf8').split('\n');
const obj = JSON.parse(lines[98]);
console.log(obj.content);
