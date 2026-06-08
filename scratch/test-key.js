const { GoogleGenAI } = require('@google/genai');

const apiKey = "YOUR_GEMINI_API_KEY";
const ai = new GoogleGenAI({ apiKey: apiKey });

async function main() {
  console.log("Testing API key...");
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Hello, are you working?',
  });
  console.log("Success! Response:", response.text);
}

main().catch(err => {
  console.error("API Key Test Failed:", err);
});
