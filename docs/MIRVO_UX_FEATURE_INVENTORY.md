# MIRVO — UX Feature Inventory (référence produit)

**Date : 11 juin 2026 · Source : audits READ-ONLY Claude Code (code lu, zéro inférence)**
**Usage : référence factuelle de ce que le USER voit et peut faire, page par page. Sert aux scripts vidéo, au copy marketing, au Help Center, aux posts. Remplace FIRSTSEND_COMPLETE_FEATURE_INVENTORY.md comme référence produit (Firstsend = phase close).**
**À mettre à jour quand une feature change (re-audit CC de la zone concernée).**
**Maj 17 juin : §3 Création de campagne (NewCampaignModal) re-audité post #109/#112/#117/#118 — Parse with AI par campagne retiré, enum tailles aligné, langues EN+FR, modal accessible via ui/Modal. §0 inchangé (le Parse with AI du panneau Master ICP sur /prospects existe toujours).**

---

## 0. Profil / Master ICP (audit dédié)

### a. Inputs disponibles pour remplir le profil

Deux surfaces distinctes :

**1. Settings page (`/dashboard/settings`) — section COMPANY + PRODUCT :**
- Champ texte `company_website` (input, placeholder zobo.com) — marqué Optional, badge "Used in email signature"
- Champ texte `user_industry` (input)
- Select `user_company_size` (enum fixe)
- Textarea `product_description` (requis*)
- Textarea `value_proposition`

**2. Prospects page (`/dashboard/prospects`) — panneau "Master ICP" (toggle 🎯 ICP Settings) :**
- Textarea `icp_description` (plain English, 4 lignes) → seul input qui alimente le bouton "Parse with AI"
- Champs structurés manuels : industry (input), target_titles (input, comma-separated), target_regions (input, comma-separated), pain_points (textarea)
- Toggle pills company_sizes (multi-select : 1-10, 10-50…)
- Toggle pills company_revenue (multi-select)
- Select tone

Pas de champ URL dans le Master ICP.

### b. Les deux boutons IA

**Bouton ✨ Auto-fill (Settings page) :**
- Source : URL du champ `company_website`
- Route : POST `/api/auto-fill` → scrape le site (home + pricing + about via `scrapeWebsite()`) → Claude Haiku analyse le texte scrapé
- Champs remplis : industry, user_company_size, product_description, value_proposition, icp_description, target_industry, target_titles, target_regions, target_company_size, target_pain_points, email_tone (11 champs max)
- UX : ouvre AutoFillPreviewModal — le user voit tous les champs extraits, peut cocher/décocher/éditer chaque champ individuellement avant d'appliquer
- Champs ICP issus de l'auto-fill mis en pendingIcpUpdates (sauvegardés au Save global)

**Bouton ✨ Parse with AI (Prospects page, Master ICP) :**
- Source : contenu de la textarea `icp_description` (texte libre saisi par le user)
- Route : POST `/api/icp/parse` → envoie la description à Claude Haiku
- Champs remplis automatiquement dans le formulaire ICP : industry (premier item de industries[]), target_titles (join), target_regions (join), company_sizes (filtrés sur enum exact), company_revenue (filtrés sur enum exact), pain_points
- Pas de modal de preview — champs patchés directement dans icpForm sans confirmation

### c. Flow exact vu par le user

Les deux flows coexistent, sur des pages différentes et indépendantes :

| | Auto-fill (Settings) | Parse with AI (Prospects) |
|---|---|---|
| Surface | /dashboard/settings | /dashboard/prospects → panneau ICP |
| Déclencheur | URL du site web | Textarea description libre |
| Preview avant apply | Oui — modal avec checkboxes | Non — patch direct |
| Champs ciblés | Profil company + ICP | ICP uniquement |
| Sauvegarde | Différée (au Save global) | Différée (au Save ICP) |

