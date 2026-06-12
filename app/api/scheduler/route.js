export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { runScheduler } from '@/lib/scheduler';

export async function GET(request) {
  try {
    // Si quisiéramos protegerlo, podríamos verificar un header o token secreto (ej. CRON_SECRET)
    // Pero para simplificar el cron inicial, llamamos directamente al scheduler.
    console.log('[API Scheduler] Manual/Cron trigger started.');
    await runScheduler();
    console.log('[API Scheduler] Manual/Cron trigger completed successfully.');

    return NextResponse.json({ success: true, message: 'Scheduler executed successfully' });
  } catch (error) {
    console.error('[API Scheduler] Error executing scheduler:', error);
    return NextResponse.json({ error: error.message || 'Scheduler execution failed' }, { status: 500 });
  }
}
