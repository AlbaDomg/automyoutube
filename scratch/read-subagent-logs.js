const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\4ff1ec75-db4f-4276-a050-f519ec161cee\\.system_generated\\logs\\transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('capture_browser_console_logs') || line.includes('Console logs') || line.includes('CONSOLE')) {
      const obj = JSON.parse(line);
      console.log('--- Found Entry ---');
      console.log('Source:', obj.source);
      console.log('Type:', obj.type);
      console.log('Content snippet:', JSON.stringify(obj.content || '').substring(0, 1000));
      if (obj.tool_calls) {
        console.log('Tool calls:', JSON.stringify(obj.tool_calls));
      }
    }
  }
}

processLineByLine().catch(console.error);
