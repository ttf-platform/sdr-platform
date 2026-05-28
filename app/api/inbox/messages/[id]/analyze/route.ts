/**
 * POST /api/inbox/messages/[id]/analyze
 *
 * Runs Claude Haiku sentiment classification on an inbox_message and
 * persists the result. Can be called manually (re-analyze) or fired
 * internally after reply ingestion.
 *
 * Auth: requires active user session in the message's workspace.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeMessageSentiment } from '@/lib/inbox-analyze'

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS verify: message must belong to user's workspace
  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('id', params.id)
    .maybeSingle()

  if (!message) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const result = await analyzeMessageSentiment(params.id)

  if (!result) {
    return NextResponse.json({ error: 'analysis_failed' }, { status: 500 })
  }

  return NextResponse.json(result)
}
