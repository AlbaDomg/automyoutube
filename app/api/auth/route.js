import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/youtube';
import { verifyAppAuth, getCurrentUserEmail } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      console.warn('[OAuth Init] Request failed verifyAppAuth verification');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = await getCurrentUserEmail(request);
    console.log('[OAuth Init] Authenticated worker email:', email);
    if (!email) {
      return NextResponse.json({ error: 'No authenticated email found' }, { status: 400 });
    }

    const referer = request.headers.get('referer');
    let originalOrigin = 'http://localhost:3000';
    if (referer) {
      try {
        originalOrigin = new URL(referer).origin;
      } catch (_) {}
    }
    console.log('[OAuth Init] Referer origin:', originalOrigin);

    const { origin } = new URL(request.url);
    const oauth2Client = await getOAuth2Client(origin);
    const scopes = [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ];

    const statePayload = JSON.stringify({ origin: originalOrigin, email });
    const stateBase64 = Buffer.from(statePayload).toString('base64');

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: stateBase64
    });

    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    return NextResponse.json({ error: 'Failed to initiate authentication' }, { status: 500 });
  }
}


