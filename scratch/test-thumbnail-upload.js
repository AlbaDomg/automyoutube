const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function getOAuth2Client() {
  const clientId = await prisma.systemConfig.findUnique({ where: { key: 'YOUTUBE_CLIENT_ID' } });
  const clientSecret = await prisma.systemConfig.findUnique({ where: { key: 'YOUTUBE_CLIENT_SECRET' } });
  const appUrl = await prisma.systemConfig.findUnique({ where: { key: 'NEXT_PUBLIC_APP_URL' } });
  const redirectUri = `${appUrl?.value || 'http://localhost:3000'}/api/auth/callback`;

  return new google.auth.OAuth2(
    clientId?.value,
    clientSecret?.value,
    redirectUri
  );
}

async function main() {
  const youtubeVideoId = '2V7N_WbNJcU'; // Video ID from your database
  
  try {
    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      console.error('No connected channel found in database.');
      return;
    }

    console.log(`Using channel: ${channel.title}`);

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // Create a tiny 1x1 black JPEG buffer (dummy image)
    const dummyJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const buffer = Buffer.from(dummyJpgBase64, 'base64');
    
    const tempFilePath = path.join(__dirname, 'temp-test-thumb.jpg');
    fs.writeFileSync(tempFilePath, buffer);
    
    console.log(`Attempting to upload thumbnail for video ${youtubeVideoId}...`);
    
    try {
      const res = await youtube.thumbnails.set({
        videoId: youtubeVideoId,
        media: {
          mimeType: 'image/jpeg',
          body: fs.createReadStream(tempFilePath)
        }
      });
      console.log('API Response Success!', res.data);
    } catch (apiErr) {
      console.error('YouTube API Error:', apiErr.response ? apiErr.response.data : apiErr.message);
      if (apiErr.response && apiErr.response.data && apiErr.response.data.error) {
        console.error('Error Details:', JSON.stringify(apiErr.response.data.error, null, 2));
      }
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

  } catch (err) {
    console.error('Database/OAuth client error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
