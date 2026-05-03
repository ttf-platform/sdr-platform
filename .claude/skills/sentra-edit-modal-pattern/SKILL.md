---
name: sentra-edit-modal-pattern
description: Applique le pattern Edit Modal de Sentra utilisé pour éditer emails, follow-ups, prospects, deals, settings sections. À utiliser pour toute création ou modification de modal d'édition contenant un body texte, des toggles (booking link, signature), un Save/Cancel, ou une regeneration AI. Couvre symétrie EditEmailModal/EditFollowUpModal, helpers partagés (normalizeBody, insertBookingUrl, stripBookingUrl, signature), composition canonique du body, validation required, char counters, et tests Playwright MCP d'interaction.
---

# Sentra Edit Modal Pattern

## Principe central : symétrie stricte

Tous les Edit modals de Sentra suivent **la même architecture**. Quand tu crées un nouveau Edit modal, tu pars d'un existant (`EditEmailModal` ou `EditFollowUpModal`) et tu reproduis fidèlement.

Référence canonique :
- `components/EditEmailModal.tsx` — édition d'un draft personnalisé (tab Emails)
- `components/EditFollowUpModal.tsx` — édition d'un step template (tab Follow-up Sequence)

**Règle d'or** : si un comportement existe dans un Edit modal, il doit exister à l'identique dans tous les autres (sauf justification documentée). Toute divergence → discuter AVANT d'implémenter.

---

## When to apply this skill

Charge cette skill systématiquement quand :
- Création d'un nouveau Edit modal (`EditXModal`)
- Modification d'un Edit modal existant (Email, FollowUp, ou autre)
- Ajout d'un toggle (booking link, signature, autre option avec insert/remove dans le body)
- Refacto helpers de manipulation de body (normalize, insert, strip)
- Implémentation d'une regeneration AI depuis un modal d'édition

---

## Architecture commune

Tout Edit modal contient ces blocs dans cet ordre :

```
┌────────────────────────────────────────────────┐
│ Header : Titre + bouton X close (top right)    │
├────────────────────────────────────────────────┤
│ Body fields :                                  │
│   - Subject (input text, char counter optional)│
│   - Body (textarea, rows configurable, char ct)│
│   - Toggles row (booking link + signature)     │
│   - Variables/preview info (read-only blocks)  │
├────────────────────────────────────────────────┤
│ Footer :                                       │
│   [Cancel]                  [✨ Regenerate]    │
│                             [Save]             │
└────────────────────────────────────────────────┘
```

**Largeur** : `max-w-3xl` (768px) — c'est un editor, on suit la largeur canonique éditeur du design system.

**Backdrop** : overlay sombre cliquable pour close (équivalent à click Cancel).

**Esc** : ferme le modal (équivalent à click Cancel).

**Focus trap** : Tab cycle dans le modal uniquement, ne sort pas vers la page derrière.

---

## State local jusqu'au Save explicite

**Règle absolue** : tout l'état d'édition est local au modal. Aucune persistance n'arrive avant le click Save.

```tsx
// Pattern type
const [subject, setSubject] = useState(initialSubject);
const [body, setBody] = useState(initialBody);
const [bookingEnabled, setBookingEnabled] = useState(initialBookingEnabled);
const [signatureEnabled, setSignatureEnabled] = useState(initialSignatureEnabled);
const [touched, setTouched] = useState({ subject: false, body: false });

const handleSave = async () => {
  // validation
  if (!isValid()) return;
  // PATCH API
  await fetch(`/api/.../${id}`, { method: 'PATCH', body: JSON.stringify({...}) });
  onSave(updatedItem);
  onClose();
};

const handleCancel = () => {
  // pas de PATCH, juste close
  onClose();
};
```

**Anti-pattern à refuser** : autosave, debounced save, ou toute persistance sans action user explicite.

---

## Helpers partagés (CRITIQUE)

Ces helpers sont définis **une seule fois** et importés partout. Pas de duplication.

### `normalizeBody(body: string): string`
Centralisé dans `lib/email-body.ts` (ou équivalent).

Rôle :
- Strip `{{sender_name}}` inconditionnel (jamais dans le body, le sender_name sert uniquement au header SMTP From)
- Trim leading/trailing whitespace
- Normalise les line breaks (\r\n → \n)
- Collapse multiple blank lines (>2 newlines consécutifs → 2)

Appelée systématiquement avant Save et avant render.

