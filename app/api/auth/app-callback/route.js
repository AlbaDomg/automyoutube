import { NextResponse } from 'next/server';
import { getAppLoginOAuth2Client } from '@/lib/youtube';
import { google } from 'googleapis';
import { signSession, isEmailAllowed } from '@/lib/auth';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

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
    const oauth2Client = await getAppLoginOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2'
    });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      return NextResponse.redirect(`${redirectBase}/?error=no_email_found`);
    }

    // Check if email is allowed
    const allowed = await isEmailAllowed(email);
    if (!allowed) {
      return NextResponse.redirect(`${redirectBase}/?error=unauthorized_email&email=${encodeURIComponent(email)}`);
    }

    // Sign session and set cookie
    const sessionToken = await signSession(email);
    
    // Set cookie
    const cookieStore = await cookies();
    cookieStore.set('app_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    return NextResponse.redirect(`${redirectBase}/?login=success`);
  } catch (error) {
    console.error('Error during app OAuth callback:', error);
    return NextResponse.redirect(`${redirectBase}/?error=login_failed`);
  }
}
