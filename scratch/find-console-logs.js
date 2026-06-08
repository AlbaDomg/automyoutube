const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\1b2dd572-f9fb-41e0-87af-328994d06603\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logPath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const obj = JSON.parse(line);
    // Print any tool response content
    if (obj.type === 'tool_response' && obj.content) {
      const contentStr = typeof obj.content === 'object' ? JSON.stringify(obj.content) : obj.content;
      if (contentStr.includes('[info]') || contentStr.includes('[error]') || contentStr.includes('[log]') || contentStr.includes('FETCH_')) {
        console.log(`\n=== Step ${obj.step_index} ===`);
        console.log(contentStr.substring(0, 1500));
      }
    }
  }
}

processLineByLine().catch(console.error);
