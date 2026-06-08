const fs = require('fs');
const path = require('path');

async function testUpload() {
  const uploadId = 'test-upload-id-' + Date.now();
  const fileName = 'test-video.mp4';
  const chunkData = Buffer.alloc(1024 * 900); // 900KB dummy chunk
  
  const boundary = '----TestBoundary' + Math.random().toString(36).substring(2);
  
  const chunks = [];
  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="fileName"\r\n\r\n${fileName}\r\n`);
  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="uploadId"\r\n\r\n${uploadId}\r\n`);
  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="chunkIndex"\r\n\r\n0\r\n`);
  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="totalChunks"\r\n\r\n1\r\n`);
  chunks.push(`--${boundary}\r\n`);
  chunks.push(`Content-Disposition: form-data; name="chunk"; filename="${fileName}"\r\n`);
  chunks.push(`Content-Type: application/octet-stream\r\n\r\n`);
  
  const headerBuffer = Buffer.from(chunks.join(''));
  const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`);
  
  const bodyBuffer = Buffer.concat([headerBuffer, chunkData, footerBuffer]);
  
  try {
    console.log('Sending test 900KB chunk to active Tunnelmole URL...');
    const res = await fetch('https://sc4omr-ip-212-170-77-75.tunnelmole.net/api/upload/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer
    });
    
    console.log('Response status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testUpload();
