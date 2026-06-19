import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAppAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // 1. Verificar autenticación del usuario
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { path } = body; // Ej: "videoId/filename.mp4" o "filename.mp4"

    if (!path) {
      return NextResponse.json({ error: 'Missing file path parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Supabase Delete API] Supabase keys are not configured in environment variables.');
      return NextResponse.json({ error: 'Supabase integration is not configured on the server.' }, { status: 500 });
    }

    console.log(`[Supabase Delete API] Requesting deletion for path: "${path}" in videos bucket...`);

    // 2. Inicializar cliente con Service Role Key (que tiene permisos de bypass de políticas RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    // 3. Eliminar el archivo del bucket "videos"
    const { data, error } = await supabase.storage
      .from('videos')
      .remove([path]);

    if (error) {
      console.error('[Supabase Delete API] Supabase error during removal:', error);
      throw error;
    }

    console.log(`[Supabase Delete API] File deleted successfully from Supabase:`, data);
    return NextResponse.json({ success: true, message: 'File deleted successfully from Supabase Storage' });
  } catch (error) {
    console.error('[Supabase Delete API] Global error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete file from Supabase' }, { status: 500 });
  }
}
