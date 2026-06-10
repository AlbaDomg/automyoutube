const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, '..', 'public', 'template_thumbnail.png');

try {
  const buffer = fs.readFileSync(filepath);
  // PNG IHDR chunk starts at byte 12. Width is at 16-19, Height is at 20-23
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  console.log(`Dimensions of template_thumbnail.png: ${width}x${height}`);
} catch (err) {
  console.error('Error reading PNG header:', err);
}
