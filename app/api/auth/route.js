import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/youtube';

export async function GET(request) {
  try {
    const referer = request.headers.get('referer');
    let originalOrigin = 'http://localhost:3000';
    if (referer) {
      try {
        originalOrigin = new URL(referer).origin;
      } catch (_) {}
    }

    const oauth2Client = await getOAuth2Client();
    const scopes = [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: originalOrigin
    });

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    return NextResponse.json({ error: 'Failed to initiate authentication' }, { status: 500 });
  }
}

