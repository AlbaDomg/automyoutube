const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\albad\\Downloads\\08_06_2026 MATERIAL REDES HORA GALEGA.pdf';
const destDir = 'c:\\Users\\albad\\OneDrive\\Documentos\\GitHub\\App-Automatizacion-Youtube\\uploads';
const dest = path.join(destDir, 'reference_doc.pdf');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log(`Copied PDF to ${dest}`);
} else {
  console.log("Source PDF not found at " + src);
}
