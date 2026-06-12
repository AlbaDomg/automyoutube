export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { verifySession, isEmailAllowed } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export async function GET(request) {
  try {
    const allowedStr = await getConfig('ALLOWED_EMAILS') || process.env.ALLOWED_EMAILS || '';
    const isRequired = !!(allowedStr && allowedStr.trim().length > 0);

    if (!isRequired) {
      return NextResponse.json({ required: false });
    }

    const cookieHeader = request.headers.get('cookie') || '';
    const match = cookieHeader.match(/app_session=([^;]+)/);
    const sessionCookie = match ? decodeURIComponent(match[1]) : null;

    if (!sessionCookie) {
      return NextResponse.json({ required: true, authenticated: false });
    }

    const email = await verifySession(sessionCookie);
    if (!email) {
      return NextResponse.json({ required: true, authenticated: false });
    }

    const isAllowed = await isEmailAllowed(email);
    if (!isAllowed) {
      return NextResponse.json({ required: true, authenticated: false, error: 'Unauthorized email' });
    }

    return NextResponse.json({
      required: true,
      authenticated: true,
      user: { email }
    });
  } catch (error) {
    console.error('[API Auth Me] Error checking session:', error);
    return NextResponse.json({ error: 'Failed to verify session' }, { status: 500 });
  }
}
