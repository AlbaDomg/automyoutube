import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAppAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { path } = await request.json();

    if (!path) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Supabase not configured on server' }, { status: 500 });
    }

    // El cliente con la Service Role Key bypasea las políticas RLS y puede borrar cualquier archivo
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabase.storage
      .from('videos')
      .remove([path]);

    if (error) {
      console.error('[Supabase Delete] Error deleting file:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[Supabase Delete] File deleted successfully: ${path}`);
    return NextResponse.json({ success: true, deletedPath: path });

  } catch (error) {
    console.error('[Supabase Delete] Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
