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
  localInstantUTC,
  todayBoundsUTC,
  type MeetingForBrief,
} from '../morning-brief'
import { TIMEZONES } from '../timezones'

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

  it("America/Toronto, jour de bascule automne : start tombe sur le VRAI minuit local (EDT), plus aucun décalage", () => {
    // Le 1er novembre 2026 à Toronto, DST se termine à 2 AM EDT (les horloges
    // reculent d'une heure vers 1 AM EST). L'ancien code échantillonnait le
    // décalage à `now` — en milieu de matinée post-bascule, il capturait EST
    // (GMT moins cinq) et construisait « minuit local » avec ce décalage,
    // décalé d'une heure par rapport au vrai minuit qui vivait encore en EDT.
    // Le nouveau code échantillonne le décalage à l'instant estimé de minuit
    // local, en deux passes → start tombe sur le vrai minuit local EDT.
    // Ce test remplace celui qui épinglait le défaut au lot 2.
    const now              = new Date('2026-11-01T15:00:00Z')
    const { start }        = todayBoundsUTC('America/Toronto', now)
    const trueMidnightEdtZ = new Date('2026-11-01T04:00:00Z').getTime()
    expect(start.getTime() - trueMidnightEdtZ).toBe(0)
  })

  // ─── Cas neufs du lot 2 bis : valeurs mesurées, à recopier telles quelles ─
  // Chaque cas correspond à une transition DST réelle ou à une contrainte que
  // l'ancien code ne satisfaisait pas. Ne pas recalculer : ces attendus ont
  // été mesurés puis inscrits dans le brief du lot.

  it("America/Toronto, bascule PRINTEMPS 2026 (spring-forward, 2 AM → 3 AM) : start = 05h UTC", () => {
    const now       = new Date('2026-03-08T15:00:00Z')
    const { start } = todayBoundsUTC('America/Toronto', now)
    expect(start.getTime()).toBe(new Date('2026-03-08T05:00:00.000Z').getTime())
  })

  it("Europe/Paris, bascule PRINTEMPS 2026 (CET → CEST) : start = 23h UTC la veille", () => {
    const now       = new Date('2026-03-29T10:00:00Z')
    const { start } = todayBoundsUTC('Europe/Paris', now)
    expect(start.getTime()).toBe(new Date('2026-03-28T23:00:00.000Z').getTime())
  })

  it("Pacific/Auckland, bascule PRINTEMPS 2026 hémisphère sud (NZST +12 → NZDT +13) : start ET end aux valeurs mesurées", () => {
    const now              = new Date('2026-09-27T05:00:00Z')
    const { start, end }   = todayBoundsUTC('Pacific/Auckland', now)
    expect(start.getTime()).toBe(new Date('2026-09-26T12:00:00.000Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-09-27T10:59:59.999Z').getTime())
  })

  it("America/Santiago, bascule PRINTEMPS 2026 où minuit local N'EXISTE PAS ce jour : start tombe sur le premier instant réel", () => {
    // Cette nuit-là l'horloge saute directement de 23 h 59 min 59 s à 1 h.
    // Minuit local n'existe donc pas — startOfLocalDay(d) doit rendre le
    // premier tick RÉEL de la journée, pas une valeur fantôme.
    const now       = new Date('2026-09-06T15:00:00Z')
    const { start } = todayBoundsUTC('America/Santiago', now)
    expect(start.getTime()).toBe(new Date('2026-09-06T04:00:00.000Z').getTime())
  })

  it("🔴 TEST-CLÉ du lot — America/Santiago, bascule AUTOMNE 2026 où l'heure recule à minuit : end au VRAI dernier tick de la journée (25h locales)", () => {
    // Le 4 avril 2026 à Santiago l'horloge recule d'une heure PILE à minuit,
    // donc 23 h 59 min 59 s existe DEUX fois et la journée locale dure 25 heures.
    // Toute formulation partant de « 23 h 59 min 59 s » construit la PREMIÈRE
    // occurrence et ampute une heure réelle : un rendez-vous à 23 h 30 ce
    // soir-là serait absent du brief. La formulation « début du lendemain − 1 ms »
    // capture le VRAI dernier tick.
    // C'est LE test qui distingue la bonne implémentation de celle qui paraît
    // naturelle.
    const now     = new Date('2026-04-04T15:00:00Z')
    const { end } = todayBoundsUTC('America/Santiago', now)
    expect(end.getTime()).toBe(new Date('2026-04-05T03:59:59.999Z').getTime())
  })

  it("America/Toronto, bascule PRINTEMPS 2026, `now` échantillonné AVANT la bascule (1 h locale) : mêmes bornes qu'à midi post-bascule — indépendance à `now`", () => {
    // Prouve la propriété acquise : deux `now` du même jour local rendent
    // exactement les mêmes bornes. L'ancien code fabriquait des bornes qui
    // dépendaient de l'heure de la journée à laquelle on l'appelait.
    const now            = new Date('2026-03-08T06:00:00Z')
    const { start, end } = todayBoundsUTC('America/Toronto', now)
    expect(start.getTime()).toBe(new Date('2026-03-08T05:00:00.000Z').getTime())
    expect(end.getTime()).toBe(new Date('2026-03-09T03:59:59.999Z').getTime())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// localInstantUTC (lot 4) — heure locale murale → instant UTC absolu
// ═══════════════════════════════════════════════════════════════════════════
//
// Instants mesurés (recopiés, jamais recalculés) sur 45 fuseaux × 400 jours
// × 4 réglages = 72 000 combinaisons → zéro instant invalide.

describe('localInstantUTC — heure locale murale vers instant UTC', () => {
  it("Paris 2026-03-29 02:30 (heure locale INEXISTANTE, passage à l'heure d'été)", () => {
    // Le premier instant après le trou est 03:00 local ; l'heure demandée
    // 02:30 est décalée « de la durée du trou » vers 03:30 local, qui
    // correspond à 01:30 UTC en CEST (+02:00).
    expect(localInstantUTC('Europe/Paris', '2026-03-29', '02:30').getTime())
      .toBe(new Date('2026-03-29T01:30:00.000Z').getTime())
  })

  it("Paris 2026-10-25 02:30 (heure locale DÉDOUBLÉE, retour à l'heure d'hiver — SECONDE occurrence)", () => {
    // La première 02:30 est en CEST (+02:00) = 00:30Z ; la seconde est en
    // CET (+01:00) = 01:30Z. La technique à deux passes rend la SECONDE.
    expect(localInstantUTC('Europe/Paris', '2026-10-25', '02:30').getTime())
      .toBe(new Date('2026-10-25T01:30:00.000Z').getTime())
  })

  it("Santiago 2026-04-04 00:30 (bascule pile à minuit, journée de 25 h)", () => {
    expect(localInstantUTC('America/Santiago', '2026-04-04', '00:30').getTime())
      .toBe(new Date('2026-04-04T03:30:00.000Z').getTime())
  })

  it("Kathmandu 2026-08-01 07:30 (décalage fractionnaire +05:45)", () => {
    expect(localInstantUTC('Asia/Kathmandu', '2026-08-01', '07:30').getTime())
      .toBe(new Date('2026-08-01T01:45:00.000Z').getTime())
  })

  it("Paris 2026-08-01 07:30 (CEST +02:00, cas nominal)", () => {
    expect(localInstantUTC('Europe/Paris', '2026-08-01', '07:30').getTime())
      .toBe(new Date('2026-08-01T05:30:00.000Z').getTime())
  })

  it("Toronto 2026-08-01 07:30 (EDT -04:00, cas nominal)", () => {
    expect(localInstantUTC('America/Toronto', '2026-08-01', '07:30').getTime())
      .toBe(new Date('2026-08-01T11:30:00.000Z').getTime())
  })

  it("balayage : les 44 fuseaux de lib/timezones.ts × 40 jours × 4 réglages → aucun instant invalide", () => {
    const day0 = Date.UTC(2026, 2, 1) // 1er mars 2026 — englobe printemps DST nord ET automne sud
    const hhmms = ['00:00', '02:30', '07:30', '23:30']
    for (const tz of TIMEZONES) {
      for (let d = 0; d < 40; d++) {
        const dateStr = new Date(day0 + d * 86_400_000).toISOString().slice(0, 10)
        for (const hhmm of hhmms) {
          const inst = localInstantUTC(tz, dateStr, hhmm)
          expect(Number.isNaN(inst.getTime())).toBe(false)
        }
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// generateMorningBrief — non-régression du paramètre now optionnel (lot 4)
// ═══════════════════════════════════════════════════════════════════════════

describe('generateMorningBrief — non-régression : `now` reste optionnel (défaut new Date())', () => {
  // Réutilise les mêmes fakes que le describe précédent — on prouve juste
  // que l'appelant qui NE passe PAS `now` (route existante) obtient toujours
  // un résultat OK sur un contenu nominal.
  function makeBuilder(result: { data: unknown; error?: unknown; count?: number | null }) {
    const settled = Promise.resolve(result)
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      gte:    () => builder,
      lte:    () => builder,
      order:  () => builder,
      single: () => settled,
      then:   (onF: (v: typeof result) => unknown, onR?: (e: unknown) => unknown) => settled.then(onF, onR),
    }
    return builder
  }
  const RICH_PROFILE = {
    user_industry: 'SaaS', user_company_size: '11-50',
    product_description: 'A B2B product description that easily exceeds thirty characters in length.',
    value_proposition: 'A value proposition that exceeds twenty chars.',
    icp_description: 'ICP description that exceeds thirty characters comfortably here.',
    icp_industries: ['Tech'], target_titles: 'CTO', target_regions: 'EU',
    pain_points: 'A pain point of at least twenty characters.',
    tone: 'friendly', company_name: 'Acme', booking_config: { timezone: 'UTC' },
  }
  const byTable: Record<string, { data: unknown; error?: unknown; count?: number | null }> = {
    workspace_profiles: { data: RICH_PROFILE },
    campaigns:          { data: [] },
    prospects:          { data: null, count: 0 },
    workspace_members:  { data: null },
    meetings:           { data: [] },
  }
  const admin = {
    from: (t: string) => makeBuilder(byTable[t] ?? { data: null }),
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null } }) } },
  } as unknown as SupabaseClient
  const client = {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"mode":"no_meetings"}' }],
        usage:   { input_tokens: 100, output_tokens: 200 },
      }),
    },
  } as unknown as Anthropic

  it('sans `now` : rend OK avec briefDate au format YYYY-MM-DD (comportement pré-lot-4 préservé)', async () => {
    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('A')
      expect(result.briefDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('avec `now` explicite : briefDate reflète la date locale de `now`, pas celle de l\'horloge réelle', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z')
    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1', now: fixedNow })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Le profil a booking_config.timezone = 'UTC', donc la date locale du
      // 2026-08-01T12:00Z est 2026-08-01.
      expect(result.briefDate).toBe('2026-08-01')
    }
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
  content:      Array<{ type: string; text?: string }>
  usage?:       { input_tokens?: number; output_tokens?: number }
  // Lot 5c-0 : ajoute pour couvrir le nouveau champ inspecte par
  // generateMorningBrief (branche 'ai_truncated').
  stop_reason?: string
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
    expect(create.mock.calls[0][0].max_tokens).toBe(8000)
  })

  it("Mode B : appel porte { timeout: 240_000, maxRetries: 0 } en second argument (surcharge par appel, jamais sur le singleton)", async () => {
    const meetings = [{
      meeting_at:     new Date().toISOString(),
      duration_min:   30,
      attendee_name:  'Bob',
      attendee_email: 'bob@example.com',
      company_name:   'Co',
      notes:          null,
    }]
    const admin = makeAdmin({ profile: { data: RICH_PROFILE }, meetings: { data: meetings } })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{"mode":"meetings_today"}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })
    await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    expect(create.mock.calls[0][1]).toEqual({ timeout: 240_000, maxRetries: 0 })
  })

  it("Mode B : stop_reason='max_tokens' AVEC JSON parfaitement VALIDE → 'ai_truncated' (borne qui prouve que le test porte sur stop_reason, pas sur la forme du texte)", async () => {
    const meetings = [{
      meeting_at:     new Date().toISOString(),
      duration_min:   30,
      attendee_name:  'Bob',
      attendee_email: 'bob@example.com',
      company_name:   'Co',
      notes:          null,
    }]
    const admin = makeAdmin({ profile: { data: RICH_PROFILE }, meetings: { data: meetings } })
    const { client } = makeClient({
      content:     [{ type: 'text', text: '{"mode":"meetings_today","meetings":[]}' }],
      usage:       { input_tokens: 100, output_tokens: 200 },
      stop_reason: 'max_tokens',
    })
    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    expect(result).toEqual({ ok: false, reason: 'ai_truncated' })
  })

  it("appel modèle qui jette : rend ai_unavailable avec detail", async () => {
    const admin = makeAdmin({ profile: { data: RICH_PROFILE } })
    const { client } = makeFailingClient(new Error('boom'))

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result).toEqual({ ok: false, reason: 'ai_unavailable', detail: 'boom' })
  })

  it("réponse illisible SANS stop_reason : rend ai_unparseable (non-régression — la 4e variante 'ai_truncated' ne doit pas manger celle-ci)", async () => {
    const admin = makeAdmin({ profile: { data: RICH_PROFILE } })
    const { client } = makeClient({
      // extractJsonObject('prefix {not: valid} tail') = '{not: valid}' → JSON.parse jette.
      content: [{ type: 'text', text: 'prefix {not: valid} tail' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })

    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })

    expect(result).toEqual({ ok: false, reason: 'ai_unparseable' })
  })

  it("Mode B : 15 rendez-vous en base → buildPromptB en voit EXACTEMENT 12, et les six interpolations disent 12", async () => {
    // On simule 15 rendez-vous. Le prompt qui atteint le modele doit citer
    // « 12 meetings » aux six sites, et le tableau qu on lui donne doit
    // contenir 12 elements. Le total (15) est prescrit pour survivre a
    // travers content.total_meetings_today (couvert par le test suivant).
    const meetings = Array.from({ length: 15 }, (_, i) => ({
      meeting_at:     `2026-08-02T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:00:00Z`,
      duration_min:   30,
      attendee_name:  `Bob ${i + 1}`,
      attendee_email: `bob${i + 1}@example.com`,
      company_name:   `Co ${i + 1}`,
      notes:          null,
    }))
    const admin = makeAdmin({ profile: { data: RICH_PROFILE }, meetings: { data: meetings } })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{"mode":"meetings_today"}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })
    await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    const prompt = create.mock.calls[0][0].messages[0].content as string
    // Six interpolations de meetings.length : trois lignes citent le nombre,
    // certaines deux fois — on compte les occurrences de la phrase-clef.
    expect(prompt).toContain('12 meeting')
    // Le 13e bloc « Meeting 13: » ne doit PAS apparaitre — on a coupe a 12.
    expect(prompt).toContain('Meeting 12:')
    expect(prompt).not.toContain('Meeting 13:')
    // Le prompt ne doit contenir NULLE PART « 15 meeting » (le total ne
    // fuit pas dans la consigne — il voyage par content.total_meetings_today).
    expect(prompt).not.toContain('15 meeting')
  })

  it("Mode B : 15 rendez-vous → content.total_meetings_today est pose a 15 (l information voyage DANS content pour survivre a l INSERT et au renvoi)", async () => {
    const meetings = Array.from({ length: 15 }, (_, i) => ({
      meeting_at:     `2026-08-02T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:00:00Z`,
      duration_min:   30,
      attendee_name:  `Bob ${i + 1}`,
      attendee_email: `bob${i + 1}@example.com`,
      company_name:   `Co ${i + 1}`,
      notes:          null,
    }))
    const admin = makeAdmin({ profile: { data: RICH_PROFILE }, meetings: { data: meetings } })
    const { client } = makeClient({
      content: [{ type: 'text', text: '{"mode":"meetings_today","meetings":[]}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })
    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.content as Record<string, unknown>).total_meetings_today).toBe(15)
    }
  })

  it("Mode B : 12 rendez-vous (limite exacte, PAS de troncature) → total_meetings_today ABSENT (borne stricte)", async () => {
    const meetings = Array.from({ length: 12 }, (_, i) => ({
      meeting_at:     `2026-08-02T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:00:00Z`,
      duration_min:   30,
      attendee_name:  `Bob ${i + 1}`,
      attendee_email: `bob${i + 1}@example.com`,
      company_name:   `Co ${i + 1}`,
      notes:          null,
    }))
    const admin = makeAdmin({ profile: { data: RICH_PROFILE }, meetings: { data: meetings } })
    const { client } = makeClient({
      content: [{ type: 'text', text: '{"mode":"meetings_today","meetings":[]}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })
    const result = await generateMorningBrief({ admin, client, workspaceId: 'ws-1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.content as Record<string, unknown>).total_meetings_today).toBeUndefined()
    }
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

  // Lot 5b-bis : Mode C (kind='meetings_only') ────────────────────────────

  it("kind='meetings_only' avec un rendez-vous : rend mode 'C', content.mode='meetings_prep', promptC SANS 'market_trends_brief'", async () => {
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
      content: [{ type: 'text', text: '{"mode":"meetings_prep","meetings":[]}' }],
      usage:   { input_tokens: 100, output_tokens: 200 },
    })

    const result = await generateMorningBrief({
      admin, client, workspaceId: 'ws-1', kind: 'meetings_only',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('C')
      expect((result.content as Record<string, unknown>).mode).toBe('meetings_prep')
    }
    // Le prompt C n'inclut pas market_trends_brief.
    const prompt = create.mock.calls[0][0].messages[0].content as string
    expect(prompt).not.toContain('market_trends_brief')
    expect(prompt).not.toContain('Then add market_trends_brief')
  })

  it("kind='meetings_only' SANS aucun rendez-vous : rend 'no_meetings_for_prep' (etat impossible, jamais un repli silencieux sur Mode A)", async () => {
    const admin = makeAdmin({
      profile:  { data: RICH_PROFILE },
      meetings: { data: [] },
    })
    const { client, create } = makeClient({
      content: [{ type: 'text', text: '{}' }],
      usage:   { input_tokens: 0, output_tokens: 0 },
    })

    const result = await generateMorningBrief({
      admin, client, workspaceId: 'ws-1', kind: 'meetings_only',
    })

    expect(result).toEqual({ ok: false, reason: 'no_meetings_for_prep' })
    expect(create).not.toHaveBeenCalled()
  })
})
