import { NextResponse } from 'next/server';
import { getAppLoginOAuth2Client } from '@/lib/youtube';

export async function GET(request) {
  try {
    const referer = request.headers.get('referer');
    let originalOrigin = 'http://localhost:3000';
    if (referer) {
      try {
        originalOrigin = new URL(referer).origin;
      } catch (_) {}
    }

    const { origin } = new URL(request.url);
    const oauth2Client = await getAppLoginOAuth2Client(origin);
    const scopes = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'online',
      scope: scopes,
      prompt: 'select_account',
      state: originalOrigin
    });

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Error generating app auth login URL:', error);
    return NextResponse.json({ error: 'Failed to initiate login flow' }, { status: 500 });
  }
}
