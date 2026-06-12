const fs = require('fs');
const path = require('path');

const userHome = process.env.USERPROFILE || 'C:\\Users\\albad';
const downloadsPath = path.join(userHome, 'Downloads');

if (fs.existsSync(downloadsPath)) {
  const files = fs.readdirSync(downloadsPath);
  console.log("Downloads contents:");
  for (const file of files) {
    if (file.toLowerCase().endsWith('.pdf') || file.includes('HORA GALEGA') || file.includes('MATERIAL REDES')) {
      console.log(`- ${file}`);
    }
  }
} else {
  console.log("Downloads directory does not exist.");
}
