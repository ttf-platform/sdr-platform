import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSentraAdmin();
    return NextResponse.json({ isAdmin: true });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      // Return 200+{isAdmin:false} for authenticated non-admins to avoid console pollution
      if (err.code === 'forbidden') return NextResponse.json({ isAdmin: false });
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }
    throw err;
  }
}
