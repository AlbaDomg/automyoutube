const sharp = require('sharp');
const fs = require('fs');

async function run() {
  try {
    const image = sharp('public/tvg_logo.png');
    const metadata = await image.metadata();
    console.log('Metadata:', metadata.width, 'x', metadata.height, 'channels:', metadata.channels);
    
    // Get raw pixel data
    const rawBuffer = await image.raw().toBuffer();
    const lw = metadata.width;
    const lh = metadata.height;
    
    // Let's sample pixels and print their colors
    // We want to see:
    // 1. Teal banner pixel (e.g. top right, x=800, y=100)
    // 2. White G pixel (e.g. x=520, y=330)
    // 3. Grey square of checkerboard (e.g. x=100, y=900)
    // 4. White square of checkerboard (e.g. x=120, y=900)
    // 5. Shadow pixel
    
    const printPixel = (x, y, desc) => {
      const idx = (y * lw + x) * metadata.channels;
      const r = rawBuffer[idx];
      const g = rawBuffer[idx + 1];
      const b = rawBuffer[idx + 2];
      const a = metadata.channels === 4 ? rawBuffer[idx + 3] : 255;
      console.log(`${desc} at (${x}, ${y}): R=${r}, G=${g}, B=${b}, A=${a}`);
    };

    printPixel(800, 100, 'Teal banner');
    printPixel(520, 330, 'White G');
    printPixel(100, 900, 'Checkerboard square A');
    printPixel(120, 900, 'Checkerboard square B');
    printPixel(370, 520, 'Shadow/Transition pixel');
    
    // Let's analyze color properties to find a good filter
    // Let's count how many pixels fall into different category ranges
    let whiteCount = 0;
    let tealCount = 0;
    let grayGridCount = 0;
    let otherCount = 0;

    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const idx = (y * lw + x) * metadata.channels;
        const r = rawBuffer[idx];
        const g = rawBuffer[idx + 1];
        const b = rawBuffer[idx + 2];
        
        // Check if it's white G
        const isWhite = r > 240 && g > 240 && b > 240;
        // Check if it's teal (R is low, G and B are high/medium and similar)
        const isTeal = r < 100 && g > 130 && b > 140;
        // Check if it's gray or white (r, g, b are very close to each other - low saturation)
        const maxColor = Math.max(r, g, b);
        const minColor = Math.min(r, g, b);
        const diff = maxColor - minColor;
        
        if (isWhite) {
          whiteCount++;
        } else if (isTeal) {
          tealCount++;
        } else if (diff < 15) {
          grayGridCount++;
        } else {
          otherCount++;
        }
      }
    }
    
    console.log(`Summary of pixel classes:`);
    console.log(`- White (R,G,B > 240): ${whiteCount}`);
    console.log(`- Teal (R<100, G>130, B>140): ${tealCount}`);
    console.log(`- Grayscale / Low saturation (diff < 15): ${grayGridCount}`);
    console.log(`- Other (colored transition/shadows): ${otherCount}`);
  } catch (err) {
    console.error(err);
  }
}

run();
