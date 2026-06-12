import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

export async function GET(request) {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('app_session');
  } catch (err) {
    console.error('[API Auth Logout] Error clearing cookie:', err);
  }

  const appUrl = (await getConfig('NEXT_PUBLIC_APP_URL')) || 'http://localhost:3000';
  return NextResponse.redirect(`${appUrl}/`);
}
