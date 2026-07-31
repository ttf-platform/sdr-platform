// These tests require Node ≥ 18 with full ICU (timeZoneName longOffset).
// No engines field or .nvmrc is pinned in this repo — under an older runtime
// the zero-offset fallback in todayBoundsUTC would silently redden CI without
// any PR to blame. Node 24 LTS is the current default on the Vercel side.

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import {
  buildPromptA,
  buildPromptB,
  extractJsonObject,
  generateMorningBrief,
  todayBoundsUTC,
  type MeetingForBrief,
} from '../morning-brief'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Le module lib/morning-brief.ts est extrait de app/api/morning-brief/generate/
// route.ts sans changement de comportement (lot 2 Morning Brief). Ces tests
// verrouillent le contrat qui rend l'extraction sûre :
//
//   - todayBoundsUTC est déterministe quand on lui passe `now` explicite ;
//   - extractJsonObject factorise EXACTEMENT les trois lignes indexOf /
//     lastIndexOf / slice (pas le ternaire content[0].type) ;
//   - les deux consignes portent l'interdiction de nommer des fournisseurs ;
//   - un score de profil sous 30 rend la garde d'éligibilité EFFECTIVE : zéro
//     appel au modèle (c'est ce test qui prouve la protection du budget, et
//     que le cron du lot 4 réutilisera tel quel).
//
// Le fichier importe UNIQUEMENT @/lib/morning-brief — pas app/api/**/route.ts,
// qui tire next/server, le client Supabase et le SDK Anthropic.

// ═══════════════════════════════════════════════════════════════════════════
// todayBoundsUTC — timezone-aware start/end of "today"
// ═══════════════════════════════════════════════════════════════════════════

