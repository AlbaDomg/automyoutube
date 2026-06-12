const fs = require('fs');
const logPath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\65bbcd6c-d93a-4382-9231-91951b777c21\\.system_generated\\logs\\transcript.jsonl';

if (!fs.existsSync(logPath)) {
  console.log("No log file found.");
  process.exit();
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
for (const line of lines) {
  if (!line) continue;
  const obj = JSON.parse(line);
  if (obj.tool_calls) {
    for (const call of obj.tool_calls) {
      if (call.name === 'browser_subagent') {
        console.log(`Step ${obj.step_index} Call:`, JSON.stringify(call.args));
      }
    }
  }
  if (obj.type === 'tool_response' && obj.content) {
    const contentStr = typeof obj.content === 'object' ? JSON.stringify(obj.content) : obj.content;
    if (contentStr.includes('wetransfer_download')) {
      console.log(`Step ${obj.step_index} Response Content:`, contentStr);
    }
  }
}
