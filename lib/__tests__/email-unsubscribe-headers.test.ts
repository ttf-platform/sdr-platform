import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Resend } from 'resend'
// ─── Mocks ────────────────────────────────────────────────────────────────
//
// Hermeticite. `sendTemplate` (lib/email.ts) appelle `getEmailTemplate`
// (lib/email-templates.ts), qui instancie `createAdminClient()` et lit la
// table `email_templates`. Sans ce mock, le verdict de ces 5 tests depend de
// l'environnement ambiant : ils passent sur un clone sans `.env` (le client
// Supabase leve « supabaseUrl is required », avale par le try/catch de
// email-templates.ts et retombe sur les defauts du registry), mais ils
// echouent en timeout de 5 s des que NEXT_PUBLIC_SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY existent — un vrai appel reseau part alors.
//
// Le mock reproduit exactement le comportement actuel : aucune ligne en base
// (`{ data: null, error: null }`) → `getEmailTemplate` retombe sur les
// defauts du registry. Les assertions ne sont pas touchees.
//
// Meme convention que les 12 autres fichiers de lib/__tests__ qui mockent ce
// module (reference : lib/__tests__/tier-limits-emails.test.ts:22) : dispatch
// par table, `throw` sur toute table inattendue.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'email_templates') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

// Import APRES le mock, pour que lib/email voie le client mocke.
import {
  __resetResendClientForTests,
  sendOnboardingEmail,
  sendDunningEmail,
  sendBookingConfirmationEmail,
  sendMorningBriefEmail,
} from '../email'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// L9 — Verifie que les DEUX en-tetes RFC 8058 sont poses ensemble quand
// l'appelant passe `unsubscribeUrl`, et JAMAIS quand il ne le passe pas.
// Non-regression cle : les 3 senders hors-perimetre (dunning, booking
// confirmation, admin*) restent SANS en-tete, meme apres l'ajout du
// parametre optionnel a sendTemplate.

type CapturedSend = { headers?: Record<string, string> } & Record<string, unknown>
const captured: CapturedSend[] = []

function makeMockResend(): Resend {
  return {
    emails: {
      send: vi.fn(async (payload: CapturedSend) => {
        captured.push(payload)
        return { data: { id: 'mock-' + captured.length }, error: null }
      }),
    },
  } as unknown as Resend
}

beforeEach(() => {
  captured.length = 0
  __resetResendClientForTests(makeMockResend())
})

afterEach(() => {
  __resetResendClientForTests(null)
})

describe('sendTemplate — headers RFC 8058 poses SEULEMENT si unsubscribeUrl fourni', () => {
  it("sendOnboardingEmail SANS unsubscribeUrl → aucun en-tete", async () => {
    const res = await sendOnboardingEmail({
      to: 'a@b.co', firstName: 'Alice', workspaceName: 'W',
      dayOffset: 0, appBaseUrl: 'https://app.mirvo.ai', locale: 'en',
    })
    expect(res.ok).toBe(true)
    expect(captured.length).toBe(1)
    expect(captured[0].headers).toBeUndefined()
  })

  it("sendOnboardingEmail AVEC unsubscribeUrl → LES DEUX en-tetes", async () => {
    const url = 'https://app.mirvo.ai/api/unsubscribe/abc/lifecycle'
    const res = await sendOnboardingEmail({
      to: 'a@b.co', firstName: 'Alice', workspaceName: 'W',
      dayOffset: 0, appBaseUrl: 'https://app.mirvo.ai', locale: 'en',
      unsubscribeUrl: url,
    })
    expect(res.ok).toBe(true)
    expect(captured[0].headers).toEqual({
      'List-Unsubscribe':      `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it("sendMorningBriefEmail AVEC unsubscribeUrl → LES DEUX en-tetes (kind=brief cote appelant)", async () => {
    const url = 'https://app.mirvo.ai/api/unsubscribe/xyz/brief'
    const res = await sendMorningBriefEmail({
      to: 'a@b.co', firstName: 'Alice',
      content: { mode: 'no_meetings', intro: 'x', market_trends: [{ title: 'T', content: 'C' }] },
      briefDate: '2026-08-02', timeZone: 'UTC',
      appBaseUrl: 'https://app.mirvo.ai', locale: 'en',
      unsubscribeUrl: url,
    })
    expect(res.ok).toBe(true)
    expect(captured[0].headers).toEqual({
      'List-Unsubscribe':      `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it("sendDunningEmail (HORS perimetre) → aucun en-tete, MEME apres l'ajout du parametre optionnel a sendTemplate", async () => {
    const res = await sendDunningEmail({
      to: 'a@b.co', firstName: 'Alice', workspaceName: 'W',
      planTier: 'pro', amountLabel: '$49',
      appBaseUrl: 'https://app.mirvo.ai', hostedInvoiceUrl: null, locale: 'en',
    })
    expect(res.ok).toBe(true)
    expect(captured[0].headers).toBeUndefined()
  })

  it("sendBookingConfirmationEmail (HORS perimetre) → aucun en-tete", async () => {
    const res = await sendBookingConfirmationEmail({
      to: 'attendee@b.co', locale: 'en',
      hostName: 'Alice', dateStr: 'Saturday, August 2, 2026',
      timeStr: '10:00 AM', durationMin: 30, tzLabel: 'America/Toronto',
      confirmUrl: 'https://app.mirvo.ai/book/confirm/abc123', expiresInHours: 24,
    })
    expect(res.ok).toBe(true)
    expect(captured[0].headers).toBeUndefined()
  })
})
