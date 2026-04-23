import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { workspace_id } = await request.json()
  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('*').eq('workspace_id', workspace_id)
  const { data: profile } = await admin.from('workspace_profiles').select('*').eq('workspace_id', workspace_id).single()
  const totalSent = campaigns?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
  const totalReplies = campaigns?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: 'Generate a morning brief for a B2B sales professional.

Product: ' + (profile?.product_description || 'B2B SaaS') + '
Active campaigns: ' + (campaigns?.length || 0) + '
Emails sent: ' + totalSent + '
Replies: ' + totalReplies + '
Reply rate: ' + (totalSent > 0 ? ((totalReplies/totalSent)*100).toFixed(1) : 0) + '%

Return ONLY this JSON, no markdown:
{ "sections": [{ "title": "Your pipeline", "content": "..." }, { "title": "Action items", "content": "..." }, { "title": "Market intel", "content": "..." }] }'
    }]
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  const clean = text.replace(/```json|```/g, '').trim()
  const content = JSON.parse(clean)
  const { data: brief } = await admin.from('morning_briefs').insert({ workspace_id, content, brief_date: new Date().toISOString().split('T')[0], sent_at: new Date().toISOString() }).select().single()
  return NextResponse.json({ brief })
}