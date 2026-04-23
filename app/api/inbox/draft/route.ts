import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { message } = await request.json()
  const sep = String.fromCharCode(10)
  const prompt = 'Write a short professional reply to this email. Be concise and move toward a next step.' + sep + 'From: ' + (message.from_name || message.from_email || '') + sep + 'Subject: ' + (message.subject || '') + sep + 'Message: ' + (message.body || '') + sep + 'Write only the email body, no subject line.'
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  })
  const draft = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ draft })
}