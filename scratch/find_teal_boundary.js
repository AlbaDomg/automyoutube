const sharp = require('sharp');

async function findTeal() {
  try {
    const image = sharp('public/tvg_logo.png');
    const metadata = await image.metadata();
    const rawBuffer = await image.raw().toBuffer();
    const lw = metadata.width;
    const lh = metadata.height;
    
    console.log('Teal boundary detection:');
    
    // We sample y at 0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
    for (let y = 0; y < lh; y += 100) {
      let firstTealX = -1;
      let lastTealX = -1;
      
      for (let x = 0; x < lw; x++) {
        const idx = (y * lw + x) * metadata.channels;
        const r = rawBuffer[idx];
        const g = rawBuffer[idx + 1];
        const b = rawBuffer[idx + 2];
        
        // Teal condition
        const isTeal = r < 100 && g > 130 && b > 140;
        
        if (isTeal) {
          if (firstTealX === -1) firstTealX = x;
          lastTealX = x;
        }
      }
      
      // Calculate what C would be if x = y + C
      const c = firstTealX - y;
      console.log(`y = ${y}: first teal x = ${firstTealX}, last teal x = ${lastTealX}, C = ${c}`);
    }
  } catch (err) {
    console.error(err);
  }
}

findTeal();
