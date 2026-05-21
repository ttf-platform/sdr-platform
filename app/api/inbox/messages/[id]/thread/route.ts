/**
 * GET /api/inbox/messages/[id]/thread
 *
 * Returns all messages (sent + received) for the thread of the given
 * inbox_message, ordered chronologically. Used by the Inbox thread view.
 *
 * Response shape:
 *   {
 *     thread_id: string | null,
 *     items: ThreadItem[]
 *   }
 *
 * ThreadItem:
 *   { kind: 'sent'|'inbox', id, subject, body, timestamp, from_name, from_email }
 *
 * If the message has no thread_id, returns only the single message as a
 * one-item thread so the UI doesn't need special-casing.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ThreadItem {
  kind: 'sent' | 'inbox'
  id: string
  subject: string | null
  body: string | null
  timestamp: string
  from_name: string | null
  from_email: string | null
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Auth + workspace scope via RLS
  const { data: root, error } = await supabase
    .from('inbox_messages')
    .select('id, thread_id, workspace_id, subject, body, received_at, from_name, from_email')
    .eq('id', params.id)
    .maybeSingle()

  if (error || !root) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!root.thread_id) {
    const single: ThreadItem = {
      kind: 'inbox',
      id: root.id,
      subject: root.subject,
      body: root.body,
      timestamp: root.received_at,
      from_name: root.from_name,
      from_email: root.from_email,
    }
    return NextResponse.json({ thread_id: null, items: [single] })
  }

  const admin = createAdminClient()

  // Fetch all inbox messages in this thread
  const { data: inboxItems } = await admin
    .from('inbox_messages')
    .select('id, subject, body, received_at, from_name, from_email')
    .eq('thread_id', root.thread_id)
    .eq('workspace_id', root.workspace_id)
    .order('received_at', { ascending: true })

  // Fetch all sent emails in this thread
  const { data: sentItems } = await admin
    .from('prospect_emails')
    .select('id, subject, body, sent_at')
    .eq('thread_id', root.thread_id)
    .eq('workspace_id', root.workspace_id)
    .order('sent_at', { ascending: true })

  // Find workspace sending identity for the "from" label on sent messages
  const { data: emailAccount } = await admin
    .from('email_accounts')
    .select('email_address, sender_name')
    .eq('workspace_id', root.workspace_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const items: ThreadItem[] = [
    ...(inboxItems ?? []).map((m): ThreadItem => ({
      kind: 'inbox',
      id: m.id,
      subject: m.subject,
      body: m.body,
      timestamp: m.received_at,
      from_name: m.from_name,
      from_email: m.from_email,
    })),
    ...(sentItems ?? []).filter(e => e.sent_at).map((e): ThreadItem => ({
      kind: 'sent',
      id: e.id,
      subject: e.subject,
      body: e.body,
      timestamp: e.sent_at!,
      from_name: emailAccount?.sender_name ?? 'You',
      from_email: emailAccount?.email_address ?? null,
    })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return NextResponse.json({ thread_id: root.thread_id, items })
}
