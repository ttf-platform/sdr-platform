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
  const replyRate = totalSent > 0 ? ((totalReplies/totalSent)*100).toFixed(1) : '0'
  const sep = String.fromCharCode(10)
  const prompt = 'Generate a morning brief for a B2B sales professional.' + sep + 'Product: ' + (profile?.product_description || 'B2B SaaS') + sep + 'Campaigns: ' + (campaigns?.length || 0) + sep + 'Sent: ' + totalSent + sep + 'Replies: ' + totalReplies + sep + 'Reply rate: ' + replyRate + '%' + sep + 'Return ONLY valid JSON: { "sections": [{ "title": "Pipeline", "content": "summary" }, { "title": "Action items", "content": "items" }, { "title": "Market intel", "content": "intel" }] }'
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const clean = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'
  try {
    const content = JSON.parse(clean)
    const { data: brief } = await admin.from('morning_briefs').insert({ workspace_id, content, brief_date: new Date().toISOString().split('T')[0], sent_at: new Date().toISOString() }).select().single()
    return NextResponse.json({ brief })
  } catch {
    return NextResponse.json({ error: 'parse error' }, { status: 500 })
  }
}