Le user peut choisir l'un ou l'autre, ou les deux, ou remplir manuellement sans aucun des deux. Pas de wizard/étapes forcées — les deux entrées sont optionnelles et les champs manuels restent éditables à tout moment.

*Maj #111/#116/#118 : le panneau Master ICP a désormais un dirty-state (Save/Reset désactivés tant que rien n'a changé), une copy didactique en tête ("source of truth every campaign builds on"), un recolor blueprint (ex-purple, hors palette), et ses labels sont associés (a11y).*

---

## 1. Onboarding post-signup

Fichiers lus : `components/onboarding/WelcomeModal.tsx`, `components/onboarding/OnboardingChecklist.tsx`

### Welcome Modal

Le user voit : modale size="lg", titre "Welcome to Mirvo", sous-titre "Your AI sales agent is ready. Here's your 7-step setup — 15 minutes to your first campaign." — grille 2 colonnes de 7 cartes animées (stagger 0.07s), puis un encart gris "Day-1 sending" expliquant le sending via infrastructure partagée pendant la chauffe.

Les 7 étapes affichées dans la modale (icône + titre + description) :
1. 🎯 Define your ICP — "Tell Mirvo who you target — AI uses this to personalize every email."
2. 🌐 Add your sending domain — "Configure DNS for long-term deliverability — sending starts immediately via shared infrastructure."
3. ✉️ Connect your mailbox — "Link Gmail or Outlook — Mirvo handles domain warmup in parallel while you send."
4. 🚀 Create your first campaign — "Mirvo AI generates a personalized multi-step sequence tailored to your ICP."
5. 👥 Add your prospects — "CSV import or AI prospect discovery — no credits consumed for CSV."
6. ✓ Review AI-generated emails — "Approval Queue lets you validate every email before it reaches a prospect."
7. 📤 Launch — send today — "No waiting weeks. Mirvo sends day 1 at full capacity."

Le user peut :
- "Let's go →" — ferme la modale, appelle onDismiss(), navigation libre
- "Try with sample data first →" — POST /api/onboarding/load-sample-data, ferme, window.location.reload()
- Pas de fermeture par clic sur le backdrop (closeOnBackdropClick={false})

### Onboarding Checklist

