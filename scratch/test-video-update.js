const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
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
  const youtubeVideoId = 'JxgVvmqlbbs'; // Video ID from your channel
  
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

    // Refresh token if needed
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      console.log('Refreshing token...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          accessToken: credentials.access_token,
          tokenExpiry: new Date(credentials.expiry_date)
        }
      });
      console.log('Token refreshed!');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    console.log(`Fetching current snippet for video ${youtubeVideoId}...`);
    const videoGetRes = await youtube.videos.list({
      part: 'snippet',
      id: youtubeVideoId
    });

    if (!videoGetRes.data.items || videoGetRes.data.items.length === 0) {
      console.error('Video not found on YouTube!');
      return;
    }

    const currentSnippet = videoGetRes.data.items[0].snippet;
    console.log('Current Title:', currentSnippet.title);
    console.log('Current Description length:', currentSnippet.description?.length);
    console.log('Current Tags:', currentSnippet.tags);

    // Try updating with the same snippet but slightly modified title (adding a small suffix or keeping it same)
    const updatedSnippet = {
      ...currentSnippet,
      title: currentSnippet.title.substring(0, 95) + " (IA)", // safe test
      tags: currentSnippet.tags ? [...currentSnippet.tags] : ["test"]
    };

    console.log('Attempting to update video...');
    const updateRes = await youtube.videos.update({
      part: 'snippet',
      requestBody: {
        id: youtubeVideoId,
        snippet: updatedSnippet
      }
    });

    console.log('Update Success!', updateRes.data.snippet.title);

  } catch (err) {
    console.error('Error during update test:', err.response ? err.response.data : err.message);
    if (err.response && err.response.data && err.response.data.error) {
      console.error('Details:', JSON.stringify(err.response.data.error, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
