---
name: sentra-design-system
description: Applique le design system Sentra. À utiliser pour toute création ou modification de page, composant UI, modal, formulaire, ou pour revoir la cohérence visuelle d'une feature. Couvre largeurs canoniques, couleurs de marque, status pill badges, tooltips Portal, patterns spacing, validation required fields, toasts, vendor invisibility, vigilance UX, et validation Playwright MCP.
---

# Sentra Design System

## Référence visuelle de base

Sentra reprend l'identité visuelle de **Firstsend** (https://firstsend.polsia.app/app#campaigns) avec améliorations sélectives. Règle permanente :

- **Pages existantes** : discuter AVANT toute modification
- **Reproduction Firstsend** : default
- **Améliorations / divergences** : justifier AVANT implémentation (UX/différenciation), attendre validation founder

Jamais inventer un pattern visuel non validé. En cas de doute → demander.

---

## When to apply this skill

Charge cette skill systématiquement quand :
- Création d'une nouvelle page (`app/...`)
- Modification visuelle d'une page existante
- Création/modification d'un composant partagé (`components/...`)
- Création d'un formulaire, modal, ou pattern de validation
- Review de cohérence design pré-PR
- Audit cross-pages

---

## Largeurs canoniques

Trois largeurs uniquement, choisies selon le contenu :

| Classe | Pixels | Usage |
|---|---|---|
| `max-w-2xl mx-auto` | 672px | Forms simples, search bars, settings sections |
| `max-w-3xl mx-auto` | 768px | Editors (campaign editor, profile editor), zones de lecture |
| `max-w-7xl mx-auto` | 1280px | Dashboards, listes (campaigns, prospects, pipeline) |

**Règles** :
- Toujours `mx-auto` pour centrer
- Toujours padding mobile-safe (`px-4 sm:px-6 lg:px-8`)
- Pas de largeur custom (`max-w-[840px]` etc.) sauf justification explicite

---

## Couleurs de marque

```
Fond app          : #f5f2ee (beige)
Fond cards        : #ffffff
Borders neutres   : #e8e3dc
Accent primaire   : #3b6bef (blue, CTAs principaux)
Accent secondaire : bleu Tailwind blue-50/600 pour eyebrows et liens
Texte primaire    : #1a1a1a (slate-900 équivalent)
Texte secondaire  : #4a4a5a (slate-600 équivalent)
```

**Règles** :
- Light theme uniquement (Sentra ne supporte pas dark mode)
- CTAs principaux : `bg-[#3b6bef] text-white`
- Liens inline : `text-blue-600 hover:underline`
- Pas de couleurs hors palette sans validation

---

## Status pill badges (CRITIQUE)

Les status indicators (Coming soon, Beta, New, Recommended, Approved, Rejected, Edited, Draft, etc.) sont **toujours des pill badges**, jamais du texte coloré seul.

**Spec exacte** :

```
bg-{color}-50 text-{color}-600 border border-{color}-200 rounded-full px-2.5 py-0.5 text-xs font-medium
```

Composant unifié : `<StatusBadge variant="..." />` ou `<LifecyclePill ... />` selon contexte.

**Variants standards** :

| Variant | Usage |
|---|---|
| `gray` | Meta info neutre, "Draft", "No data" |
| `orange` / `amber` | "Coming soon", "Edited" (pending action) |
| `purple` | "Source of truth", "Beta" |
| `blue` | "New", "Recommended" |
| `green` | Positive : "Approved", "Active", "Connected" |
| `red` | Negative : "Rejected", "Failed", "Error" |
| `yellow` | Warning, "Action required" |

**Anti-patterns à refuser** :
- ❌ Texte coloré sans bg/border (`text-orange-600` seul)
- ❌ Badge plein (`bg-orange-500 text-white`) sauf cas exceptionnel CTA
- ❌ Émojis comme indicateur de status (✅ ⚠️ ❌) en remplacement de pill

Pattern aligné avec Linear / Notion / Stripe / Firstsend.

---

## Tooltips — Pattern Portal

**Toujours** utiliser `createPortal` vers `document.body` pour bypass les containing blocks parents.

```tsx
import { createPortal } from 'react-dom';

// Width FIXE 320px en inline style (pas max-width)
// Position absolue calculée via getBoundingClientRect()
// Prop placement : 'top' | 'top-end' | 'bottom' | 'bottom-end'
```

**Règles** :
- Width : 320px en inline style (`style={{ width: '320px' }}`), pas `max-w-`
- Positionnement : `getBoundingClientRect()` du trigger pour calcul absolu
- Z-index : suffisamment haut pour passer au-dessus de modals (`z-[9999]`)
- Délai d'apparition : 200-300ms (évite flash sur survols rapides)

**Quand mettre un tooltip** :
- Champ de formulaire pas auto-explicite
- Bouton avec icône seule
- Status badge avec sémantique métier (`What does "Edited" mean?`)
- Toute info contextuelle qui surcharge l'UI si toujours visible

---

## Spacing system

