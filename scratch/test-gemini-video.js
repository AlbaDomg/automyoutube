const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
  console.error('ERROR: Please set GEMINI_API_KEY in your .env file before running this script.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function checkFileState(fileName) {
  let file = await ai.files.get({ name: fileName });
  while (file.state === 'PROCESSING') {
    console.log(`File is processing... sleeping for 5 seconds.`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    file = await ai.files.get({ name: fileName });
  }
  if (file.state === 'FAILED') {
    throw new Error('File processing failed on Gemini servers.');
  }
  console.log(`File is ready! State: ${file.state}`);
  return file;
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.log('Usage: node scratch/test-gemini-video.js <path-to-video-file>');
    process.exit(1);
  }

  console.log(`Uploading ${videoPath} to Gemini Files API...`);
  const myFile = await ai.files.upload({
    file: videoPath,
    config: {
      mimeType: 'video/mp4',
      displayName: 'Test Video Upload',
    },
  });
  console.log(`Upload completed. Name: ${myFile.name}, URI: ${myFile.uri}`);

  console.log('Waiting for file processing to complete...');
  await checkFileState(myFile.name);

  console.log('Generating video metadata suggestions...');
  const prompt = `
Analyze this video and generate metadata for a YouTube upload:
1. Three options for title (optimized for high CTR and SEO).
2. A compelling description including key topics and estimated timestamps if applicable.
3. Relevant hashtags (starting with #) and keyword tags.

Respond in JSON format with the following keys:
{
  "titles": ["Title 1", "Title 2", "Title 3"],
  "description": "Suggested description...",
  "tags": ["tag1", "tag2", "tag3"]
}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            fileData: {
              fileUri: myFile.uri,
              mimeType: myFile.mimeType,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    }
  });

  console.log('\n--- Gemini Suggestions ---');
  console.log(response.text);
}

main().catch((err) => {
  console.error('Error running Gemini video test:', err);
});
