export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { runScheduler } from '@/lib/scheduler';

export async function GET(request) {
  try {
    // Verificar el secret del cron para evitar llamadas no autorizadas
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron Scheduler] Unauthorized cron attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Scheduler] Triggered automatically by Vercel Cron.');
    await runScheduler();
    console.log('[Cron Scheduler] Completed successfully.');

    return NextResponse.json({ success: true, message: 'Scheduler ran successfully via cron' });
  } catch (error) {
    console.error('[Cron Scheduler] Error:', error);
    return NextResponse.json({ error: error.message || 'Cron scheduler failed' }, { status: 500 });
  }
}
