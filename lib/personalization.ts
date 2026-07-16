import type Anthropic from '@anthropic-ai/sdk'
import { HUMAN_VOICE_RULES, languageDirective } from '@/lib/ai-voice'
import { logAiCall } from '@/lib/ai-cost'

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
  language?:  string | null
}

// ─── Variable renderer ────────────────────────────────────────────────────────
// Smart fallback: {{first_name}} NULL → "there"  (prevents "Hi ,")

export interface RenderExtras {
  bookingUrl?:      string | null
  meetingDuration?: number | null
}

export function renderTemplate(template: string, vars: ContactVars, extras?: RenderExtras): string {
  const fn       = vars.first_name || 'there'
  const ln       = vars.last_name  || ''
  const fullName = vars.first_name
    ? [vars.first_name, ln].filter(Boolean).join(' ')
    : 'there'

  return template
    .replace(/\{\{first_name\}\}/g,       fn)
    .replace(/\{\{last_name\}\}/g,        ln)
    .replace(/\{\{full_name\}\}/g,        fullName)
    .replace(/\{\{company\}\}/g,          vars.company?.trim() || 'your company')
    .replace(/\{\{title\}\}/g,            vars.title        ?? '')
    .replace(/\{\{sender_name\}\}/g,      vars.sender_name  ?? '')
    .replace(/\{\{booking_link\}\}/g,     extras?.bookingUrl      ?? '{{booking_link}}')
    .replace(/\{\{meeting_duration\}\}/g, String(extras?.meetingDuration ?? 30))
}

// ─── Smart opening line: Sonnet prompt builder ───────────────────────────────

export function buildSmartPrompt(
  vars: ContactVars,
  context: CampaignContext,
  templateBody: string,
): string {
  const name = [vars.first_name, vars.last_name].filter(Boolean).join(' ') || 'not provided'

  return `You are writing the FIRST 1-2 sentences (opening line) of a cold outreach email \
to a B2B prospect. The rest of the email is already written. Your job is ONLY the opening \
line that will hook the reader's attention.

${HUMAN_VOICE_RULES}

${languageDirective(context.language)}

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

CRITICAL RULES -- first name (non-negotiable):
- The prospect's first name (${vars.first_name ?? '<none>'}) must appear EXACTLY ONCE in the whole email — only in the greeting line "Hi {{first_name}}," that already exists below.
- NEVER use the first name again anywhere: not in the opening, not in the body, not in the CTA, not in the sign-off.
- DO NOT start the opening with the first name (e.g., avoid "${vars.first_name ?? 'Bob'}, saw that..."). Open with the hook, situation, or context — not the name.

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
- Each opening line must feel distinct: vary your angle, verb choice, and sentence structure. \
Two prospects in the same industry must NOT receive openings that sound like variations of each other.

OUTPUT: Just the 1-2 sentence opening line. No preamble, no quotes, no explanation.`
}

// ─── Sonnet call for opening line ────────────────────────────────────────────
// Returns null on unrecoverable failure (caller falls back to template).

