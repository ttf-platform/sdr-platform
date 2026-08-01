import { describe, expect, it } from 'vitest'
import {
  CRITERIA,
  PROFILE_SCORE_COLUMNS,
  calculateProfileScore,
  type ProfileForScore,
} from '../profile-quality'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Verrouille l'invariant que le lot 5b introduit : toute requete qui
// alimente `ProfileForScore` DOIT charger les colonnes que
// `calculateProfileScore` lit. Les champs du type sont optionnels, donc
// une colonne oubliee ne produit aucune erreur de type, seulement un score
// silencieusement trop bas — c'est exactement le defaut que ce lot corrige
// sur l'ecran Morning Brief, et c'est ce test qui empeche son retour.
//
// Le patron `(PROFILE_SCORE_COLUMNS as ReadonlyArray<string>).includes(c.key)`
// est deliberement large : PROFILE_SCORE_COLUMNS est un tuple de 12
// litteraux, `c.key` de type `keyof ProfileForScore` en compte 14 — un
// `.includes(c.key)` nu echouerait en TS2345 et casserait le gate 1
// (les tests sont type-checkes). Meme forme que
// `lib/__tests__/timezones.test.ts`.

describe('PROFILE_SCORE_COLUMNS — invariant de couverture', () => {
  it('contient chaque `key` de CRITERIA (les 11 champs scores)', () => {
    const cols: ReadonlyArray<string> = PROFILE_SCORE_COLUMNS
    for (const c of CRITERIA) {
      expect(cols.includes(c.key)).toBe(true)
    }
  })

  it("contient `icp_company_size` (singulier) — repli pour les lignes heritees d'avant la migration 007", () => {
    const cols: ReadonlyArray<string> = PROFILE_SCORE_COLUMNS
    expect(cols.includes('icp_company_size')).toBe(true)
  })

  it("n'ajoute pas de colonne non-scoree (ni sender_name ni target_company_revenue)", () => {
    const cols: ReadonlyArray<string> = PROFILE_SCORE_COLUMNS
    expect(cols.includes('sender_name')).toBe(false)
    expect(cols.includes('target_company_revenue')).toBe(false)
  })

  it("contient exactement 12 entrees (11 criteres + icp_company_size)", () => {
    expect(PROFILE_SCORE_COLUMNS.length).toBe(12)
  })
})

describe('calculateProfileScore — bornes', () => {
  it('profil vide → 0, sans exception', () => {
    expect(() => calculateProfileScore({})).not.toThrow()
    expect(calculateProfileScore({})).toBe(0)
  })

  it('profil dont TOUS les criteres passent → 100', () => {
    // Attention aux criteres a longueur minimale mesuree :
    // product_description ≥ 30, value_proposition ≥ 20, icp_description ≥ 30,
    // pain_points ≥ 20.
    const full: ProfileForScore = {
      user_industry:       'SaaS',
      user_company_size:   '11-50',
      product_description: 'A B2B product description that easily exceeds thirty characters in length.',
      value_proposition:   'A value proposition that exceeds twenty chars.',
      icp_description:     'ICP description that exceeds thirty characters comfortably here.',
      icp_industries:      ['Tech'],
      target_titles:       'CTO',
      target_regions:      'EU',
      icp_company_sizes:   ['11-50'],
      pain_points:         'A pain point of at least twenty characters.',
      tone:                'friendly',
    }
    expect(calculateProfileScore(full)).toBe(100)
  })

  it("profil ne portant QUE user_industry, user_company_size, target_titles, target_regions, tone → 35 (le cas que l'ecran voyait a 0)", () => {
    // Exactement les 5 colonnes que la page Morning Brief NE chargeait PAS
    // avant ce lot : 10 + 5 + 10 + 5 + 5 = 35. Au-dessus du seuil de 30,
    // donc le bouton `Generate` devient actif — c'est l'effet assume du
    // correctif §2.1.
    const partial: ProfileForScore = {
      user_industry:     'SaaS',
      user_company_size: '11-50',
      target_titles:     'CTO',
      target_regions:    'EU',
      tone:              'friendly',
    }
    expect(calculateProfileScore(partial)).toBe(35)
  })
})