### `insertBookingUrl(body: string, url: string): string`
- Append l'URL réelle à la fin du body (avant la signature si présente)
- Idempotent : si l'URL existe déjà, ne pas dupliquer
- Sépare avec une ligne vide propre

### `stripBookingUrl(body: string, slug: string): string`
- Retire l'URL du body (regex sur le pattern `https://.../book/{slug}` ou `{{booking_link}}`)
- Idempotent : si pas présent, retourne le body tel quel
- Nettoie les blank lines orphelines

### `renderSignature(profile: Profile): string`
- Construit la signature à partir des champs `signature_*` du workspace_profiles
- Format canonique :
  ```
  --
  {Name}
  {Title} at {Company}
  {Phone if present}
  {Website if present}
  ```
- Returns string vide si aucun champ signature configuré

### `appendSignature(body: string, signature: string): string`
- Append la signature au body avec séparateur (`\n\n` ou `\n--\n`)
- Idempotent : si déjà présente, ne pas dupliquer
- Pas de signature appended si signature vide

### `stripSignature(body: string): string`
- Retire la signature précédemment appended (regex sur le marqueur `--` + lignes suivantes)
- Idempotent

**Toujours combiner** : `normalizeBody(stripSignature(stripBookingUrl(body, slug)))` pour obtenir le body "raw" éditable.

---

## Composition canonique du body

Ordre fixe à l'envoi :

```
1. Intro (Hi {{first_name}}, ...)
2. Value prop / contexte
3. CTA (call-to-action)
4. Booking link URL (si toggle ON)
5. Signature (si toggle ON)
```

**Règles** :
- L'AI prompt génère le body **sans signer** (pas de "Best, {{sender_name}}" en fin)
- La signature est appliquée **programmatiquement** après génération via `appendSignature()`
- Le booking link est inséré programmatiquement via `insertBookingUrl()`
- `{{sender_name}}` est **stripé inconditionnellement** du body par `normalizeBody()` — il ne sert qu'au header SMTP

---

## Toggle pattern (booking + signature)

**Layout** : 2 toggles côte à côte, visible sans scroll au-dessus du textarea ou juste en dessous selon le modal.

```tsx
<div className="flex gap-4">
  <ToggleField
    label="📅 Include booking link"
    enabled={bookingEnabled}
    onToggle={(v) => {
      setBookingEnabled(v);
      setBody(v ? insertBookingUrl(body, bookingUrl) : stripBookingUrl(body, slug));
    }}
  />
  <ToggleField
    label="✍️ Include signature"
    enabled={signatureEnabled}
    onToggle={(v) => {
      setSignatureEnabled(v);
      setBody(v ? appendSignature(body, signature) : stripSignature(body));
    }}
  />
</div>
```

### Règles toggle insert/remove temps réel

Le toggle **modifie le body localement immédiatement** (pas seulement au Save) pour que l'user voit le résultat. Cohérence stricte entre :
- État du toggle
- Contenu du body affiché
- Body persisté au Save

**Différence Email vs FollowUp template** :
- `EditEmailModal` (drafts personnalisés) : insert l'**URL réelle** (résolue depuis booking_slug)
- `EditFollowUpModal` (templates) : insert le placeholder `{{booking_link}}`, et affiche en dessous une note `Preview at send time: https://.../book/{slug}`

---

## Configuration rows textarea

| Modal | Rows | Justification |
|---|---|---|
| `EditEmailModal` | 12 | Body d'email complet visible |
| `EditFollowUpModal` | 8 | Template plus court, toggles visibles sans scroll |
| Autre Edit modal avec body texte | 8-12 selon densité | Choisir pour que les toggles restent visibles sans scroll |

**Règle** : les toggles doivent être visibles à l'ouverture du modal sans scroll. Si rows trop grand → scroll, mauvaise UX.

---

## Char counters

Sur les textareas et inputs avec limites :
- Affichage en bas-droite : `{currentLength} / {maxLength}` ou `{currentLength}` sans max si limite floue
- Couleur : `text-gray-500` par défaut, `text-orange-600` à 80%, `text-red-600` à 100%+
- Pas de hard block sur la longueur (l'user peut dépasser, mais voit l'avertissement)

**Subject** : ~80 chars typique avant troncature côté inbox client → counter informatif.
**Body** : pas de limite stricte, counter utile pour rester concis (idéal cold email : < 800 chars).

---

## Validation required fields

Pattern aligné avec `sentra-design-system` :
- Astérisque rouge sur label des required (Subject par exemple)
- `border-red-500` si `touched && empty`
- Toast error si tentative Save avec required vides
- Save disabled tant que required vides + tooltip "Complete required fields"

