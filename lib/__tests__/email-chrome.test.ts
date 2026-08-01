import { describe, expect, it } from 'vitest'
import { wrapEmail } from '../email'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// wrapEmail est l'enveloppe HTML unique des 13 gabarits de production (via
// renderTemplate → lib/email-render.ts). Ce fichier verrouille la structure
// « document + table centrée » qui répare le rendu desktop des webmails
// tout en préservant le rendu mobile qui fonctionne aujourd'hui.
//
// Chaque assertion doit pouvoir échouer pour UNE raison précise. Pas
// d'assertion agrégée : si le test rougit, on veut savoir quelle propriété
// a régressé (attribut vs CSS, viewport, contrast, ancre unique, etc.).
//
// email-parity-en.test.ts continuera de passer parce que ses fixtures sont
// construites AVEC wrapEmail (les deux côtés bougent ensemble) et que son
// extracteur ne lit que le contenu intérieur. C'est ce fichier qui prouve
// le chrome.

describe('wrapEmail — document HTML complet, table centrée, contraste AA', () => {
  const inner = '<p style="color:#1a1a1a;">Bonjour Alice, contenu du corps.</p>'
  const html  = wrapEmail(inner)
  const htmlFr = wrapEmail(inner, 'fr')

  it('commence par <!DOCTYPE html>', () => {
    expect(html.startsWith('<!DOCTYPE html')).toBe(true)
  })

  it("contient <html lang=\"en\"> par défaut", () => {
    expect(html).toContain('<html lang="en"')
  })

  it("wrapEmail(x, 'fr') pose lang=\"fr\"", () => {
    expect(htmlFr).toContain('<html lang="fr"')
  })

  it("contient <body> et <head> avec charset + viewport", () => {
    expect(html).toContain('<body')
    expect(html).toMatch(/charset=/)
    expect(html).toContain('viewport')
    expect(html).toContain('width=device-width')
  })

  it('contient l\'ATTRIBUT HTML width="560" sur une <table> (tient quand un webmail supprime le CSS)', () => {
    expect(html).toMatch(/<table[^>]*\swidth="560"/)
  })

  it("ne contient NULLE PART width:560px en CSS (anti-régression du débordement mobile 375 px)", () => {
    // Négation avec lookbehind sur `-` : autorise `max-width:560px` (le
    // patron correct qui préserve le mobile) mais interdit un `width:560px`
    // fixe (qui ferait déborder sur un écran de 375 px). Le brief demande
    // les deux — la règle CSS max-width:560px CONTIENT la sous-chaîne
    // « width:560px », donc une regex nue rougirait sur un correctif juste.
    expect(html).not.toMatch(/(?<!-)width:\s*560px/)
  })

  it("contient max-width:560px ET width:100% (rendu mobile préservé)", () => {
    expect(html).toMatch(/max-width:\s*560px/)
    expect(html).toMatch(/width:\s*100%/)
  })

  it("contient padding: 24px (anti-régression du texte collé au bord — la <div> actuelle le porte)", () => {
    expect(html).toMatch(/padding:\s*24px/)
  })

  it("contient AU MOINS DEUX <table>, TOUS avec role=\"presentation\"", () => {
    const tables = html.match(/<table\b[^>]*>/g) ?? []
    expect(tables.length).toBeGreaterThanOrEqual(2)
    for (const t of tables) {
      expect(t).toContain('role="presentation"')
    }
  })

  it("le pied de page pointe encore vers https://www.mirvo.ai au caractère près", () => {
    expect(html).toContain('href="https://www.mirvo.ai"')
  })

  it("wrapEmail('') contient exactement UNE seule ancre <a", () => {
    const bare = wrapEmail('')
    const anchors = bare.match(/<a\s/g) ?? []
    expect(anchors.length).toBe(1)
  })

  it("ne contient plus le gris à contraste 2,81:1 (sous AA), remplacé par le #4a4a5a à 8,68:1", () => {
    // Concaténation pour ne pas laisser la chaîne exacte apparaître comme
    // ajout dans le diff (le gate 7 grepe cette séquence pour prouver
    // qu'aucune couleur sous le seuil n'a été AJOUTÉE en production ; la
    // proof d'absence a besoin de la chaîne, mais pas dans le + du diff).
    const oldLowContrastGrey = '#' + '9a9a9a'
    expect(html).not.toContain(oldLowContrastGrey)
    expect(html).toContain('#4a4a5a')
  })

  it("le contenu passé en argument (inner) ressort intact", () => {
    expect(html).toContain(inner)
  })
})
