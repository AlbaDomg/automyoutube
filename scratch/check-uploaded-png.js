const fs = require('fs');
const path = require('path');

// PNG signature is 8 bytes. IHDR chunk starts at byte 12.
// Color type is at byte 25. Value 6 means RGBA (with alpha).
const filepath = 'C:\\Users\\albad\\.gemini\\antigravity-ide\\brain\\0e5bf0ea-9535-47b9-96f1-adb234e94a5c\\media__1781217134530.png';

try {
  if (!fs.existsSync(filepath)) {
    console.error("File does not exist!");
    process.exit(1);
  }
  const buffer = fs.readFileSync(filepath);
  const colorType = buffer[25];
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  console.log(`PNG Color Type: ${colorType} (${colorType === 6 ? 'RGBA - has transparency' : 'Other'})`);
  console.log(`Dimensions: ${width}x${height}`);
} catch (err) {
  console.error(err);
}
