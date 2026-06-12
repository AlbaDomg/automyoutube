const sharp = require('sharp');

async function test() {
  try {
    const image = sharp('public/tvg_logo.png');
    const metadata = await image.metadata();
    const rawBuffer = await image.raw().toBuffer();
    const lw = metadata.width;
    const lh = metadata.height;
    
    // We will test multiple thresholds for R, G, B
    const thresholds = [245, 250, 251, 252, 253, 254];
    
    for (const thresh of thresholds) {
      const visited = new Uint8Array(lw * lh);
      const queue = [520, 330];
      visited[330 * lw + 520] = 1;
      
      let head = 0;
      let count = 0;
      
      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        count++;
        
        const neighbors = [
          { x: cx + 1, y: cy },
          { x: cx - 1, y: cy },
          { x: cx, y: cy + 1 },
          { x: cx, y: cy - 1 }
        ];
        
        for (let i = 0; i < neighbors.length; i++) {
          const n = neighbors[i];
          if (n.x >= 0 && n.x < lw && n.y >= 0 && n.y < lh) {
            const nIdx = n.y * lw + n.x;
            if (!visited[nIdx]) {
              const idx = nIdx * metadata.channels;
              const r = rawBuffer[idx];
              const g = rawBuffer[idx + 1];
              const b = rawBuffer[idx + 2];
              
              if (r >= thresh && g >= thresh && b >= thresh) {
                visited[nIdx] = 1;
                queue.push(n.x, n.y);
              }
            }
          }
        }
      }
      
      // Let's analyze where the visited pixels are.
      // We know that the white "G" is centered around X: 350-700, Y: 300-650.
      // If we visit pixels outside this bounding box, it means it leaked!
      let leaked = false;
      let minX = lw, maxX = 0, minY = lh, maxY = 0;
      
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const idx = y * lw + x;
          if (visited[idx]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            
            // Checkerboard is on the left / bottom outside the teal banner and G.
            // Let's see if we hit x < 300 or y > 700 or y < 200.
            if (x < 300 || y > 750 || y < 200) {
              leaked = true;
            }
          }
        }
      }
      
      console.log(`Threshold >= ${thresh}:`);
      console.log(`- Pixels visited: ${count}`);
      console.log(`- Bounding box of visited: X=[${minX}, ${maxX}], Y=[${minY}, ${maxY}]`);
      console.log(`- Leaked to checkerboard: ${leaked ? 'YES' : 'NO'}`);
      console.log('---');
    }
  } catch (err) {
    console.error(err);
  }
}

test();