```tsx
const isValid = () => {
  if (!subject.trim()) return false;
  if (!body.trim()) return false;
  return true;
};

<button disabled={!isValid()}>Save</button>
```

---

## Pattern handleRegenerate

Bouton ✨ Regenerate dans le footer. Appel AI qui génère un nouveau body. **Critique** : la regeneration applique manuellement les toggle states courants.

```tsx
const handleRegenerate = async () => {
  setIsRegenerating(true);
  const response = await fetch('/api/.../regenerate', {
    method: 'POST',
    body: JSON.stringify({ /* contexte campaign + prospect */ }),
  });
  const { generatedBody } = await response.json();
  
  // Le AI prompt ne signe pas et n'insère pas le booking link
  // On applique les toggles courants programmatiquement
  let newBody = normalizeBody(generatedBody);
  if (bookingEnabled) newBody = insertBookingUrl(newBody, bookingUrl);
  if (signatureEnabled) newBody = appendSignature(newBody, signature);
  
  setBody(newBody);
  setIsRegenerating(false);
};
```

**Points critiques** :
- L'AI ne signe **jamais** (instruction explicite dans le prompt)
- L'AI n'insère **jamais** de booking link en dur (utilise `{{booking_link}}` placeholder qui sera résolu)
- L'AI ne hardcode **jamais** de meeting duration → utiliser `{{meeting_duration}}` qui sera résolu via `workspace_profiles.meeting_durations[0]`
- Les toggles ON/OFF sont appliqués **après** réception du body AI

---

## Variables supportées dans body / subject

À documenter dans le modal (section info read-only ou tooltip) :

| Variable | Source | Résolu quand |
|---|---|---|
| `{{first_name}}` | prospect.first_name | Render personalization |
| `{{last_name}}` | prospect.last_name | Render personalization |
| `{{company}}` | prospect.company_name | Render personalization |
| `{{title}}` | prospect.title | Render personalization |
| `{{booking_link}}` | workspace_profiles.booking_slug | Render personalization OU toggle ON dans EditEmailModal |
| `{{meeting_duration}}` | workspace_profiles.meeting_durations[0] | Render personalization |
| `{{sender_name}}` | **STRIPÉ inconditionnellement** | jamais dans body |

**Anti-pattern à refuser** : variable custom non listée ici sans validation explicite.

---

## Différences EditEmailModal vs EditFollowUpModal

Documenter clairement les divergences justifiées :

| Aspect | EditEmailModal | EditFollowUpModal |
|---|---|---|
| Cible éditée | Draft personnalisé (1 prospect) | Template séquence (tous prospects) |
| Subject | Sujet final personnalisé | Template avec variables `{{}}` |
| Body | Body final personnalisé | Template avec variables `{{}}` |
| Booking link | URL réelle insérée | Placeholder `{{booking_link}}` + note preview |
| Rows textarea | 12 | 8 |
| Champ delay_days | Absent | Présent (input number "Send after N days of no reply") |
| Section variables | Affiche les valeurs résolues du prospect | Liste des variables dispo + note "résolues à l'envoi" |

Toute autre divergence → justifier ou aligner.

---

## Validation Playwright MCP — Edit modals

À tester systématiquement quand un Edit modal est créé/modifié.

### 1. Ouverture / fermeture (TOUJOURS)

```
Avec Playwright MCP, ouvre [URL avec un Edit modal trigger], déclenche l'ouverture du modal [X].
Vérifie :
- Modal s'affiche centré, max-w-3xl
- Backdrop sombre visible
- Focus se place automatiquement sur le premier input éditable
- Press Esc → modal se ferme, backdrop disparaît
- Réouvre, click sur backdrop → modal se ferme
- Réouvre, click bouton X header → modal se ferme
- Réouvre, click Cancel → modal se ferme
Screenshot avant ouverture, modal ouvert, après fermeture.
```

### 2. Focus trap (TOUJOURS)

```
Avec Playwright MCP, ouvre le modal [X], puis press Tab répétitivement.
Vérifie :
- Le focus cycle uniquement dans les éléments interactifs du modal
- Le focus ne sort jamais vers la page derrière
- Shift+Tab fonctionne en sens inverse
```

### 3. Toggles temps réel (CRITIQUE)

