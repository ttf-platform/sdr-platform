import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROSPECT_EMAIL_LIST_COLUMNS, PROSPECT_EMAIL_CLIENT_COLUMNS } from '@/lib/prospect-email-columns'

// ─── TD-002 lot 2 — le contrat entre le serveur et l'écran ─────────────────
//
// Deux garanties de nature différente :
//   1. aucun détail technique ni nom de fournisseur ne franchit la frontière
//      serveur → navigateur ;
//   2. l'écran reçoit l'information nécessaire pour n'afficher « Réessayer »
//      que lorsque le serveur classe la reprise comme sûre.
//
// La seconde ne demande plus aucune dérivation : `retry_safe` est une colonne
// typée et vendor-free, donc elle voyage telle quelle. C'est la simplification
// qu'a apportée l'abandon de send_error comme porteur.

const cols = (list: string) => list.split(',').map(c => c.trim()).filter(Boolean)

describe('TD-002 — la frontière serveur → navigateur', () => {
  it("PREUVE 21 — retry_safe est exposé à l'écran (il est typé et vendor-free)", () => {
    expect(cols(PROSPECT_EMAIL_LIST_COLUMNS)).toContain('retry_safe')
  })

  it("PREUVE 22 — send_error ne franchit JAMAIS la frontière, sur aucune des deux projections", () => {
    // Il porte "[InstantlyProvider.…]" et plusieurs auteurs y écrivent.
    expect(cols(PROSPECT_EMAIL_LIST_COLUMNS)).not.toContain('send_error')
    expect(cols(PROSPECT_EMAIL_CLIENT_COLUMNS)).not.toContain('send_error')
  })

  it("PREUVE 23 — la réponse d'approbation ne porte pas retry_safe", () => {
    // Elle n'en a pas besoin : l'écran recharge la liste. Ne pas l'y ajouter
    // évite un second porteur de la même information.
    expect(cols(PROSPECT_EMAIL_CLIENT_COLUMNS)).not.toContain('retry_safe')
  })
})

// ─── Parité et propreté des libellés ───────────────────────────────────────

type Dict = Record<string, unknown>
const load = (loc: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', `${loc}.json`), 'utf8')) as Dict
const at = (d: Dict, path: string[]) =>
  path.reduce<unknown>((acc, k) => (acc as Dict)?.[k], d)

const NEW_KEYS: [string[], string][] = [
  [['dashboard', 'campaigns', 'detail', 'emailStatuses'], 'failed'],
  [['dashboard', 'campaigns', 'detail', 'emails'],        'cardRetry'],
  [['dashboard', 'campaigns', 'detail', 'emails'],        'cardRetryUnavailable'],
  [['dashboard', 'campaigns', 'detail', 'toasts'],        'retryUnsafe'],
  [['dashboard', 'campaigns', 'detail', 'toasts'],        'bulkApprovePartial'],
  [['dashboard', 'campaigns', 'detail', 'toasts'],        'bulkDeleteSkipped'],
  [['dashboard', 'approvals', 'errors'],                  'retry_unsafe'],
  [['components', 'emailModals', 'errors'],               'retryUnsafe'],
]

describe('TD-002 — libellés', () => {
  const fr = load('fr')
  const en = load('en')

  it.each(NEW_KEYS)('PREUVE 24 — %j.%s existe en FR et en EN', (path, key) => {
    for (const dict of [fr, en]) {
      const value = (at(dict, path) as Dict)?.[key]
      expect(typeof value).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
    }
  })

  it.each(NEW_KEYS)('PREUVE 25 — %j.%s ne nomme aucun fournisseur ni détail technique', (path, key) => {
    const forbidden = /instantly|smartlead|lemlist|resend|supabase|smtp|claude|anthropic|openai|gpt|clay|apollo|provider|fournisseur|409|http/i

    for (const dict of [fr, en]) {
      expect((at(dict, path) as Dict)[key] as string).not.toMatch(forbidden)
    }
  })

  it('PREUVE 26 — « Échec » et « Rejeté » restent distincts dans les deux langues', () => {
    for (const dict of [fr, en]) {
      const s = at(dict, ['dashboard', 'campaigns', 'detail', 'emailStatuses']) as Dict
      expect(s.failed).not.toBe(s.rejected)
    }
  })
})
