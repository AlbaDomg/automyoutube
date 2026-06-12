export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { runScheduler } from '@/lib/scheduler';
import { verifyAppAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
