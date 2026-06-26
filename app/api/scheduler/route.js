export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { runScheduler, runSchedulerForVideo } from '@/lib/scheduler';
import { verifyAppAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (videoId) {
      console.log(`[API Scheduler] Force-executing single video: ${videoId}`);
      await runSchedulerForVideo(videoId);
      console.log(`[API Scheduler] Single video execution completed: ${videoId}`);
      return NextResponse.json({ success: true, message: `Video ${videoId} publicado correctamente` });
    }

    console.log('[API Scheduler] Manual/Cron trigger started.');
    await runScheduler();
    console.log('[API Scheduler] Manual/Cron trigger completed successfully.');

    return NextResponse.json({ success: true, message: 'Scheduler executed successfully' });
  } catch (error) {
    console.error('[API Scheduler] Error executing scheduler:', error);
    return NextResponse.json({ error: error.message || 'Scheduler execution failed' }, { status: 500 });
  }
}
