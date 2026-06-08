const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: JSON.parse(data)
        });
      });
    }).on('error', reject);
  });
}

async function test() {
  try {
    const config = await get('http://localhost:3000/api/config');
    console.log('API Config Response:', JSON.stringify(config, null, 2));

    const channel = await get('http://localhost:3000/api/channel');
    console.log('API Channel Response:', JSON.stringify(channel, null, 2));
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

test();