describe('todayBoundsUTC — bornes UTC de la journée locale', () => {
  it("America/Toronto en juillet (EDT, GMT-04:00) : dateStr='2026-07-15', start=04h UTC, end=03h59:59.999 UTC lendemain", () => {
    // 15 juillet 2026 à midi UTC = 8 h locale EDT à Toronto → jour local reste 2026-07-15.
    const now = new Date('2026-07-15T12:00:00Z')
    const { start, end, dateStr } = todayBoundsUTC('America/Toronto', now)
    expect(dateStr).toBe('2026-07-15')
    expect(start.getTime()).toBe(new Date('2026-07-15T04:00:00Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-07-16T03:59:59.999Z').getTime())
  })

  it("Europe/Paris en janvier (CET, GMT+01:00) : dateStr='2026-01-15', start=-01:00 la veille", () => {
    const now = new Date('2026-01-15T12:00:00Z')
    const { start, end, dateStr } = todayBoundsUTC('Europe/Paris', now)
    expect(dateStr).toBe('2026-01-15')
    expect(start.getTime()).toBe(new Date('2026-01-14T23:00:00Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-01-15T22:59:59.999Z').getTime())
  })

  it("Asia/Kolkata (GMT+05:30, pas de DST) : décalage fractionnaire préservé", () => {
    // Anti-régression sur l'arithmétique demi-heure — un impl à heures pleines
    // seulement casserait ici.
    const now = new Date('2026-07-15T12:00:00Z')
    const { start, end, dateStr } = todayBoundsUTC('Asia/Kolkata', now)
    expect(dateStr).toBe('2026-07-15')
    expect(start.getTime()).toBe(new Date('2026-07-14T18:30:00Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-07-15T18:29:59.999Z').getTime())
  })

  it('UTC : dateStr est la date UTC brute, start = 00:00Z, end = 23:59:59.999Z', () => {
    const now = new Date('2026-07-15T12:00:00Z')
    const { start, end, dateStr } = todayBoundsUTC('UTC', now)
    expect(dateStr).toBe('2026-07-15')
    expect(start.getTime()).toBe(new Date('2026-07-15T00:00:00Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-07-15T23:59:59.999Z').getTime())
  })

  it("DOCUMENTE le défaut DST — America/Toronto, jour de bascule automne, start décalé de +1h", () => {
    // Le 1er novembre 2026 à Toronto, DST se termine à 2 AM EDT (les horloges
    // reculent d'une heure vers 1 AM EST). On échantillonne un instant en
    // milieu de matinée locale (donc APRÈS la bascule, décalage EST/GMT moins
    // cinq). todayBoundsUTC prend ce décalage pour construire minuit local du
    // jour — sauf que le vrai minuit local était encore EDT (GMT moins quatre,
    // avant 2 AM). Résultat : dayStart est UNE HEURE APRÈS le vrai minuit
    // local. Ce test PIN le comportement défectueux actuel ; le lot 2 bis
    // (Morning Brief) renversera explicitement l'assertion.
    const now              = new Date('2026-11-01T15:00:00Z')
    const { start }        = todayBoundsUTC('America/Toronto', now)
    const trueMidnightEdtZ = new Date('2026-11-01T04:00:00Z').getTime()
    expect(start.getTime() - trueMidnightEdtZ).toBe(60 * 60 * 1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// extractJsonObject — factorisation des 3 lignes indexOf/lastIndexOf/slice
// ═══════════════════════════════════════════════════════════════════════════

describe('extractJsonObject — extraction du bloc {...} d\'une réponse modèle', () => {
  it('JSON propre : rendu tel quel', () => {
    expect(extractJsonObject('{"a":1,"b":2}')).toBe('{"a":1,"b":2}')
  })

  it('JSON entouré de texte : découpe entre le premier { et le dernier }', () => {
    expect(extractJsonObject('preamble {"a":1} epilogue')).toBe('{"a":1}')
  })

  it("accolades dans une valeur de chaîne : lastIndexOf attrape le vrai }, la valeur est préservée", () => {
    expect(extractJsonObject('{"a":"hello { world }"}')).toBe('{"a":"hello { world }"}')
  })

  it("aucune accolade : rend '{}' (comportement actuel, préservé)", () => {
    expect(extractJsonObject('no json here')).toBe('{}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// buildPromptA / buildPromptB
// ═══════════════════════════════════════════════════════════════════════════

describe('buildPromptA — Mode A, jour sans rendez-vous', () => {
  const base = {
    firstName:      'Alice',
    today:          '2026-07-15',
    profile:        { company_name: 'Acme', product_description: 'SaaS', icp_description: 'CTOs', tone: 'friendly' },
    campaignsCount: 3,
    totalSent:      120,
    replyRate:      '4.2',
    prospectCount:  4200,
  }

  it("porte firstName et today, et l'interdiction de nommer des fournisseurs", () => {
    const p = buildPromptA(base)
    expect(p).toContain('Alice')
    expect(p).toContain('2026-07-15')
    expect(p).toContain('Never name specific software vendors')
  })

  it("interpolation profil : company/product/icp/tone présents", () => {
    const p = buildPromptA(base)
    expect(p).toContain('Company: Acme')
    expect(p).toContain('Product: SaaS')
    expect(p).toContain('ICP: CTOs')
    expect(p).toContain('Tone: friendly')
  })

  it("profil null : fallbacks 'their company' / 'B2B product' / 'B2B buyers' / 'professional'", () => {
    const p = buildPromptA({ ...base, profile: null })
    expect(p).toContain('Company: their company')
    expect(p).toContain('Product: B2B product')
    expect(p).toContain('ICP: B2B buyers')
    expect(p).toContain('Tone: professional')
  })
})

describe('buildPromptB — Mode B, rendez-vous du jour', () => {
  const profile = { company_name: 'Acme', product_description: 'SaaS', icp_description: 'CTOs', tone: 'friendly' }
  const meeting = (i: number): MeetingForBrief => ({
    meeting_at:     `2026-07-15T${String(9 + i).padStart(2, '0')}:00:00Z`,
    duration_min:   30,
    attendee_name:  `Bob ${i}`,
    attendee_email: `bob${i}@example.com`,
    company_name:   `Co ${i}`,
    notes:          null,
  })

  it("porte firstName, today, et l'interdiction de nommer des fournisseurs", () => {
    const p = buildPromptB({ firstName: 'Alice', today: '2026-07-15', profile, meetings: [meeting(1)] })
    expect(p).toContain('Alice')
    expect(p).toContain('2026-07-15')
    expect(p).toContain('Never name specific software vendors')
  })

  it("N=1 : singulier 'meeting', 'item', et exactement 1 bloc 'Meeting 1:'", () => {
    const p = buildPromptB({ firstName: 'Alice', today: '2026-07-15', profile, meetings: [meeting(1)] })
    expect(p).toContain('1 meeting today')
    expect(p).toContain('1 meeting scheduled today')
    expect(p).toContain('exactly 1 item,')
    expect((p.match(/Meeting \d+:/g) ?? []).length).toBe(1)
    expect(p).toContain('Meeting 1:')
  })

  it("N=3 : pluriel 'meetings', 'items', et exactement 3 blocs 'Meeting k:'", () => {
    const meetings = [meeting(1), meeting(2), meeting(3)]
    const p = buildPromptB({ firstName: 'Alice', today: '2026-07-15', profile, meetings })
    expect(p).toContain('3 meetings today')
    expect(p).toContain('3 meetings scheduled today')
    expect(p).toContain('exactly 3 items,')
    expect((p.match(/Meeting \d+:/g) ?? []).length).toBe(3)
    expect(p).toContain('Meeting 1:')
    expect(p).toContain('Meeting 2:')
    expect(p).toContain('Meeting 3:')
  })

  it("notes du user présentes : injectées telles quelles (assainissement au lot 3 Morning Brief)", () => {
    const m = { ...meeting(1), notes: 'urgent renewal' }
    const p = buildPromptB({ firstName: 'Alice', today: '2026-07-15', profile, meetings: [m] })
    expect(p).toContain('Notes from user: urgent renewal')
  })

  it("attendee/company manquants : fallback 'Unknown'", () => {
    const m: MeetingForBrief = { ...meeting(1), attendee_name: null, company_name: null }
    const p = buildPromptB({ firstName: 'Alice', today: '2026-07-15', profile, meetings: [m] })
    expect(p).toContain('Attendee: Unknown (')
    expect(p).toContain('Company: Unknown')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// generateMorningBrief — end-to-end avec faux admin + faux client
// ═══════════════════════════════════════════════════════════════════════════

// ── Fakes minimalistes ---------------------------------------------------

type FakeQueryResult = { data: unknown; error?: unknown; count?: number | null }

// Un query-builder qui gobe indistinctement select/eq/gte/lte/order, résout
// via .single() OU en tant que thenable, et rend TOUJOURS le même result.
function makeBuilder(result: FakeQueryResult) {
  const settled = Promise.resolve(result)
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq:     () => builder,
    gte:    () => builder,
    lte:    () => builder,
    order:  () => builder,
    single: () => settled,
    then:   (onF: (v: FakeQueryResult) => unknown, onR?: (e: unknown) => unknown) => settled.then(onF, onR),
  }
  return builder
}

function makeAdmin(opts: {
  profile?:  FakeQueryResult
  campaigns?: FakeQueryResult
  prospects?: FakeQueryResult
  owner?:     FakeQueryResult
  meetings?:  FakeQueryResult
  ownerData?: unknown
}): SupabaseClient {
  const byTable: Record<string, FakeQueryResult> = {
    workspace_profiles: opts.profile   ?? { data: null },
    campaigns:          opts.campaigns ?? { data: [] },
    prospects:          opts.prospects ?? { data: null, count: 0 },
    workspace_members:  opts.owner     ?? { data: null },
    meetings:           opts.meetings  ?? { data: [] },
  }
  const admin = {
    from: (table: string) => makeBuilder(byTable[table] ?? { data: null }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: opts.ownerData ?? { user: null } }),
      },
    },
  }
  return admin as unknown as SupabaseClient
}

function makeClient(msg: {
  content: Array<{ type: string; text?: string }>
  usage?:  { input_tokens?: number; output_tokens?: number }
}): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(msg)
  const client = { messages: { create } } as unknown as Anthropic
  return { client, create }
}

function makeFailingClient(err: unknown): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockRejectedValue(err)
  const client = { messages: { create } } as unknown as Anthropic
  return { client, create }
}

// Profil scoré ≥ 30 : on remplit assez de critères pour que
// calculateProfileScore rende ≥ 30. Voir lib/profile-quality.ts.
const RICH_PROFILE = {
  user_industry:       'SaaS',
  user_company_size:   '11-50',
  product_description: 'A B2B product description that easily exceeds thirty characters in length.',
  value_proposition:   'A value proposition that exceeds twenty chars.',
  icp_description:     'ICP description that exceeds thirty characters comfortably here.',
  icp_industries:      ['Tech'],
  target_titles:       'CTO',
  target_regions:      'EU',
  pain_points:         'A pain point of at least twenty characters.',
  tone:                'friendly',
  company_name:        'Acme',
  booking_config:      { timezone: 'UTC' },
}

describe('generateMorningBrief — orchestration complète', () => {
  it("profile_score < 30 : rend profile_score_too_low ET N'APPELLE PAS le modèle (garde du budget)", async () => {
    // Le test-clé du lot : c'est celui que le cron du lot 4 réutilisera tel
    // quel pour prouver qu'un profil vide ne brûle pas de token.
    const admin = makeAdmin({ profile: { data: {} } })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 0, output_tokens: 0 },
    })

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result).toEqual({ ok: false, reason: 'profile_score_too_low' })
    expect(create).not.toHaveBeenCalled()
  })

  it("profil OK, zéro meeting : mode A, briefDate = dateStr de UTC 'today'", async () => {
    const admin = makeAdmin({
      profile:  { data: RICH_PROFILE },
      meetings: { data: [] },
    })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{"mode":"no_meetings"}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('A')
      expect(result.content).toEqual({ mode: 'no_meetings' })
      expect(result.briefDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].max_tokens).toBe(3000)
  })

  it("profil OK, un meeting : mode B (bascule dès qu'il y a ≥ 1 meeting)", async () => {
    const meetings = [{
      meeting_at:     new Date().toISOString(),
      duration_min:   30,
      attendee_name:  'Bob',
      attendee_email: 'bob@example.com',
      company_name:   'Co',
      notes:          null,
    }]
    const admin = makeAdmin({
      profile:  { data: RICH_PROFILE },
      meetings: { data: meetings },
    })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{"mode":"meetings_today"}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('B')
      expect(result.content).toEqual({ mode: 'meetings_today' })
    }
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].max_tokens).toBe(2500)
  })

  it("appel modèle qui jette : rend ai_unavailable avec detail", async () => {
    const admin = makeAdmin({ profile: { data: RICH_PROFILE } })
    const { client } = makeFailingClient(new Error('boom'))

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result).toEqual({ ok: false, reason: 'ai_unavailable', detail: 'boom' })
  })

  it("réponse illisible : rend ai_unparseable (le JSON.parse reste hors du try messages.create)", async () => {
    const admin = makeAdmin({ profile: { data: RICH_PROFILE } })
    const { client } = makeClient({
      // extractJsonObject('prefix {not: valid} tail') = '{not: valid}' → JSON.parse jette.
      content: [{ type: 'text', text: 'prefix {not: valid} tail' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result).toEqual({ ok: false, reason: 'ai_unparseable' })
  })

  it("firstName : lu depuis user_metadata.full_name (premier prénom), 'there' à défaut", async () => {
    const admin = makeAdmin({
      profile:   { data: RICH_PROFILE },
      owner:     { data: { user_id: 'usr-1' } },
      ownerData: { user: { user_metadata: { full_name: 'Alice Wonderland' }, email: 'alice@example.com' } },
    })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 0, output_tokens: 0 },
    })

    await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    const prompt = create.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('User first name: Alice')
  })
})
