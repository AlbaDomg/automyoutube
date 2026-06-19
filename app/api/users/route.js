import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyAppAuth, getCurrentUserEmail, getUserRole } from '@/lib/auth';

// Helper to check if requester is Admin
async function checkAdminAuth(request) {
  if (!(await verifyAppAuth(request))) {
    return { authorized: false, status: 401, error: 'Unauthorized' };
  }
  const email = await getCurrentUserEmail(request);
  if (!email) {
    return { authorized: false, status: 400, error: 'No authenticated email found' };
  }
  const role = await getUserRole(email);
  if (role !== 'ADMIN') {
    return { authorized: false, status: 403, error: 'Forbidden: Requiere rol de Administrador' };
  }
  return { authorized: true, email };
}

// GET: List all users
export async function GET(request) {
  const auth = await checkAdminAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: { email: 'asc' }
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error('[API Users GET] Error:', error);
    return NextResponse.json({ error: 'Error al obtener usuarios' }, { status: 500 });
  }
}

// POST: Add or update a user (invite/assign role)
export async function POST(request) {
  const auth = await checkAdminAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { email, role } = await request.json();

    if (!email || !role) {
      return NextResponse.json({ error: 'Faltan campos requeridos (email, role)' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const validRoles = ['ADMIN', 'PRODUCTORA', 'SEO_MANAGER'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Rol no válido' }, { status: 400 });
    }

    const user = await prisma.user.upsert({
      where: { email: cleanEmail },
      update: { role },
      create: {
        email: cleanEmail,
        role,
        invitedBy: auth.email
      }
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('[API Users POST] Error:', error);
    return NextResponse.json({ error: 'Error al guardar/invitar usuario' }, { status: 500 });
  }
}

// DELETE: Revoke user access
export async function DELETE(request) {
  const auth = await checkAdminAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Falta el parámetro email' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Prevent Admin from deleting themselves to avoid lockout
    if (cleanEmail === auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'No puedes revocar tu propio acceso como administrador' }, { status: 400 });
    }

    await prisma.user.delete({
      where: { email: cleanEmail }
    });

    return NextResponse.json({ success: true, message: 'Usuario revocado con éxito' });
  } catch (error) {
    console.error('[API Users DELETE] Error:', error);
    return NextResponse.json({ error: 'Error al eliminar usuario' }, { status: 500 });
  }
}
