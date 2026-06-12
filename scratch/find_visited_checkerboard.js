const sharp = require('sharp');

async function check() {
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
              if (r > thresh && g > thresh && b > thresh) {
                visited[nIdx] = 1;
                queue.push(n.x, n.y);
              }
            }
          }
        }
      }
      return visited;
    };

    const thresholds = [240, 245, 248, 250, 252];
    for (const thresh of thresholds) {
      const visited = runBFS(thresh);
      let checkerboardVisited = 0;
      let samplePixels = [];
      
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          if (visited[y * lw + x]) {
            // Check if it's in checkerboard region:
            // 1. To the left of the diagonal line: x < y + 110
            // 2. Outside the "G" logo bounding box: x < 420 || y > 585 || y < 315
            const isLeftOfDiagonal = x < (y + 110);
            const isOutsideG = x < 420 || y > 585 || y < 315;
            
            if (isLeftOfDiagonal && isOutsideG) {
              checkerboardVisited++;
              if (samplePixels.length < 10) {
                const idx = (y * lw + x) * metadata.channels;
                samplePixels.push({x, y, r: rawBuffer[idx], g: rawBuffer[idx+1], b: rawBuffer[idx+2]});
              }
            }
          }
        }
      }
      
      console.log(`Threshold > ${thresh}:`);
      console.log(`- Checkerboard pixels visited: ${checkerboardVisited}`);
      if (checkerboardVisited > 0) {
        console.log(`- Sample pixels:`, samplePixels);
      }
      console.log('---');
    }
  } catch (err) {
    console.error(err);
  }
}

check();