Le user voit : widget fixé bottom-6 left-6, w-[340px]. Header : ring circulaire SVG bleu animé (#3b6bef) avec pourcentage au centre + "Setup Mirvo" + "N/7 steps done". Réductible/développable au clic du header.

Les 7 étapes dans la checklist (titre + description + deep link) :
1. Define your ICP — "Tell Mirvo who you target" → /dashboard/settings#icp
2. Add sending domain — "Configure your domain for outbound" → /dashboard/settings/sending-domains/new
3. Connect your mailbox — "Verify DNS — sending starts day 1" → /dashboard/settings/sending-domains/new
4. Create first campaign — "Mirvo AI writes the emails" → /dashboard/campaigns
5. Add your prospects — "CSV, Clay, or Signal-matched" → /dashboard/campaigns
6. Review AI emails — "Approval Queue — validate before send" → /dashboard/campaigns
7. Launch campaign — "Send today — no waiting period" → /dashboard/campaigns

Étapes complétées : checkmark bleu animé (spring + halo) + texte barré + opacité 55%. Étapes en attente : cercle vide gris.

Le user peut :
- Cliquer sur une étape pour naviguer via le deep link
- Réduire/développer le widget
- "Hide for now" — appelle dismissChecklist(), retire définitivement le widget jusqu'à reset

La checklist disparaît automatiquement si progress_percent === 100 ou checklist_dismissed === true.

⚠️ Note interne : le deep link de la checklist étape 5 mentionne "CSV, Clay, or Signal-matched" — "Clay" visible = violation vendor invisibility, à corriger (cf. section Actions).

---

## 2. Email accounts / domaine d'envoi

Fichiers lus : `SendingDomainWizard.tsx`, `Step1Domain.tsx`, `Step2DnsRecords.tsx`, `Step3Verify.tsx`, `SendingDomainCard.tsx`

### Wizard 3 étapes (`/dashboard/settings/sending-domains/new`)

Progress indicator en haut, 3 étapes numérotées.

**Étape 1 — Connect your sending domain**

Le user voit : titre + paragraphe "A dedicated domain for cold outreach protects your main business email reputation." + 3 champs obligatoires :
- Domain to send from — placeholder getmirvo.com, hint "The domain you'll use as From address"
- From email address — auto-rempli avec outreach@<domain> dès que le domaine est saisi, modifiable
- Sender display name — placeholder Cyrus from Mirvo, max 100 chars

Logique d'avertissement (banner ambre) : si le domaine matche le domaine d'inscription → "This looks like your main domain…" ; si MX détecte Google Workspace ou Microsoft 365 → "This domain is currently used for business email (XXX detected)…" (détection asynchrone via /api/dns-helpers/check-mail-usage, debounce 600ms). Dans les deux cas, checkbox "I understand the risk…" obligatoire pour débloquer le bouton.

Lien "Need help with DNS setup?" → mailto:support@mirvo.ai?subject=DNS%20setup%20help

Le user peut : remplir les 3 champs · cocher la checkbox de risque (si warning) · "Continue →" → POST /api/email-accounts → crée la row setup_status='dns_pending', reçoit les dns_records, passe à l'étape 2.

**Étape 2 — Add DNS records**

Le user voit : 3 cartes DNS (TXT badge bleu) :
- SPF — "Authorises our servers to send mail on behalf of your domain." → Name/Host + Value, chacun avec bouton "Copy" / "Copied!" (2s)
- DKIM — "Cryptographic signature that proves emails haven't been tampered with."
- DMARC — "Policy that tells receiving servers how to handle unauthenticated mail."

Dropdown DNS provider : détection auto via /api/dns-helpers/detect-provider (affiche "detecting…" puis "detected: Cloudflare" si trouvé). Options : Cloudflare, AWS Route 53, GoDaddy, Namecheap, Google Domains, DigitalOcean, Hover, DNSimple, Squarespace, Name.com, Other/Unknown.

Composant <ProviderGuide> sous le dropdown (guide contextuel selon provider).

Le user peut : copier individuellement chaque valeur DNS · changer le provider · "← Back" · "I've published — verify now →" → étape 3.

**Étape 3 — Verify DNS records**

Le user voit : 3 pills de statut SPF / DKIM / DMARC :
- Initial : "Pending" (gris)
- Vérifié : pill verte "✓ Verified"
- Échec : pill rouge "✗ Not found"

Si allVerified : banner vert "All records verified! Redirecting to your sending domains…" + redirect auto après 1500ms.
Si partiel : banner ambre "Some records weren't found yet. DNS propagation can take a few minutes — try again shortly."

Le user peut : "← Back" · "Verify later" (lien texte → /dashboard/settings/sending-domains) · "Verify now" → POST /api/email-accounts/[id]/dns-verify · "Try again" (si échec).

### Carte domaine existant (SendingDomainCard)

Le user voit (par carte) :
- Email + badge statut warmup (avec tooltip) + "Sender name: …"
- Grille 3 stats sur fond #f5f2ee : Reputation (xx/100, tooltip), Daily capacity (sent/capacity), Phase (x of 3, tooltip)
- Rangée DNS : pills SPF / DKIM / DMARC (vert = vérifié, rouge = non) + "DNS verification in progress" si pas tous vérifiés

Menu ··· (3 actions) :
- View details — désactivé, title="Coming next"
- Pause sending / Resume sending
- Disconnect — confirm "Disconnect email@domain? This will stop sending from this mailbox immediately. You can reconnect later." → DELETE /api/email-accounts/[id]

---

## 3. Création de campagne

Fichiers lus : `ChooseTemplateModal.tsx`, `lib/campaign-templates.ts`, `NewCampaignModal.tsx`

### ChooseTemplateModal

Le user voit : grille 2 colonnes (3 sur sm+), titre "Choose a template" + sous-titre "Pick a starting point — you can edit everything before creating."

7 templates :
1. 🚀 SaaS Cold Outreach — "Drive demo bookings from decision-makers at target SaaS companies."
2. 📣 Agency Lead Gen — "Win new retainer clients for your agency with a pain-first approach."
3. 🤝 Startup Partnership — "Propose co-marketing, integration, or reseller partnerships."
4. 💼 Investor Outreach — "Warm introduction to investors aligned with your stage and sector."
5. 💻 Freelancer Clients — "Land new clients for your freelance or consulting practice."
6. 🛒 E-commerce B2B — "Sell wholesale, bulk, or enterprise contracts to retail buyers."
7. ✦ Blank Canvas — "Start from scratch with a fully custom campaign." (border en tirets)

Le user peut : cliquer sur un template → ouvre NewCampaignModal pré-rempli.

### NewCampaignModal

Badge si pré-rempli : "✨ Pre-filled from AI suggestion" (fond bleu) ou "🎯 Pre-filled from template" (fond ocre).

Section 🎯 ICP — Ideal Customer Profile : textarea (bind `targetPersona`) pré-remplie depuis le Master ICP (/api/workspace-profile, champ icp_description). **Plus de bouton "Parse with AI" ici (retiré #109 — il re-dérivait et écrasait la donnée curée).** Les champs structurés sont pré-remplis directement depuis les champs structurés du Master ICP (industries, titres, régions, tailles, revenue), éditables pour cette campagne. Copy : "Pre-filled from your Master ICP, edit to tailor this campaign."

Section Campaign Name (obligatoire) : vérification de disponibilité live (debounce 500ms via /api/campaigns/check-name), flash + focus si nom dupliqué.

Section Define Your Ideal Customer (pré-remplie en champs structurés depuis le Master ICP, éditable) :
- Target Industry (texte libre)
- Target Titles (texte libre)
- Target Regions (texte libre)
- Company Size (pills) : 1-10 / 10-50 / 50-200 / 200-500 / 500-1000 / 1000+ (enum aligné #109)
- Company Revenue (pills) : <$1M / $1M-$5M / $5M-$10M / $10M-$50M / $50M-$200M / $200M+

Section Your Pitch :
- "What does your product do?" (obligatoire, textarea 2 lignes)
- "Value Proposition" (optionnel, textarea 2 lignes)

Section Tone & Language (dropdowns grid 2 colonnes) :
- Tone : Professional / Casual / Direct / Friendly / Witty (défaut : Professional)
- Language : English / French (défaut : English ; DE/ES/IT cachés jusqu'à V2, #112). Génération native dans la langue choisie, pas de traduction.

Le user peut : "Cancel" · "Create Campaign" → POST /api/campaigns → redirect /dashboard/campaigns/[id].

*Accessibilité (#117/#118) : le modal est rendu via le primitive `components/ui/Modal.tsx` (role="dialog", aria-modal, focus trap, ESC, scroll lock, restore focus, portal) ; chaque label est associé à son contrôle (htmlFor/id).*

---

## 4. Prospects — voies d'ajout

Fichier lu : `components/ProspectModals.tsx`

Depuis la page campagne, 2 boutons visibles :
- "+ Add manually" → ManualAddModal
- "Import CSV" → ImportCSVModal

(Note : PasteModal existe dans le code mais n'est pas référencé directement depuis la page campagne — possiblement accessible depuis /dashboard/prospects.)

### ImportCSVModal (4 étapes)

**Étape upload :**
- Dropdown optionnel "Campaign" si pas de campagne pré-définie (option "No campaign — global list" + liste des campagnes)
- Drop zone : "Drop CSV here or click to browse" / "Columns auto-detected: email, name, company, title, linkedin, website"

**Étape preview :**
- Grid column mapping : 7 champs (email, first name, last name, company, title, linkedin url, website) — chacun avec select sur les colonnes du CSV (option "— skip —")
- Tableau preview (5 premières lignes) : email / first name / last name / company / title
- Analyse d'overlap (si campagne sélectionnée) :
  - 🟢 N new to this campaign — will be added
  - 🟠 N already in this campaign — will be skipped (liste d'emails)
  - 🔵 N also in other campaigns (liste email + noms de campagnes, avertissement)
- Boutons : "Back" + "Import N rows"

**Étape importing :** spinner + "Importing prospects…"

**Étape done :** résumé contextuel (full success / partial / nothing new / no assignment) avec compteurs exacts (imported / updated / skipped / invalid). Bouton "Done".

### ManualAddModal

Champs : Email * (obligatoire) · First name · Last name · Company · Job title · LinkedIn URL. Dropdown campaign optionnel (si pas pré-défini). Boutons : "Cancel" + "Add Prospect".

### PasteModal

Textarea monospace, hint "Paste email addresses — one per line, or comma/space-separated." Parse : split(/[\n,;\s]+/). Compteur live "N emails detected". Bouton "Import N emails".

---

## 5. Approval Queue

Fichier lu : `app/(dashboard)/dashboard/campaigns/[id]/_components/ApprovalQueueClient.tsx`

Header : "Approval Queue" + "Review AI-personalized emails before sending. N pending."

Boutons globaux :
- "✨ Generate for matched prospects" — récupère les prospects avec au moins 1 signal, appelle /api/prospects/[id]/generate-personalized pour chacun en boucle séquentielle
- "Approve all (N)" — batch PATCH avec confirm "Approve all N variants in the queue?"

Par variant dans la liste :
- Header : nom du prospect + email + company (si renseignée)
- Badge bleu : 📡 N signal(s) · Step X
- Preview email sur fond #f7f8ff : "SUBJECT" (bleu) + texte + "BODY" + texte (whitespace-pre-wrap)
- Si variant édité (status === 'edited') : affiche edited_subject / edited_body

Actions par variant (3 boutons, gauche → droite) :
- "✗ Reject" (rouge) → PATCH { action: 'reject' } → retire du tableau local
- "✏ Edit" (neutre) → ouvre VariantEditModal
- "✓ Approve" (vert) → PATCH { action: 'approve' } → retire du tableau local

État vide : "📭 Approval queue is empty" + "Run signal scans on this campaign, then click 'Generate for matched prospects' to create personalized email variants."

Note : pas de bouton "Skip" ou "Regenerate" individuel visible dans ce composant.

---

## 6. Génération d'emails / envoi

Fichiers lus : `GenerateDraftsModal.tsx`, `SendingPreferencesPanel.tsx`, campaign [id]/page.tsx lignes 700–730

### GenerateDraftsModal

Titre : "Generate emails for N prospect(s)" (ou "Regenerate emails for N prospect(s)").

Si régénération : warning ambre "⚠️ This will overwrite all existing drafts for this campaign."

2 checkboxes :
- "📅 Include calendar booking link in this email" (défaut : false)
- "✍️ Include email signature in generated emails" (valeur depuis workspace profile signature_in_initial, mise à jour live)

2 modes en cards :
- ⚡ Fast — "Same email for all prospects, with their name and company auto-filled." / "⏱ Ready in seconds"
- 🎯 Smart (badge "Recommended") — "AI writes a unique opening line for each prospect based on their company and role." / "⏱ ~Xs for N prospects"

Boutons : "Cancel" + "Generate N email(s)" (ou "Regenerate N email(s)")

Pendant génération : barre de progression bleue + "N of N emails done" + "Mode: Smart/Fast"

### Boutons d'envoi dans la page campagne (onglet Emails)

Barre d'actions droite :
- "↺ Regenerate all" → GenerateDraftsModal (mode regen)
- "📅 Schedule" → désactivé, badge "Soon"
- "Send All" → désactivé, badge "Soon"

Par ligne de draft :
- "Edit" (bleu) → EditEmailModal
- "Reject" (rouge) → PATCH reject
- "Approve" (vert) → PATCH approve
- "Undo" (si statut final approved/sent/rejected) → retour en draft

⚠️ Note interne : Schedule et Send All sont "Soon" (désactivés) — la programmation d'envoi par campagne n'est PAS encore active côté UI ; seules les Sending Preferences globales existent. Impact scripts vidéo : ne pas montrer un schedule modal par campagne.

### SendingPreferencesPanel

Le user voit : panel inline (pas une modale), s'ouvre depuis un bouton Settings dans le dashboard.

3 champs :
- Default send time — <input type="time"> + label "recipient's local time"
- Send window — 2 <input type="time"> (start → end)
- Send days — pills cliquables : Mon / Tue / Wed / Thu / Fri / Sat / Sun (actif = contour bleu)

Résumé dynamique gris : "Emails will send [Mon, Tue, ...] between HH:MM and HH:MM, recipient's local time."

Boutons : "Reset" (restaure DEFAULT_SENDING_PREFS) + "Save sending preferences" → PUT /api/sending-preferences

---

## 7. Signals

Fichiers lus : `app/(dashboard)/dashboard/signals/page.tsx`, `SignalCreateModal.tsx`

### Page Signals

Titre "Signals" + tooltip "Signals auto-detect prospects ready to buy (funding, hiring, tech changes). Mirvo scans daily at 5am UTC and generates personalized variants for every matched prospect."

Sous-titre : "Monitor intent signals to find warm prospects automatically"

Bouton : "+ New Signal" (bleu)

Grille de cards (1/2/3 colonnes selon viewport). Chaque card :
- Icône Radio + nom du signal (bold)
- Badge "Demo" (jaune) si is_sample
- Badge "Active" (vert) ou "Paused" (gris)
- Menu ··· avec 1 option : Delete
- Description (2 lignes max)
- Méta : type (Template: Hiring role / Recent funding / Tech stack change ou Custom signal) + N prospect(s) matched + Last run X ago / Never

2 actions footer par card :
- "▶ Run on a campaign" (bleu, désactivé si paused, tooltip "Activate the signal to run it on a campaign.") → RunSignalModal
- "⏸ Pause" / "▶ Activate" (toggle)

Delete : confirm "This signal and all its matched prospects data will be permanently deleted." → "Cancel" / "Delete" (rouge)

### SignalCreateModal (state machine)

**Étape 0 — mode picker :**

Templates (3 cards) :
- 💼 Hiring [role] — "Job postings for specific roles"
- 💰 Recent funding — "Funding announcements at companies"
- 🔧 Tech stack change — "Tools installed on websites"

Custom :
- ✨ Custom signal (badge "Mirvo AI") — "Describe in plain English what to monitor" → bouton →

**Étape template — form :**
- "Signal name" (pré-rempli : "Hiring [role]" / "Recent funding" / "Tech stack change")
- Si hiring_role : "Role to monitor *" (texte libre, placeholder "e.g. Head of Sales, SDR, RevOps Manager") + "Company size (optional)" (pills 1-10 / 11-50 / 51-200 / 201-1000 / 1000+)
- Si recent_funding : "Funding stage (optional)" (pills Seed / Series A / Series B / Series C+) + "Minimum amount (optional)" (texte libre, "e.g. $10M+")
- Si tech_stack_change : "Tools to monitor *" (texte libre, "e.g. HubSpot, Salesforce, Outreach", hint "Comma-separated list of tools") + "Event type" (pills Installed / Uninstalled / Both)
- Footer : "← Back" + "Save signal"

**Étape custom — describe :** textarea 5 lignes, placeholder 'Example: "B2B SaaS companies that recently lost their Head of Sales (LinkedIn departures in last 60 days)"', min 20 chars. Footer : "← Back" + "Build with AI →" (désactivé si < 20 chars)

**Étape custom — building :** spinner + "Mirvo AI is analyzing your signal…" + "Checking feasibility and generating monitoring config"

**Étape custom — preview :**
- Si not feasible : banner rouge "✗ This signal isn't feasible to monitor publicly" + explication + liste de 6 alternatives publiques observables. Footer : "← Back to description".
- Si feasible : banner vert "✓ This signal is feasible to monitor", note optionnelle, champs éditables Name + Description, bloc "How we'll monitor it" (Source, Strategy, Keywords, Freshness en jours). Footer : "← Try different description" + "Save signal →"

---

## 8. Inbox / Replies

Fichier lu : `app/(dashboard)/dashboard/inbox/page.tsx`

Le user voit :
- Titre "Inbox" + "Replies from prospects across all campaigns"
- 4 tabs : All / Unread (N) / Starred / Archived
- Layout split panel : liste à gauche (w-80) + détail à droite (masqué sur mobile quand rien de sélectionné)

Chaque message dans la liste :
- Avatar initiales (cercle coloré calculé depuis nom ou email)
- Nom/email expéditeur, subject (truncated), body_preview (100 chars)
- Timestamp formaté (heure si today, jour semaine si < 7j, date sinon)
- Badge sentiment (si présent) : Interested (vert) / Meeting request (bleu) / Neutral (gris) / Not interested (rouge) / Unsubscribe (ambre) / Bounce (ardoise)
- Étoile cliquable (toggle starred)
- Non-lus : fond différencié

Le user peut (par message) :
- Cliquer → ouvre le détail + charge le thread via /api/inbox/messages/[id]/thread + marque comme lu
- Étoiler / dé-étoiler
- "Archive" (dans le détail)
- "Generate AI draft" → POST /api/inbox/draft → brouillon de réponse dans un textarea

Thread view : bulles chat style iMessage — envoyés à droite (fond #3b6bef blanc), reçus à gauche (fond blanc, bordure), whitespace-pre-wrap, timestamp sous chaque bulle.

Réponse : pas de bouton d'envoi visible dans le composant lu (textarea aiDraft généré, composant d'envoi pas dans l'extrait lu).

---

## 9. Pipeline

Fichier lu : `app/(dashboard)/dashboard/pipeline/page.tsx`

Le user voit :
- KPI bar : Total leads (tooltip), Active pipeline (exclut closed won/lost), Win rate (Won / (Won + Lost)), Total CA Won (USD), Meetings this week (lundi–dimanche)
- Tooltip "Add lead manually — for opportunities not coming from a Mirvo campaign (e.g. inbound leads, networking, referrals)"
- Kanban horizontal scroll, 9 colonnes avec header coloré bottom-border :

| Colonne | Couleur header |
|---|---|
| New Lead | Gris |
| Contacted | Bleu |
| Opened | Violet |
| Replied | Vert |
| Interested | Orange |
| Meeting Booked | Teal |
| Proposal Sent | Cyan |
| Closed Won | Emerald |
| Closed Lost | Rouge |

Cards de deal : nom du contact (ou email) + company + titre + montant (USD formaté) + badge "Nd" (jours dans le stage).

Drag & drop entre colonnes → PATCH stage en DB.

Closed Won / Closed Lost : compteur + montant total seulement. Clic header → ClosedDealsModal (liste triée par date de clôture).

CLOSED_REASONS (dropdown détail deal) : Not interested / No budget / Bad timing / Lost to competitor / Other

---

## 10. Analytics

Fichier lu : `app/(dashboard)/dashboard/analytics/page.tsx`

Le user voit :
- Filtre période (dropdown) : Last 7 days / Last 30 days / Last 90 days
- 5 KPI cards (grille 2→3→5 colonnes) : EMAILS SENT (noir) · OPEN RATE % (bleu #3b6bef) · REPLY RATE % (vert) · REPLIES (noir) · BOUNCE RATE % (rouge)
- Tableau "Campaign Breakdown" : CAMPAIGN / SENT / OPENED / OPEN % / REPLIES / REPLY % / BOUNCES (hover bg)
- Graphique "Daily Send Activity" : BarChart Recharts (barres bleues arrondies, labels tronqués 10 chars, axes X/Y, tooltip)

⚠️ Tech debt apparent : le filtre période ne filtre pas réellement les données (useEffect dépend de period mais la query Supabase récupère toutes les campagnes sans filtre date).

---

## 11. Meetings / Booking

Fichier lu : `app/(dashboard)/dashboard/meetings/page.tsx`

Le user voit :
- Titre "Meetings" + "Upcoming meetings and your booking page"
- Banner bleu "🔗 Your booking link" : mirvo.ai/book/[slug] + bouton "Copy"
- 3 boutons header : "+ Create" / "🔗 Copy link" / "⚙ Scheduler settings"
- Toggle view : "📋 List" / "📅 Calendar" (Calendar = placeholder "coming soon")
- 3 tabs : Upcoming / All / Cancelled

Chaque meeting card :
- Titre + badge status (scheduled bleu / completed vert / cancelled rouge / no_show orange)
- Date + durée + timezone
- Nom attendee + company
- Notes (si renseignées)
- "📅" → télécharge le fichier ICS
- Dropdown status inline : Scheduled / Completed / Cancelled / No-show
- "✕" → supprimer (confirm dialog)

Modal "Create meeting" : Title * · Date/heure * (datetime-local) · Duration 15/30/45/60 (select) · Attendee email * · Attendee name · Company · Notes. Toast si créé aujourd'hui : "Meeting created. Regenerate your Morning Brief to include it." + lien "Go to brief →"

Modal "Scheduler settings" :
- Booking URL : mirvo.ai/book/[slug] — slug éditable (a-z0-9- uniquement, max 30 chars)
- Enable booking page — toggle
- Timezone — select (13 options : America/Toronto, New_York, Chicago, Denver, Los_Angeles, Vancouver, Europe/London, Paris, Berlin, Asia/Tokyo, Singapore, Australia/Sydney, UTC)
- Availability — par jour (toggle on/off), plages start/end (<input type="time">), "+ Add window", suppression si plusieurs plages
- Meeting duration — 4 radios : 15 min — Quick discovery / 30 min — Standard call (recommended) / 45 min — Deep dive / 60 min — Strategy session
- Buffer between meetings — select : No buffer / 5 / 10 / 15 / 30 / 60 min
- Video meeting link (optionnel)
- Welcome message (optionnel, textarea)
- "Save settings" (désactivé si slug vide)

---

## ⚠️ Points relevés pour action (hors vidéos)

1. **Vendor invisibility violée** : checklist onboarding étape 5 affiche "CSV, Clay, or Signal-matched" — "Clay" exposé au user. Fix à briefer.
2. **Schedule / Send All par campagne = "Soon" (désactivés)** : la programmation d'envoi par campagne n'est pas active ; seules les Sending Preferences globales existent. Les scripts vidéo doivent montrer les Sending Preferences, pas un schedule par campagne.
3. **Welcome modal annonce "15 minutes to your first campaign"** : timing de référence interne (vs email Day 0 "<1 hour to first email") — choisir le claim cohérent pour les vidéos.
4. **Analytics : filtre période non fonctionnel** (tech debt, post-launch).
5. **Inbox : composant d'envoi de réponse non vu dans l'extrait lu** — vérifier avant de scripter la vidéo replies.

---

*Référence à jour au 11 juin 2026. Re-auditer la zone concernée avant tout script/copy si une feature a pu changer.*
