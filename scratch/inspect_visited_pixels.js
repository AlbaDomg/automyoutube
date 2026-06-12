const sharp = require('sharp');

async function analyze() {
  try {
    const image = sharp('public/tvg_logo.png');
    const metadata = await image.metadata();
    const rawBuffer = await image.raw().toBuffer();
    const lw = metadata.width;
    const lh = metadata.height;
    
    const runBFS = (thresh) => {
      const visited = new Uint8Array(lw * lh);
      const queue = [520, 330];
      visited[330 * lw + 520] = 1;
      let head = 0;
      
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
      return visited;
    };

    const visited240 = runBFS(241);
    const visited250 = runBFS(250);

    // Let's find pixels that are visited in 240 but NOT in 250
    let diffCount = 0;
    console.log('Pixels visited at 240 but NOT at 250 (sample coordinates):');
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const idx = y * lw + x;
        if (visited240[idx] && !visited250[idx]) {
          diffCount++;
          if (diffCount <= 20) {
            const pIdx = idx * metadata.channels;
            console.log(`x=${x}, y=${y}: R=${rawBuffer[pIdx]}, G=${rawBuffer[pIdx+1]}, B=${rawBuffer[pIdx+2]}`);
          }
        }
      }
    }
    console.log(`Total difference pixels: ${diffCount}`);
  } catch (err) {
    console.error(err);
  }
}

analyze();
