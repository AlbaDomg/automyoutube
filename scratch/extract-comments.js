const fs = require('fs');

function extractComments(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const lines = code.split('\n');
  const comments = [];
  
  // A simple line-by-line check for basic comments
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for single-line comments
    const singleMatch = line.match(/\/\/+(.*)$/);
    if (singleMatch) {
      comments.push({ type: 'single', line: lineNum, content: singleMatch[0].trim(), text: singleMatch[1].trim() });
    }
    
    // Check for JSX comments or block comments
    const blockMatch = line.match(/\{\/\*\s*(.*?)\s*\*\/\}/) || line.match(/\/\*\s*(.*?)\s*\*\//);
    if (blockMatch) {
      comments.push({ type: 'block', line: lineNum, content: blockMatch[0].trim(), text: blockMatch[1].trim() });
    }
  });
  
  return comments;
}

console.log('--- Comments in app/api/upload/route.js ---');
const routeComments = extractComments('app/api/upload/route.js');
routeComments.forEach(c => console.log(`Line ${c.line}: ${c.content}`));

console.log('\n--- Comments in app/page.js ---');
const pageComments = extractComments('app/page.js');
// Print the first 50 comments found
pageComments.slice(0, 80).forEach(c => console.log(`Line ${c.line}: ${c.content}`));