```
Avec Playwright MCP, ouvre EditEmailModal sur un draft existant.
1. Lis le contenu actuel du textarea body
2. Toggle ON "Include booking link" → vérifie que le body affiche maintenant l'URL réelle
3. Toggle OFF → vérifie que l'URL est retirée, body propre (pas de blank lines orphelines)
4. Toggle ON "Include signature" → vérifie signature appended à la fin
5. Toggle OFF signature → vérifie signature retirée
6. Toggle ON les deux ensemble → vérifie ordre canonique (body → URL → signature)
7. Cancel → réouvre → vérifie que les toggles sont revenus à leur état initial
Screenshot chaque étape.
```

### 4. Save vs Cancel (TOUJOURS)

```
Avec Playwright MCP :
1. Ouvre le modal, modifie subject ET body
2. Click Cancel → réouvre → vérifie que les modifications NE sont PAS persistées
3. Refais les mêmes modifications, click Save → réouvre → vérifie que les modifs SONT persistées
4. Vérifie que le Save a bien appelé PATCH (capture network requests)
```

### 5. Validation required (TOUJOURS)

```
Avec Playwright MCP, ouvre le modal :
1. Vide le subject (required) → vérifie border-red, astérisque rouge, Save disabled
2. Hover sur Save disabled → vérifie tooltip "Complete required fields"
3. Tape un caractère dans subject → vérifie Save activé
4. Vide le body (required) → vérifie même comportement
```

### 6. Char counters (si présents)

```
Avec Playwright MCP, ouvre le modal et tape progressivement dans subject puis body.
Vérifie :
- Compteur s'incrémente caractère par caractère
- Couleur change à 80% (orange) puis 100%+ (red)
- Dépassement n'est PAS bloqué (counter informatif uniquement)
```

### 7. Regenerate AI (CRITIQUE)

```
Avec Playwright MCP, ouvre EditEmailModal sur un draft.
1. Active toggle "Include signature" et toggle "Include booking link"
2. Click ✨ Regenerate
3. Vérifie : indicateur loading visible pendant ~2-5s
4. Après régénération, vérifie que le nouveau body :
   - Ne contient PAS "{{sender_name}}" littéral
   - Ne contient PAS de signature signée par l'AI ("Best, [Nom]" en fin sans `--`)
   - Inclut bien la signature appended (séparateur `--`) car toggle ON
   - Inclut bien l'URL booking car toggle ON
5. Désactive les 2 toggles, click Regenerate à nouveau → vérifie body sans URL ni signature
Screenshot avant et après chaque régénération.
```

### 8. Stripping de {{sender_name}} (TOUJOURS)

```
Avec Playwright MCP, ouvre EditEmailModal sur un draft existant ET inspecte le body via DOM.
Vérifie qu'aucun {{sender_name}} littéral n'apparaît dans le textarea, peu importe les toggles.
Si présent → bug normalizeBody, à corriger.
```

### 9. Cohérence cross-modal (si modification d'un helper partagé)

Si tu modifies `normalizeBody`, `insertBookingUrl`, `stripBookingUrl`, `renderSignature`, `appendSignature`, ou `stripSignature` :

```
Avec Playwright MCP, ouvre successivement EditEmailModal et EditFollowUpModal.
Sur chaque, exécute les tests 3 (toggles temps réel) et 7 (regenerate).
Vérifie que le comportement est strictement cohérent entre les deux modaux.
```

### 10. Composition canonique du body au save

```
Avec Playwright MCP, ouvre EditEmailModal :
1. Active les 2 toggles
2. Save
3. Inspecte via API GET le draft persisté (capture network ou requête directe)
4. Vérifie l'ordre du body : intro → value prop → CTA → booking URL → signature
5. Aucun {{sender_name}}, aucune signature pré-AI orpheline avant la signature programmatique
```

---

## Anti-patterns à refuser

- Edit modal qui ne suit pas la symétrie EditEmailModal/EditFollowUpModal
- Helper de body manipulation dupliqué (toujours partagé via `lib/email-body.ts`)
- Autosave / persistance silencieuse en cours d'édition
- Toggle qui ne modifie pas le body en temps réel (incohérence visuelle/persistance)
- AI prompt qui signe le body ou hardcode meeting duration / booking URL
- `{{sender_name}}` non stripé du body
- Save sans validation required
- Modal qui ne piège pas le focus
- Esc qui ne ferme pas le modal
- Différence non-justifiée entre Edit modals

---

## Mises à jour

Quand un nouveau Edit modal est créé → vérifier qu'il respecte la symétrie. Si nouveau pattern utile (nouveau toggle, nouveau helper, nouveau cas) → l'ajouter ici, pas dans un sprint isolé.
Review tous les 5-10 sprints.
