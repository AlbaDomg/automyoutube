import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/youtube';
import prisma from '@/lib/db';
import { getConfig } from '@/lib/config';
import { google } from 'googleapis';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const appUrl = (await getConfig('NEXT_PUBLIC_APP_URL')) || 'http://localhost:3000';
  const redirectBase = state || appUrl;

  if (!code) {
    return NextResponse.redirect(`${redirectBase}/?error=no_code`);
  }

  try {
    const oauth2Client = await getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get YouTube channel info
    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    const channelResponse = await youtube.channels.list({
      part: 'snippet',
      mine: true
    });

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      return NextResponse.redirect(`${redirectBase}/?error=no_channel_found`);
    }

    const channelItem = channelResponse.data.items[0];
    const channelId = channelItem.id;
    const channelTitle = channelItem.snippet.title;
    const channelThumbnail = channelItem.snippet.thumbnails?.default?.url || null;

    // Save/update channel in database
    await prisma.channel.upsert({
      where: { id: channelId },
      update: {
        title: channelTitle,
        thumbnail: channelThumbnail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: new Date(tokens.expiry_date),
      },
      create: {
        id: channelId,
        title: channelTitle,
        thumbnail: channelThumbnail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        tokenExpiry: new Date(tokens.expiry_date),
      }
    });

    return NextResponse.redirect(`${redirectBase}/?auth=success`);
  } catch (error) {
    console.error('Error during Google OAuth callback:', error);
    return NextResponse.redirect(`${redirectBase}/?error=auth_failed`);
  }
}

