import Anthropic from '@anthropic-ai/sdk'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContactVars {
  first_name:   string | null
  last_name:    string | null
  company:      string | null
  title:        string | null
  industry:     string | null
  company_size: string | null
  location:     string | null
  linkedin_url: string | null
  sender_name:  string | null
}

export interface CampaignContext {
  persona:    string | null
  angle:      string | null
  value_prop: string | null
}

// ─── Variable renderer ────────────────────────────────────────────────────────
// Smart fallback: {{first_name}} NULL → "there"  (prevents "Hi ,")

export function renderTemplate(template: string, vars: ContactVars): string {
  const fn       = vars.first_name || 'there'
  const ln       = vars.last_name  || ''
  const fullName = vars.first_name
    ? [vars.first_name, ln].filter(Boolean).join(' ')
    : 'there'

  return template
    .replace(/\{\{first_name\}\}/g,  fn)
    .replace(/\{\{last_name\}\}/g,   ln)
    .replace(/\{\{full_name\}\}/g,   fullName)
    .replace(/\{\{company\}\}/g,     vars.company      ?? '')
    .replace(/\{\{title\}\}/g,       vars.title        ?? '')
    .replace(/\{\{sender_name\}\}/g, vars.sender_name  ?? '')
}

// ─── Smart opening line — Sonnet prompt builder ───────────────────────────────

export function buildSmartPrompt(
  vars: ContactVars,
  context: CampaignContext,
  templateBody: string,
): string {
  const name = [vars.first_name, vars.last_name].filter(Boolean).join(' ') || 'not provided'

  return `You are writing the FIRST 1-2 sentences (opening line) of a cold outreach email \
to a B2B prospect. The rest of the email is already written. Your job is ONLY the opening \
line that will hook the reader's attention.

CAMPAIGN CONTEXT:
- Persona: ${context.persona ?? 'not specified'}
- Angle: ${context.angle ?? 'not specified'}
- Value proposition: ${context.value_prop ?? 'not specified'}

PROSPECT:
- Name: ${name}
- Company: ${vars.company ?? 'not provided'}
- Title: ${vars.title ?? 'not provided'}
- LinkedIn: ${vars.linkedin_url ?? 'not provided'}
- Industry: ${vars.industry ?? 'not provided'}
- Company size: ${vars.company_size ?? 'not provided'}
- Location: ${vars.location ?? 'not provided'}

REST OF THE EMAIL (will follow your opening):
${templateBody}

CRITICAL RULES -- anti-fabrication:
- Use ONLY the data provided above. NEVER invent details about the prospect.
- DO NOT invent: recent funding, milestones, named clients, recent posts, events attended, \
or any specific factual claim not in the data.
- If data is sparse (only email, no other fields), keep the opening generic but warm. \
Don't fake specificity.
- DO NOT say "I noticed your recent..." unless you have an explicit data point provided above.
- The opening must connect naturally to the rest of the email below.
- Plain text only. No emojis. No markdown.
- Maximum 2 sentences. Keep it tight.

OUTPUT: Just the 1-2 sentence opening line. No preamble, no quotes, no explanation.`
}

// ─── Sonnet call for opening line ────────────────────────────────────────────
// Returns null on unrecoverable failure (caller falls back to template).

export async function generateOpeningLine(
  client: Anthropic,
  vars: ContactVars,
  context: CampaignContext,
  templateBody: string,
): Promise<string | null> {
  const prompt = buildSmartPrompt(vars, context, templateBody)

  async function attempt(): Promise<string | null> {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 100,
      messages:   [{ role: 'user', content: prompt }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    return text || null
  }

  try {
    return await attempt()
  } catch (err: any) {
    if (err?.status === 429) {
      await new Promise(r => setTimeout(r, 2000))
      try { return await attempt() } catch { return null }
    }
    return null
  }
}

// ─── Smart body assembly ──────────────────────────────────────────────────────
// Replaces first paragraph of rendered body with AI opening line.

export function assembleSmartBody(renderedBody: string, openingLine: string): string {
  const opening = openingLine.trimEnd()
  const firstBlankLine = renderedBody.indexOf('\n\n')
  if (firstBlankLine >= 0) {
    // \n\n is already at the start of the slice — guaranteed blank-line separator
    return opening + renderedBody.slice(firstBlankLine)
  }
  const firstNewline = renderedBody.indexOf('\n')
  if (firstNewline >= 0) {
    // Single-newline body: force \n\n separator, skip the original first line
    return opening + '\n\n' + renderedBody.slice(firstNewline + 1).trimStart()
  }
  // No structure in body — prepend opening, keep full body
  return opening + '\n\n' + renderedBody
}
