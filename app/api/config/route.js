export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/config';

// GET returns the configuration status with masked secrets for security
export async function GET() {
  try {
    const geminiKey = await getConfig('GEMINI_API_KEY');
    const youtubeClientId = await getConfig('YOUTUBE_CLIENT_ID');
    const youtubeClientSecret = await getConfig('YOUTUBE_CLIENT_SECRET');

    const maskValue = (val) => {
      if (!val || val === 'YOUR_GEMINI_API_KEY' || val === 'YOUR_YOUTUBE_CLIENT_ID' || val === 'YOUR_YOUTUBE_CLIENT_SECRET') {
        return '';
      }
      if (val.length <= 8) return '********';
      return `${val.substring(0, 4)}...${val.substring(val.length - 4)}`;
    };

    const isConfigured = !!(
      geminiKey && geminiKey !== 'YOUR_GEMINI_API_KEY' &&
      youtubeClientId && youtubeClientId !== 'YOUR_YOUTUBE_CLIENT_ID' &&
      youtubeClientSecret && youtubeClientSecret !== 'YOUR_YOUTUBE_CLIENT_SECRET'
    );

    const activePdfName = await getConfig('ACTIVE_PDF_NAME') || '';

    return NextResponse.json({
      GEMINI_API_KEY: maskValue(geminiKey),
      YOUTUBE_CLIENT_ID: maskValue(youtubeClientId),
      YOUTUBE_CLIENT_SECRET: maskValue(youtubeClientSecret),
      isConfigured,
      activePdfName
    });
  } catch (error) {
    console.error('Error reading configuration status:', error);
    return NextResponse.json({ error: 'Failed to read configuration' }, { status: 500 });
  }
}

// POST saves the configuration keys into the database
export async function POST(request) {
  try {
    const { GEMINI_API_KEY, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET } = await request.json();

    if (GEMINI_API_KEY) {
      await setConfig('GEMINI_API_KEY', GEMINI_API_KEY);
    }
    if (YOUTUBE_CLIENT_ID) {
      await setConfig('YOUTUBE_CLIENT_ID', YOUTUBE_CLIENT_ID);
    }
    if (YOUTUBE_CLIENT_SECRET) {
      await setConfig('YOUTUBE_CLIENT_SECRET', YOUTUBE_CLIENT_SECRET);
    }

    return NextResponse.json({ success: true, message: 'Configuration saved successfully' });
  } catch (error) {
    console.error('Error saving configuration:', error);
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}
