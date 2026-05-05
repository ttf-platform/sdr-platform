/**
 * POST /api/feedback
 *
 * Creates a feedback entry from the Widget Help "Give feedback" form.
 * No admin email — feedback isn't urgent, the admin reviews them in the
 * Support Center.
 *
 * Request body:
 *   {
 *     category: 'suggestion' | 'feature_request' | 'ux' | 'performance' | 'other',
 *     content: string,
 *     wouldPay?: boolean
 *   }
 *
 * Response: { feedback_id }
 *
 * Auth: required.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const ALLOWED_CATEGORIES = [
  'suggestion',
  'feature_request',
  'ux',
  'performance',
  'other',
] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { category?: string; content?: string; wouldPay?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const content = (body.content ?? '').trim();
  if (!content) {
    return NextResponse.json({ error: 'content_required' }, { status: 400 });
  }
  if (content.length > 5000) {
    return NextResponse.json({ error: 'content_too_long' }, { status: 400 });
  }

  const category: Category = ALLOWED_CATEGORIES.includes(body.category as Category)
    ? (body.category as Category)
    : 'suggestion';

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }
  const workspaceId = membership.workspace_id as string;

  const { data: fb, error: insertErr } = await supabase
    .from('feedback')
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      category,
      content,
      would_pay: typeof body.wouldPay === 'boolean' ? body.wouldPay : null,
      status: 'new',
    })
    .select('id')
    .single();
  if (insertErr || !fb) {
    return NextResponse.json(
      { error: 'insert_failed', detail: insertErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ feedback_id: fb.id });
}