Conventions Tailwind utilisées dans Sentra :

| Cas | Classe |
|---|---|
| Inline gap entre items courts (badges, icons) | `gap-2` |
| Inline gap entre form fields horizontaux | `gap-3` |
| Vertical stack form fields | `space-y-4` |
| Vertical stack sections d'une page | `space-y-6` ou `space-y-8` |
| Card padding intérieur | `p-6` |
| Modal padding intérieur | `p-6` ou `p-8` selon densité |

Pas de spacing custom (`gap-[14px]`) sauf justification.

---

## Validation required fields

Pattern unifié pour tous les forms :

1. Astérisque rouge (`*`) à côté du label des champs required
2. `border-red-500` sur input touched & vide
3. Message d'erreur sous le champ : `text-xs text-red-600 mt-1`
4. Bouton Save **disabled** tant que required vides
5. Tooltip sur Save disabled : "Complete required fields"
6. Toast error si tentative submit avec required vides

**State local jusqu'au Save explicite** (règle UX 4.5) — pas de persistance silencieuse en cours d'édition.

---

## Toasts

Deux modes selon le contexte :

| Mode | Durée | Quand |
|---|---|---|
| Auto-dismiss | ~3s | Confirmations rapides ("Saved", "Copied") |
| Persistant | Jusqu'à action user | Toasts qui demandent une action ("Email sent — view in Inbox") |

**Implementation** : prop `persistent: true` sur le toast. `usePathname` effect dismisse tous les toasts persistants au changement de page (évite résidus inter-pages).

---

## Vigilance UX (avant chaque proposition)

Avant de proposer/livrer une modification UI, vérifier les 5 points :

1. **Cohérence logique** — le champ est-il au bon endroit ? (ex : Master ICP doit rester groupé : qui on cible + tone + pain points)
2. **Pas de doublons** — pas deux champs qui demandent la même info
3. **Clarté** — tooltip si le champ n'est pas auto-explicite
4. **Cohérence Profile Quality Score** — tout champ avec "Ok ✓" ou badge "% AI quality" doit vraiment compter dans le score, sinon retirer l'indicateur
5. **State local jusqu'au Save** — pas de persistance silencieuse, l'user contrôle quand persister

Si l'un des 5 points n'est pas clair → demander avant d'implémenter.

---

## Branding rules (vendor invisibility)

**Zéro mention** dans l'UI user-facing de :
- Claude / Anthropic / Sonnet / Haiku
- GPT / OpenAI
- Clay / Apollo / Instantly / Smartlead / Lemlist
- Toute mention de provider d'enrichment / d'IA

**Vocabulaire user** :
- "Sentra AI" pour toute mention IA
- "AI prospect research" / "verified contact data"
- "Prospect Credits" pour la monnaie d'enrichment

Code interne peut garder les vrais noms (`model: 'claude-sonnet-4-6'`) — invisible user. Mais variables/labels visibles user → vocabulaire Sentra uniquement.

---

## Validation Playwright MCP (systématique)

À chaque modification UI livrée, **avant clôture de sprint** :

### Validation visuelle (toujours)

```
Avec Playwright MCP, ouvre [URL prod ou localhost:3000/route] et prends un screenshot.
Vérifie :
- Largeur canonique correcte (max-w-2xl/3xl/7xl)
- Status badges respectent le pattern pill (bg/text/border, pas texte seul)
- Couleurs cohérentes avec la palette (#f5f2ee fond, #3b6bef CTAs)
- Pas de débordement responsive
```

### Cross-pages (si composant partagé modifié)

```
Avec Playwright MCP, navigue dans les pages suivantes et screenshot chacune :
- /dashboard
- /dashboard/campaigns
- /dashboard/prospects
- /dashboard/inbox
- /dashboard/settings
Identifie toute inconsistency visuelle introduite par la modification de [composant].
```

### Responsive (si layout modifié)

```
Avec Playwright MCP, ouvre [URL] puis resize la fenêtre à :
- 375px (mobile)
- 768px (tablet)
- 1280px (desktop)
Screenshot à chaque taille et identifie les bugs responsive.
```

### Console errors (toujours)

```
Avec Playwright MCP, ouvre [URL], inspecte la console et liste les erreurs.
Verdict : 0 erreur attendue, sinon corriger avant clôture.
```

---

## Anti-patterns à refuser

- Largeur custom non justifiée (`max-w-[840px]`)
- Status indicator en texte coloré seul (sans pill)
- Tooltip sans Portal (peut être clippé par parent)
- CTA sans `bg-[#3b6bef]` (ou variant validé)
- Mention vendor (Claude, Clay, etc.) dans l'UI user-facing
- Persistance silencieuse en cours d'édition (sans Save explicite)
- Dark mode (non supporté)
- Émojis comme indicateurs de status

---

## Mises à jour

Quand un nouveau pattern stable apparaît sur 2+ sprints → ajouter à cette skill.
Quand un pattern existant évolue → mettre à jour ici, pas juste dans un sprint isolé.
Review tous les 5-10 sprints.