export async function generateOpeningLine(
  client: Anthropic,
  vars: ContactVars,
  context: CampaignContext,
  templateBody: string,
  workspaceId: string | null,
): Promise<string | null> {
  const prompt = buildSmartPrompt(vars, context, templateBody)

  async function attempt(): Promise<string | null> {
    const msg = await client.messages.create({
      model:       'claude-sonnet-4-6',
      max_tokens:  100,
      temperature: 0.7,
      messages:    [{ role: 'user', content: prompt }],
    })
    void logAiCall({
      source:        'draft_opening_line',
      workspace_id:  workspaceId,
      model:         'claude-sonnet-4-6',
      input_tokens:  msg.usage?.input_tokens  ?? 0,
      output_tokens: msg.usage?.output_tokens ?? 0,
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

// ─── First-name deduplication (conservative) ──────────────────────────────────
// Rule: the prospect's first name must appear at most ONCE in the whole email
// (in the greeting, if the template has one). Sonnet is prompted to comply,
// but this is a belt-and-suspenders guard for the tail cases where the AI
// still restarts the opening with the prospect's name.
//
// Conservative to avoid false positives on names that are also English words
// (Grace, Will, Mark, Bill, Sam, Rob, Chris, Faith, Hope, Joy, Dawn, Sky, …):
//   1. Case-sensitive word-boundary match, so lowercase "will" (modal verb)
//      does not collide with a capitalised "Will".
//   2. Only strip repeats that clearly follow the proper-name-clause pattern
//      "\bName[,:]" at the start of a line/paragraph. Mid-sentence references
//      like "Bob and I discussed" are left untouched.
//   3. If firstName length < 2, do nothing (avoid single-char matches).

const REGEX_META = /[.*+?^${}()|[\]\\]/g

function escapeRegex(s: string): string {
  return s.replace(REGEX_META, '\\$&')
}

/**
 * Removes leading-first-name prefixes from an AI opening line before it is
 * inserted into the body. Example: "Bob, saw that Acme is hiring…" becomes
 * "Saw that Acme is hiring…". Case-sensitive.
 */
export function stripLeadingFirstName(opening: string, firstName: string | null | undefined): string {
  if (!firstName || firstName.length < 2) return opening
  const escaped = escapeRegex(firstName)
  // Matches "Name" or "Name," or "Name:" or "Name –" etc at the start.
  const leadingRe = new RegExp(`^${escaped}[\\s,:;!\\-\\u2013\\u2014]+`)
  const stripped = opening.replace(leadingRe, '').trimStart()
  if (stripped === opening) return opening
  // Recapitalise the new first character if it was mid-sentence (post-comma).
  if (stripped.length > 0 && /^[a-z]/.test(stripped)) {
    return stripped[0].toUpperCase() + stripped.slice(1)
  }
  return stripped
}

/**
 * If the first name appears more than once as an isolated word in the body,
 * strip proper-name-clause repeats — "Name," / "Name:" at the start of a
 * line/paragraph. The standard greeting uses "Hi {{first_name}}," so the
 * greeting is not preceded by `^` or `\n` directly (it has "Hi " in front),
 * meaning this regex leaves the greeting untouched and only strips repeated
 * proper-name-clause openers introduced elsewhere.
 *
 * Never touches mid-sentence references or in-word substrings ("Bob and I
 * discussed" or "Marks" when firstName is "Mark").
 */
export function dedupeFirstNameRepeats(body: string, firstName: string | null | undefined): string {
  if (!firstName || firstName.length < 2) return body
  const escaped = escapeRegex(firstName)
  // Fast check: are there multiple isolated-word occurrences at all?
  const all = new RegExp(`\\b${escaped}\\b`, 'g')
  const matches = body.match(all)
  if (!matches || matches.length <= 1) return body

  // Strip proper-name-clause openers ("Bob," / "Bob:") at the start of a
  // line or paragraph. The greeting "Hi {name}," does not match this pattern
  // (name is preceded by "Hi ", not by `^` or `\n`) and is preserved.
  // After stripping, re-capitalise the first letter of the continuation so
  // "Bob, the way you scaled…" becomes "The way you scaled…" (safe because
  // the strip target is always at the very start of a line).
  const repeatClauseRe = new RegExp(`(^|\\n)${escaped}[,:]\\s?([a-z])?`, 'g')
  return body.replace(repeatClauseRe, (_match, before, firstChar) => {
    if (firstChar) return before + firstChar.toUpperCase()
    return before
  })
}

// ─── Smart body assembly ──────────────────────────────────────────────────────
// Inserts AI opening line after the greeting salutation (if present),
// replacing the first content paragraph. Preserves "Hi {{first_name}}," greeting.
// Format: [greeting]\n\n[AI opening]\n\n[body from 2nd paragraph onward]
//
// The optional firstName argument enables the two-tier first-name dedup guard
// described above. If omitted, the assembler behaves like before.

export function assembleSmartBody(
  renderedBody: string,
  openingLine: string,
  firstName?: string | null,
): string {
  const opening = stripLeadingFirstName(openingLine.trimEnd(), firstName)
  const firstBlank = renderedBody.indexOf('\n\n')

  let assembled: string
  if (firstBlank >= 0) {
    const firstPara      = renderedBody.slice(0, firstBlank).trim()
    const afterFirstBlank = renderedBody.slice(firstBlank + 2)

    // Greeting detected (short line ending with comma, e.g. "Hi Bob,")
    // Preserve greeting, skip original content paragraph, insert AI opening
    if (firstPara.length <= 30 && firstPara.endsWith(',')) {
      const secondBlank = afterFirstBlank.indexOf('\n\n')
      const rest        = secondBlank >= 0 ? afterFirstBlank.slice(secondBlank) : ''
      assembled = firstPara + '\n\n' + opening + rest
    } else {
      // No greeting: replace first paragraph with AI opening, keep the rest
      assembled = opening + '\n\n' + afterFirstBlank
    }
  } else {
    const firstNewline = renderedBody.indexOf('\n')
    if (firstNewline >= 0) {
      assembled = opening + '\n\n' + renderedBody.slice(firstNewline + 1).trimStart()
    } else {
      assembled = opening + '\n\n' + renderedBody
    }
  }

  return dedupeFirstNameRepeats(assembled, firstName)
}
