const sharp = require('sharp');

async function testMask() {
  try {
    const image = sharp('public/tvg_logo.png');
    const metadata = await image.metadata();
    const rawBuffer = await image.raw().toBuffer();
    const lw = metadata.width;
    const lh = metadata.height;
    
    // BFS flood-fill
    const visited = new Uint8Array(lw * lh);
    const queue = [520, 330];
    visited[330 * lw + 520] = 1;
    let head = 0;
    
    const isWhitePixel = (r, g, b) => r >= 250 && g >= 250 && b >= 250;
    
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];
      
      const neighbors = [
        { x: cx + 1, y: cy },
        { x: cx - 1, y: cy },
        { x: cx, y: cy + 1 },
        { x: cx, y: cy - 1 }
      ];
      
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        // Restrict to x >= 420 to prevent any leak to the left checkerboard
        if (n.x >= 420 && n.x < lw && n.y >= 0 && n.y < lh) {
          const nIdx = n.y * lw + n.x;
          if (!visited[nIdx]) {
            const idx = nIdx * metadata.channels;
            const r = rawBuffer[idx];
            const g = rawBuffer[idx + 1];
            const b = rawBuffer[idx + 2];
            
            if (isWhitePixel(r, g, b)) {
              visited[nIdx] = 1;
              queue.push(n.x, n.y);
            }
          }
        }
      }
    }
    
    // Apply mask
    const outBuffer = Buffer.alloc(rawBuffer.length);
    rawBuffer.copy(outBuffer);
    
    let transparentCount = 0;
    let keptCount = 0;
    
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const idx = (y * lw + x) * metadata.channels;
        
        let keep = false;
        if (x >= (y + 115)) {
          keep = true;
        } else {
          const pixelIdx = y * lw + x;
          if (visited[pixelIdx]) {
            keep = true;
          }
        }
        
        if (!keep) {
          outBuffer[idx + 3] = 0; // Transparent
          transparentCount++;
        } else {
          keptCount++;
        }
      }
    }
    
    console.log(`Masking stats:`);
    console.log(`- Kept pixels: ${keptCount}`);
    console.log(`- Transparent pixels: ${transparentCount}`);
    
    // Save output to file
    await sharp(outBuffer, {
      raw: {
        width: lw,
        height: lh,
        channels: metadata.channels
      }
    }).png().toFile('scratch/masked_tvg_logo.png');
    
    console.log('Saved output to scratch/masked_tvg_logo.png');
  } catch (err) {
    console.error(err);
  }
}

testMask();
