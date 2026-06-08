const http = require('http');

http.get('http://localhost:3001/api/youtube/videos', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const videos = JSON.parse(data);
      console.log("VIDEOS LIST:");
      videos.forEach((v, idx) => {
        console.log(`[${idx}] ID: ${v.id}`);
        console.log(`    Title: ${v.title}`);
        console.log(`    Description: ${v.description ? v.description.substring(0, 60) + "..." : "None"}`);
        console.log(`    Thumbnail: ${v.thumbnail}`);
      });
    } catch (e) {
      console.error("Failed to parse JSON:", e.message);
      console.log("Raw output:", data);
    }
  });
}).on('error', (err) => {
  console.error("HTTP error:", err.message);
});
