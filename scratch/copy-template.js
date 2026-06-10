const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\274ac47d-f79d-4d09-b6da-e6bef05fe65d\\media__1781035230596.png';
const dest = path.join(__dirname, '..', 'public', 'template_thumbnail.png');

try {
  fs.copyFileSync(src, dest);
  console.log('Template thumbnail copied successfully to public/template_thumbnail.png');
} catch (err) {
  console.error('Failed to copy template thumbnail:', err);
}
