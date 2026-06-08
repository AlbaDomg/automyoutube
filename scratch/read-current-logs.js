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
    
    // Check if it's the browser subagent's step response
    if (obj.type === 'tool_response' && obj.content) {
      const contentStr = typeof obj.content === 'object' ? JSON.stringify(obj.content) : obj.content;
      if (contentStr.includes('capture_browser_console_logs') || contentStr.includes('Console logs') || contentStr.includes('ConsoleLogs')) {
        console.log('\n====================================');
        console.log('Step Index:', obj.step_index);
        console.log('Content:\n', contentStr);
      }
    }
  }
}

processLineByLine().catch(console.error);
