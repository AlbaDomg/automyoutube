import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/youtube';
import prisma from '@/lib/db';
import { getConfig } from '@/lib/config';
import { google } from 'googleapis';
import { getCurrentUserEmail } from '@/lib/auth';

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const { searchParams, origin } = requestUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const appUrl = origin || (await getConfig('NEXT_PUBLIC_APP_URL')) || 'http://localhost:3000';
  
  let redirectBase = appUrl;
  let userEmail = null;

  console.log('[OAuth Callback] Code received:', code ? 'yes (length: ' + code.length + ')' : 'no');
  console.log('[OAuth Callback] Raw state received:', state);

  if (state) {
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
      console.log('[OAuth Callback] Decoded state successfully:', decodedState);
      redirectBase = decodedState.origin || appUrl;
      userEmail = decodedState.email;
    } catch (err) {
      console.warn('[OAuth Callback] Failed to decode state as Base64 JSON, treating as raw redirect URL:', err.message);
      redirectBase = state || appUrl;
    }
  }

  // Fallback to cookie
  if (!userEmail) {
    console.log('[OAuth Callback] Email not in state, falling back to session cookie...');
    userEmail = await getCurrentUserEmail(request);
    console.log('[OAuth Callback] Cookie fallback email result:', userEmail);
  }

  if (!code) {
    console.error('[OAuth Callback] Missing code in query parameters');
    return NextResponse.redirect(`${redirectBase}/?error=no_code`);
  }

  if (!userEmail) {
    console.error('[OAuth Callback] Missing userEmail from both state and cookie');
    return NextResponse.redirect(`${redirectBase}/?error=unauthorized_no_session`);
  }

  try {
    const oauth2Client = await getOAuth2Client(origin);
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
      console.error('[OAuth Callback] No YouTube channels found for these credentials');
      return NextResponse.redirect(`${redirectBase}/?error=no_channel_found`);
    }

    const channelItem = channelResponse.data.items[0];
    const channelId = channelItem.id;
    const channelTitle = channelItem.snippet.title;
    const channelThumbnail = channelItem.snippet.thumbnails?.default?.url || null;

    console.log('[OAuth Callback] Channel found:', { channelId, channelTitle, userEmail });

    // Save/update channel in database matching on userEmail
    const upsertedChannel = await prisma.channel.upsert({
      where: { userEmail: userEmail },
      update: {
        id: channelId,
        title: channelTitle,
        thumbnail: channelThumbnail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: new Date(tokens.expiry_date),
      },
      create: {
        userEmail: userEmail,
        id: channelId,
        title: channelTitle,
        thumbnail: channelThumbnail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        tokenExpiry: new Date(tokens.expiry_date),
      }
    });

    console.log('[OAuth Callback] Channel upsert completed successfully in DB:', upsertedChannel.dbId);

    return NextResponse.redirect(`${redirectBase}/?auth=success`);
  } catch (error) {
    console.error('[OAuth Callback] Error during Google OAuth callback:', error);
    return NextResponse.redirect(`${redirectBase}/?error=auth_failed`);
  }
}


