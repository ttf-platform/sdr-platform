# Mirvo — CURRENT STATE v16

*Document de référence Mirvo (ex-Sentra codename — naming finalisé 27 mai 2026). Snapshot complet de l'état du projet après marathon sessions 25-29 mai 2026.*

*Dernière mise à jour : 17 juin 2026 — Paris. **HEAD origin/main = `3b7783e3`** (#118). Depuis le snapshot v15 (29 mai, PR #93), trois runs : (a) **hardening + codebase TS-clean** (#94→#104) — 0 erreur TS, gate `ignoreBuildErrors: false` activé (#103) ; (b) **refonte génération email P0 + profil/ICP** (#105→#114) — voix humaine problem-first, i18n natif EN+FR, prefill ICP campagne, cohérence auto-fill ; (c) **signal→problème + passe Impeccable rétroactive** (#115→#118) — génération Signals problem-first, recolor blueprint, NewCampaignModal accessible (ui/Modal), associations label a11y. Détails §2.13→2.15. **Cible soft launch : 24 juin 2026.** Restant pre-launch : Clay enrichment + Instantly (activation juste avant launch), reconciliation `.impeccable/design.json` (S1 double bleu) + re-check contraste Playwright, rotation secrets + scan sécurité, fix signup email enumeration, finalisation pricing/landing pour ICP recruteurs. Voir MIRVO_CODE_MAP.md (régénéré 17 juin) pour l'état physique du code.*

---

## 1. Status global

| Item | État |
|---|---|
| Phase | Pre-launch, ~3 semaines d'avance sur schedule. **Sprint Onboarding système ✅ COMPLET (1A→1C.2.2)**. **Sprint Mobile Responsive ✅ COMPLET**. **Sprint 2 Email automation Resend ✅ COMPLET 29 mai** (PR #89). **Sprint 3 Help Center MDX ✅ COMPLET 29 mai** (PR #90 + #91 + #92 + #93). Console fixes ✅ COMPLET. Mirvo rebrand finalisé ✅. **DNS mirvo.ai LIVE ✅**. **Admin status indicator dynamique LIVE ✅**. **Palette landing #2563eb canonical**. Restant : Clay enrichment + Sprint 4 Videos (Max-solo) + Stripe live mode + Stripe Communication preferences + OWASP scan + Phase 1.2 légales + Bloc E3 Instantly bloqué. |
| Naming | **Mirvo finalisé 27 mai** (domain `mirvo.ai` Cloudflare 2y $160, Resend setup mirvo.ai DKIM/SPF/MX/DMARC verified + Cloudflare Email Routing hello/max/contact/support/catch-all + **admin@mirvo.ai** → cyrus@noos.fr). **ADMIN_NOTIFICATION_EMAIL=admin@mirvo.ai** (migré 29 mai). **FROM_ADDRESS=Mirvo <hello@mirvo.ai>** (migré 29 mai depuis `onboarding@resend.dev` via PR #89). |
| Sprints complétés à ce jour | 60+ sprints depuis début projet ; **35 PRs marathon 25-26 mai (#31→#66) + 4 PRs Mirvo rebrand/tech debt 27 mai (#67→#70) + 12 PRs Onboarding 27-28 mai (#71→#81) + 5 PRs session 28 mai (#82→#86) + 1 commit direct main `f7e1c8a2` (skill palette) + 2 PRs session 28-29 mai (#87 a11y + #88 admin status) + 5 PRs session 29 mai (#89 Sprint 2 + #90 Sprint 3 + #91 fix MDX runtime + #92 fix render quality + #93 Sprint 3 Phase 8) + 1 hotfix direct main `ddf93d31` (MDX prerender escape)** = 63 PRs + 2 direct commits sur 9 jours |
| Sprints restants avant launch | Clay enrichment integration (pre-launch critique : EnrichmentProvider + Find Prospects + Prospect Credits, $185-495/mo) + Sprint 4 Videos (Max solo, Tella $15/mo + HeyGen $29) + Stripe live mode + Communication preferences setup (~1j critical) + OWASP scan + rotation secrets (~1-2j fin) |
| Stack technique | Next.js 15 App Router (TypeScript ES2017), React 19, Supabase **Pro plan $25/mo** avec daily backups 7j, Vercel Pro, Stripe (test mode), **Resend (Mirvo domain `mirvo.ai` verified) + FROM_ADDRESS `hello@mirvo.ai`**, Anthropic Claude SDK 0.97.1, Resend SDK 6.12.3, **PostHog Cloud EU project 180750 direct api_host**, **Upstash Redis Ratelimit free tier**, GitHub Action security-review SHA pinned, **`/security-review` Claude Code AI Security Analysis automatique sur PR**, **`@next/mdx` + `gray-matter` + `@tailwindcss/typography` + `remark-frontmatter` + `remark-mdx-frontmatter`** (PR #92), **next.config.mjs** (migré depuis .js pour ESM remark plugins, PR #92) |
| URL prod | **`https://www.mirvo.ai/en` (DNS LIVE 29 mai, www canonical, apex 307→www, SSL provisioned)** + fallback `https://sdr-platform-sigma.vercel.app` |
| Domaine launch | **`mirvo.ai` LIVE** : DNS Cloudflare CNAME apex+www → `6229eedd197eee7d.vercel-dns-016.com` (Proxy DNS-only gris), Vercel SSL Let's Encrypt provisionné, redirect apex `mirvo.ai` 307→`www.mirvo.ai/en` |
| Plan default trial | Power 14j |
| Provider email transactional | **Resend (Mirvo compte dédié) + FROM `hello@mirvo.ai` ✅ PR #89** : helpers `sendAdminEscalationEmail`, `sendAdminBugReportEmail`, `sendOnboardingEmail` (day 0/2/4/7) |
| Provider email outbound | MockEmailProvider en place, Instantly à activer Sprint 8 S4 (Bloc E3 send pending) |
| **Cron onboarding emails** | ✅ **PR #89** : `/api/cron/onboarding-emails` daily 10am UTC + table `onboarding_emails` (mig 049, UNIQUE workspace_id+day_offset, RLS deny-all, idempotency) + 4 templates HTML inline (welcome / signals / deliverability / week-recap) + skip workspaces `plan_tier='paid'` après day 0 |
| **Help Center MDX** | ✅ **PR #90 + #91 + #92 + #93** : 21 articles MDX `/help/<slug>`, routing `[locale]/help/[slug]/page.tsx` avec generateStaticParams, composants Steps/Callout/Screenshot/Video, prose typography (@tailwindcss/typography), YAML frontmatter stripped (remark plugins), 25/35 screenshots réels capturés via pipeline Playwright re-runnable `npm run help:all`, 10 placeholders restants pour features pas build, FRBanner sur `/fr/help/*` |
| Sécurité headers | ✅ Active CORP same-origin + X-Frame-Options DENY + X-Content-Type-Options + Referrer-Policy + Permissions-Policy + HSTS + X-DNS-Prefetch-Control on + X-Permitted-Cross-Domain-Policies none (PR #53) |
| CSP | ✅ Enforcement actif prod + **skip dev mode** (PR #54 + #58 stray fix) |
| Cookie NEXT_LOCALE Secure | ✅ Sprint 1.1.fix.B `f3a75ba2` |
| CAPTCHA signup | ✅ Cloudflare Turnstile Managed mode + backend siteverify (Sprint 1.1.fix.C `95c27243`) |
| Rate limiting | ✅ **Upstash Ratelimit sliding window 3 buckets** (SR3 PR #44+#46) : global 60/min per-IP, write 30/min per-IP, AI 50/min per-workspace |
| PostHog Error Tracking | ✅ **SR1 PR #42** : capture_exceptions activé + instrumentation.ts onRequestError hook + posthog-node EU. **Notifications email** : workaround V1 via préférences profil PostHog (Email destination déprécié du wizard Error tracking Alerting — à upgrade post-launch via Slack OR HTTP Webhook). |
| /api/health endpoint | ✅ **SR2 PR #43** : JSON status 200/503 avec DB+Stripe parallel checks + Anthropic+Resend env presence checks + 3s timeout |
| /status page public | ✅ **SR2 PR #43** : page no-auth + banner ok/degraded/down + per-service status + auto-refresh 30s |
| /status indicators in Admin | ✅ **PR #88** : `<AdminStatusIndicator />` dans `app/admin/_components/`, dot coloré 5 états + label texte (vendor-invisible) + click-through `/status` + poll `/api/health` setInterval 30s + cleanup clearInterval. |
| DB backups | ✅ **SR4 PR #49** : Supabase Pro plan upgrade $25/mo + daily backups 7j retention + restore runbook `docs/DB_RESTORE_RUNBOOK.md` |
| GDPR cookie consent banner V1 | ✅ **PR #48 + #55 + #84** : lib/cookie-consent.ts + components/CookieConsentBanner.tsx (bottom-right) + Accept/Reject + gate PostHog init + UTMCapture gate + Secure flag conditional HTTPS only (Safari localhost fix). **No-reload UX verifié prod 29 mai** : scroll position préservée + 9 requêtes PostHog post-Accept sans reload. |
| Cookie banner link a11y/SEO | ✅ **PR #87** : "Learn more" → "Read our cookie policy" (descriptif) + `hover:underline` → `underline` permanent. |
| LocaleSwitcher contrast AA | ✅ **PR #87** : `text-[#8a7e6e]` (4.38:1) → `text-[#6b5e4e]` (~5.78:1) sur fond `#faf8f5`, passe AA. |
| Onboarding système COMPLET | ✅ **PRs #71→#81** : Welcome modal + OnboardingChecklist floating + ResumeOnboardingButton + Spark animations + Empty states + 5 tooltips premium + Help Center skeleton (étoffé Sprint 3) + Sample data "Try Mirvo" + SampleDataBanner amber + Demo badges + Auto-detection sample exclusion + Approval count fix + Signup error backend. 3 migrations 045-047. |
| Session 28 mai — landing Signals + quick wins | ✅ **PRs #82→#86** : #82 signup email-exists bloqué étape 1 (mig 048 + /api/auth/check-email) · #83 apple-touch-icon · #84 cookie banner no-reload · #85 createClient() async Next15 · #86 landing **SectionSignals** EN+FR. |
| Session 28-29 mai overnight — Quick wins enchaînés | ✅ **6 quick wins** : (a) palette skill alignment commit direct `f7e1c8a2` · (b) ADMIN_NOTIFICATION_EMAIL → `admin@mirvo.ai` · (c) cookie banner no-reload prod verified · (d) DNS mirvo.ai LIVE · (e) Lighthouse baseline + PR #87 a11y/SEO · (f) PR #88 admin status indicator. |
| **Session 29 mai — Sprint 2 + 3** | ✅ **5 PRs** : #89 Sprint 2 Email automation Resend (cron day 0/2/4/7 + FROM hello@mirvo.ai + mig 049 idempotency) · #90 Sprint 3 Help Center MDX (21 articles) · #91 fix MDX dev runtime (static map vs dynamic import) · #92 fix render quality (frontmatter strip + prose + Screenshot placeholders) · #93 Sprint 3 Phase 8 screenshots automation (25/35 captures + pipeline re-runnable). **+ 1 hotfix direct main `ddf93d31`** : escape `{firstName}` MDX placeholders pour éviter prerender ReferenceError. |
| Mirvo rebrand finalisé | ✅ **PRs #67→#70** : code rebrand Sentra→Mirvo + domain mirvo.ai + Resend nouveau compte + DNS + Cloudflare Email Routing + env vars Vercel + prompt caching Anthropic (PR #69) + bot Signal fix (PR #70) |
| Custom Signal Builder V1 | ✅ **PRs #31→#40** : 9 sub-blocs (mig 042 signals/prospect_signals + API+Claude scan + UI signals create modal + Run backend + Run UI + drawer per prospect + Approval Queue backend mig 043 prospect_email_variants + UI Approval Queue + fix). Bloc E3 send Instantly DIFFÉRÉ Sprint 8 S4. |
| Pricing Triple Protection | ✅ **PR #41** : silent backend mig 044 signal_scan_events + lib/scan-limits.ts + 3 layers. |
| V2 Discovery V1 auto-scan cron | ✅ **PR #45 + #47 fix** : refactor signal-scanner.ts helper + cron /api/cron/auto-scan-signals daily 5am UTC. |
| SEO/perf/security batches | ✅ **PRs #50→#53** : sitemap+robots + custom 404/500 + OG metadata + manifest + JSON-LD + DNS prefetch + security headers + Spinner+EmptyState. |
| Sprint Mobile Responsive COMPLET | ✅ **PRs #56→#62 + #65 + #66** : 41 issues + sidebar drawer + overflow tabs + responsive table card view + 18 modal mobile fixes. |
| Console fixes | ✅ **PRs #63→#66** : manifest path + PostHog direct api_host + params.id async + PostHog skip dev + JSON-LD hydration + middleware static bypass. |
| Cron jobs Vercel | ✅ /api/cron/hard-delete-users daily 3am UTC + /api/cron/trial-expiry + /api/cron/daily-cost-check daily 9am UTC (PR #41) + /api/cron/auto-scan-signals daily 5am UTC (PR #45) + **/api/cron/onboarding-emails daily 10am UTC (PR #89)**. |
| Tests RLS | ✅ 55 tests verts sur 4 fichiers, 5 patterns RLS couverts |
| Zod validation | ✅ ~71% routes payload-validated (44/62) |
| Lighthouse baseline 29 mai | ✅ **Mobile** : Perf 67 / A11y 96 / BP 100 / SEO 92. **Desktop** : Perf 100 / A11y 92 / BP 100 / SEO 92. Mobile Perf 67 = post-launch perf sprint dédié. Color-contrast Ash `#9a9a9a` landing-wide (18 éléments) → post-launch a11y sprint dédié. |
| Dette tech post-launch DONE | ✅ Sprint Tech Debt 21/5 : SDK Anthropic+Resend+singletons. ✅ Sprint B 21/5 : typedRoutes+PostHog+42 routes params Promise. ✅ Incohérence palette tranchée 29 mai : `#2563eb` canonical, skill aligné `f7e1c8a2`. ✅ ADMIN_NOTIFICATION_EMAIL migré 29 mai vers `admin@mirvo.ai`. ✅ FROM_ADDRESS migré 29 mai vers `hello@mirvo.ai` (PR #89). **Reste** : App auth i18n complet (V1 EN only) ; 58 TS errors pré-existants. |

---

## 2. Sessions récentes détaillées

### 2.1 Marathon 27-28 mai — Mirvo rebrand + Onboarding système

**Phase 1** — Mirvo rebrand finalisé (27 mai matin) :
- Domain `mirvo.ai` acheté Cloudflare $160/2y
- Resend nouveau compte Mirvo verified (DKIM/SPF/MX/DMARC)
- Cloudflare Email Routing 5 aliases @mirvo.ai → cyrus@noos.fr
- PRs #67-#70 (code rebrand, prompt caching, bot Signal fix)

**Phase 2** — Sprint Onboarding système (27-28 mai, 12 PRs #71→#81) :
- 7 layers : Welcome modal + Checklist + Empty states + Tooltips + Reminders & Nudges + Lightweight KB + Celebration moments
- Migrations 045/046/047 + sample data "Try Mirvo" + auto-detection completion
- Details v14 §2.2 (PRs détaillées)

### 2.2 Session 28 mai — Landing Signals + quick wins (PRs #82→#86)

- #82 signup email-exists bloqué étape 1 (mig 048 RPC + `/api/auth/check-email`)
- #83 apple-touch-icon
- #84 cookie banner no-reload (`initPostHogIfAllowed()`)
- #85 `createClient()` async Next.js 15 (~44 call sites)
- #86 landing SectionSignals EN+FR

### 2.3 Session 28-29 mai overnight — 6 quick wins enchaînés

Détails v14 §2.7. Récap : palette skill alignment `f7e1c8a2` + ADMIN email migration + cookie banner verif + DNS mirvo.ai LIVE + Lighthouse + PR #87 a11y/SEO + PR #88 admin status indicator. HEAD intermédiaire = `fa866f45`.

### 2.4 Bug signup email enumeration — RÉSOLU (PR #82)

Détails v14 §2.6. Note pour reprise : 5-min fix résiduel pour le trick côté backend (`signupData?.user?.identities?.length === 0`) est connu et traîne, à FIX next session quand opportunité.

### 2.5 Session 29 mai — Sprint 2 Email automation Resend (PR #89)

**Livré** :
- Branche `feat/onboarding-email-sequence`, mergée → SHA `e24303a2`
- Migration 049 `onboarding_emails` (workspace_id + day_offset SMALLINT + sent_at + resend_message_id + UNIQUE constraint + RLS deny-all client)
- `lib/email.ts` : FROM_ADDRESS switched `onboarding@resend.dev` → `hello@mirvo.ai` + nouveau helper `sendOnboardingEmail()` + map `ONBOARDING_TEMPLATES` (day 0/2/4/7) + helper `wrapEmail()`
- Cron `/api/cron/onboarding-emails` daily 10am UTC : pattern `daily-cost-check` (CRON_SECRET fail-closed Buffer.timingSafeEqual), iterate workspaces, calcul `days_since_signup` (tolerance ±1j), skip workspaces `plan_tier='paid'` après day 0, send-then-insert pattern
- `vercel.json` cron schedule ajouté

**Incident pendant test** :
- CC a shipped sans valider la migration AVANT le test cron → 9 emails réels partis à des users prod sans idempotency log
- Backfill manuel via SQL Editor : INSERT des 9 rows (workspace_id + day_offset + message_id) après application migration 049
- Re-test cron post-backfill : `{"processed":39,"sent":0,"skipped":156,"errors":[]}` → idempotency confirmée, pas de doublon
- Validation From header : Resend a accepté les 9 envois (preuve que domain verified + From accepté), `FROM_ADDRESS` constant confirmée en code

### 2.6 Session 29 mai — Sprint 3 Help Center MDX (PR #90)

**Décisions arbitrées** :
1. Stack : `@next/mdx` + `gray-matter` + `pageExtensions: ['ts','tsx','mdx']`
2. Routing : `app/[locale]/help/page.tsx` (index) + `app/[locale]/help/[slug]/page.tsx` (article dynamique via `generateStaticParams`)
3. i18n contenu : EN-only V1, FRBanner sur `/fr/help/*` ("FR translations coming soon — content shown in English.")
4. Articles : 21 (vs 18 initialement, +3 ajoutés : `linking-your-mailbox` / `picking-your-prospects` / `reading-your-reply-inbox`)
5. Composants MDX custom : `<Steps>`, `<Callout type="info|warning|tip">`, `<Screenshot src alt caption [placeholder]>`, `<Video src poster>`
6. Palette : `#2563eb` canonical
7. Vidéos Sprint 4 (Max-solo) : placeholders `<Video>` préparés mais URLs vides

**Inventaire 21 articles** (par catégorie) :
- **Getting started** : how-mirvo-works, 7-step-setup, master-icp, linking-your-mailbox, picking-your-prospects
- **Sending infrastructure** : adding-a-sending-domain, mailbox-warmup-explained, why-emails-go-to-spam
- **Signals** : what-are-signals, creating-custom-signals, auto-scan-and-approval-queue
- **Campaigns & AI** : create-your-first-campaign, how-ai-writes-personalized-emails, subject-line-best-practices
- **Approval & sending** : approval-queue-workflow, editing-ai-variants, launch-campaign-checklist
- **Replies** : reading-your-reply-inbox
- **Troubleshooting** : troubleshooting
- **Billing** : plans-pricing, quotas-explained

**Framing rules absolues appliquées** :
- Em-dashes interdits → grep final 0 (skill Mirvo)
- Vendor invisibility totale → grep final 0 sur Resend/Anthropic/Claude/Instantly/Clay/OpenAI
- Prospects-first → AI drafts personalized per prospect (PAS templates) → Optional Signals additif → Approval Queue → Send + replies sorted by intent
- Signals = précision optionnelle (PAS workflow exclusif) — voir mémoire #30
- Frontmatter standard : title / description / slug / category / order / last_updated
- Cross-links : utilisent les slugs exacts du manifest

**Markers pre-launch** :
- `<!-- PRICING_DATA -->` dans `plans-pricing.mdx` (3 plans, mettre à jour avant launch quand cost plan final)
- `<!-- LIMITS_DATA -->` dans `quotas-explained.mdx` (caps, mettre à jour idem)

### 2.7 Hotfix MDX prerender — direct commit `ddf93d31`

Build prod fail avec `ReferenceError: firstName is not defined` sur `/en/help/how-ai-writes-personalized-emails`. Cause : `{firstName}` en clair dans le contenu MDX interprété comme expression JavaScript. Fix : escape les merge field placeholders dans backticks (code inline MDX). 3 occurrences trouvées dans 2 fichiers (`{firstName}` ×2, `{company}` ×1).

### 2.8 Session 29 mai — Fix MDX dev runtime (PR #91)

**Symptôme** : prod build PASSE (162 static pages OK), mais dev Webpack fail au runtime sur navigation `/en/help/<slug>`. Error "Module parse failed: Assigning to rvalue" — Webpack ne reconnaît pas le YAML frontmatter au runtime.

**Cause root** : dynamic import `import(`@/content/help/${slug}.mdx`)` bypass le loader MDX de `@next/mdx` au dev runtime — Webpack résout l'expression lazily et skip le MDX transform. Static imports nommés sont parsés au build, loader appliqué correctement dans les deux environnements.

**Fix livré par CC** (meilleur que ce que j'avais proposé en `next-mdx-remote`) : créer un static MDX_MODULES map dans `lib/help/mdxModules.ts` avec un import statique par article. La page `[slug]/page.tsx` fait un lookup `MDX_MODULES[slug]` au lieu du dynamic import. Diff minimal, pas de nouvelle dépendance, dev+prod consistent. SHA `fb94f37d`.

### 2.9 Session 29 mai — Fix render quality (PR #92)

**3 issues confirmées par audit** :
1. `createMDX({ extension: /\.mdx?$/ })` sans `remarkPlugins` → YAML frontmatter `--- title:... ---` rendu en texte
2. `tailwind.config plugins: []` → `@tailwindcss/typography` non installé → `prose prose-neutral` classes inactives dans HelpLayout → typo plate
3. `Screenshot` component sans mode placeholder + les `[SCREENSHOT: description]` jamais remplacés par le composant dans les 21 .mdx

**Fixes livrés** :
1. `npm install remark-frontmatter remark-mdx-frontmatter` + ajout aux `remarkPlugins` dans createMDX
2. `npm install -D @tailwindcss/typography` + plugin ajouté dans tailwind.config
3. Screenshot component : early-return placeholder mode (border dashed + "Screenshot coming soon" badge + caption) si `placeholder` prop ou pas de `src`
4. Script Python bulk replace : 35 `[SCREENSHOT: description]` → `<Screenshot placeholder alt='...' caption='...' />`

**Migration `next.config.js` → `next.config.mjs`** : nécessaire car `remark-frontmatter` + `remark-mdx-frontmatter` sont ESM-only. Confirmé seul `next.config.mjs` présent (pas d'ambiguïté). SHA `47d49532`.

### 2.10 Session 29 mai — Sprint 3 Phase 8 Screenshots automation (PR #93)

**Décisions arbitrées** :
- A : test account dédié (`screenshots-bot@mirvo.test`) seedé via fixtures Playwright (no PII, reproductible)
- B : auto-max — capture tout ce qui est techniquement faisable, skip + placeholder pour features absent
- C : script versionné + idempotent (`npm run help:all` re-runnable)

**Pipeline livré** :
- `scripts/help-screenshots/seed.ts` : reset+recrée test account Supabase avec workspace + ICP + email_account mock + 1 campaign + 7 prospects + drafts + 3 signals
- `scripts/help-screenshots/inventory.ts` : scan content/help/*.mdx → manifest.json 35 entrées
- `scripts/help-screenshots/capture.ts` : Playwright headless 1440×900, login UI (Turnstile absent sur login page), 25 captures sauvegardées
- `scripts/help-screenshots/replace.py` : remplace `<Screenshot placeholder>` → `<Screenshot src='/help/screenshots/...'>` dans MDX
- `package.json` scripts : `help:seed` / `help:capture` / `help:replace` / `help:all`

**Corrections schema appliquées par CC** (notes pour seed.ts) :
- `workspaces` n'a pas de colonnes ICP — elles sont dans `workspace_profiles` (table séparée)
- Table `mailboxes` n'existe pas — c'est `email_accounts` avec `domain`, `email_address`, `sender_name`
- `signals.source_type` : `'keyword'` n'est PAS une valeur valide → corrigé en `'custom'`
- URLs dashboard sans préfixe `/en/` (les routes `(dashboard)/dashboard/` ne sont pas sous `[locale]`)
- Auth : magic link → login UI plus fiable (Turnstile absent sur login)

**Résultats** :
- 25 captures réelles dans `public/help/screenshots/` (14 articles mis à jour)
- 10 placeholders restants (features non capturables, documentées dans `screenshots-skipped.json`) :
  - Reply inbox non construit
  - DNS verification steps 2/3 (nécessitent propagation réelle)
  - Résumé final wizard multi-étapes
  - Signal condition editor (nécessite signal ID dans URL)
  - Thread de réponse (nécessite reply seedée)
  - Overlay annoté (pas un élément natif)
  - Modal import CSV
- Build clean, screenshots visibles via Playwright MCP ✅

**Qualité moyenne — à refaire post-launch** : Welcome modal au premier plan sur la majorité des captures, captures répétitives. Pour Phase 8 V2 : Playwright doit dismiss welcome modal + onboarding tooltips AVANT chaque capture + varier les states UI (cf. mémoire #30).

### 2.11 État UI final post-Sprint 3

- Help Center index `/help` : 21 articles listés par catégorie, links cliquables
- Articles `/help/<slug>` : H1 + content prose typography, FRBanner sur `/fr/help/*`, Steps/Callout/Screenshot/Video composants stylés
- 25 screenshots réels intégrés, 10 placeholders "Screenshot coming soon" pour features non capturables
- Cross-links entre articles fonctionnels
- Frontmatter YAML stripped (invisible côté user), exposé comme `frontmatter` named export disponible si besoin

### 2.12 Issues rencontrés / patterns observés cette session

- **CC ship sans valider migration AVANT test cron** (Sprint 2) → 9 emails réels partis sans idempotency. Backfill manuel SQL. Rule 21 (rigueur ABSOLUE) renforcée.
- **MDX dev Webpack edge case** : dynamic import depuis `content/` skip loader au runtime même si build OK. Pattern à connaître : pour content directories, préférer static imports OU `next-mdx-remote`.
- **YAML frontmatter no auto-strip avec `@next/mdx`** : besoin explicite de `remark-frontmatter` + `remark-mdx-frontmatter`. Sinon rendu comme texte body.
- **`@tailwindcss/typography` mandatory pour `prose` classes** : sans plugin, les classes sont littéralement ignorées par Tailwind, pas d'erreur visible, juste typo plate.
- **`next.config.mjs` migration** : nécessaire pour ESM-only plugins (`remark-*`). Renommer le fichier, pas de logique à changer (modules.exports → export default).
- **Playwright headless + Welcome modal** : si non dismissé, masque le contenu dans toutes les captures. Toujours setup state propre avant capture batch.
- **5 violations workflow par Claude (29/5)** : pbcopy oublié × 3, anticipation × 5, ask manual editing × 1, attendus × 2, doc UI tierce inférée × 1. Rules 19+20 renforcées en mémoire.

---

### 2.13 Run 30 mai→mi-juin — Hardening + codebase TS-clean (#94→#104)

- **#94** rate limit IP sur booking public POST (10/10min).
- **#95** Help screenshots : dismiss welcome modal + cookie banner dans `capture.ts` + guard `CreditUsageIndicator` (usage undefined → crash billing).
- **#96** fix runtime : anthropic client passé à `ensureInitialStep` + `body.reason` undefined dans bot escalate (bugs masqués par `ignoreBuildErrors`).
- **#97** `prospectImportSchema` en discriminated union sur `mode` (10 TS errors, validation import renforcée).
- **#98** sécurité : password runtime random + guard `ALLOW_SEED` sur le script help seed ; support `pre_action` dans capture.
- **#99→#102 — sprint TS errors → 0** : `await cookies()` login Next 15 (#99, 9 err — **les cookies de session n'étaient pas persistés au runtime**, bug réel masqué par le gate TS off) · `.returns<T>()` email-accounts (#100, 3 err) · cast Link hrefs `as Route` typedRoutes (#101, 24 err) · résolution des 18 dernières (#102).
- **#103** `ignoreBuildErrors: false` activé — **gate TS désormais dur** (le build échoue sur toute erreur de type).
- **#104** onboarding : vendor invisibility + fix copy timing claim.

### 2.14 Run mi-juin — Génération email P0 + profil/ICP (#105→#114)

- **#105 — Email-gen voix humaine P0** : prompts problem-first, anti-cadence-AI, auto-révision, rebuild des templates ICP. Nouveau `lib/ai-voice.ts` : `HUMAN_VOICE_RULES`, `STRATEGY_VOICE_RULES`, `selfRevisionBlock(wordCap)`.
- **#106** sweep em-dashes hors de tous les prompts + commentaires de code.
- **#107** settings : clarté profile completion (pills missing-field + deeplinks, dirty-state Save, toast, persistance auto-fill). **#108** fix sticky badge (`top-12` clear nav, masqué à 100%, sorti du div header).
- **#109** NewCampaignModal : prefill ICP **structuré** depuis Master ICP + **suppression du "Parse with AI" par campagne** (il re-dérivait et écrasait la donnée curée ; enum tailles aligné).
- **#110** auto-fill : cohérence ICP **interne** (titres/tailles cohérents avec la description que le parse produit lui-même).
- **#111** ICP : alignement enum `tone` (pills vs auto-fill) + dirty-state Save/Reset + copy didactique Master ICP ("source of truth every campaign builds on").
- **#112 — i18n natif** : génération directe dans la langue cible (EN+FR) sur tous les chemins AI via `languageDirective`, écrit nativement (pas de traduction). Sélecteur limité à EN+FR (DE/ES/IT cachés V2).
- **#113** carte next-step contextuelle sur l'onglet overview campagne (Add prospects → Generate → Review & approve).
- **#114** polish : prénom une seule fois (greeting, jamais répété dans le body) + hint sous le champ "Your title".

### 2.15 Session 17 juin — Signal→problème + passe Impeccable rétroactive (#115→#118)

- **#115 — signal→problème** dans `generate-personalized` : l'intro raisonne du signal vers le **problème opérationnel** qu'il implique (plus de name-drop ni de félicitations), `HUMAN_VOICE_RULES` injecté, `signals.description` utilisé comme hypothèse d'intention. *Clarification : le système Signals est IMPLÉMENTÉ FONCTIONNEL (builder + cron auto-scan + variants + Approval Queue). Le seul vrai bloqueur reste Clay enrichment, pas les signaux. Donc signal→problème, pondération fraîcheur et synthèse multi-signaux sont faisables maintenant ; seule l'injection enrichment dépend de Clay.*
- **Passe Impeccable rétroactive** sur les PR UI mergées sans le gate 4-pass obligatoire (#107/#108/#109/#111/#113). Phase 1 = audit read-only, puis corrections :
  - **#116 — C8 + C1** : panel ICP purple → blueprint (recolor perl déterministe vers `#3b6bef`, **pas** via `/impeccable polish` car sa `design.json` est désync) + retrait du side-tab `border-l-4` dans `ProfileQualityBadge` + variante `blueprint` ajoutée à `components/StatusBadge.tsx`.
  - **#117 — A5/A6** : `NewCampaignModal` migré vers le primitive accessible `components/ui/Modal.tsx` (role=dialog, aria-modal, focus trap, ESC, scroll lock, restore focus, portal).
  - **#118 — S2** : associations label↔contrôle (`htmlFor`/`id`) sur NewCampaignModal + settings + form Master ICP (23 couples + 2 aria-label sur textareas sans label visible).
- **Catch important — S1 à l'envers.** Impeccable a flaggé `#3b6bef` comme stray vs son `design.json` (`#2563eb`). Vérif grep : `#3b6bef` **EST** le bleu de marque (wordmark Mirvo, partout : auth, booking, dashboard) ; `#2563eb` est l'outlier (~8 endroits : focus ring contact/about + puces legal). Suivre Impeccable aveuglément aurait repeint toute la marque. → **Backlog (hors run) :** aligner les `#2563eb` → `#3b6bef` + resynchroniser `.impeccable/design.json` sur `#3b6bef`.
- **Reste ouvert pour clore la passe :** re-check contraste WCAG via Playwright sur surfaces rendues (Impeccable n'a pas pu — app derrière auth gate + dev server éteint) ; group labels (Company Size/Revenue, pills tone) → `<span>` + `role="group"` (follow-up mineur).
- **Workflow confirmé cette session :** merges en **TTY réel** (`gh pr merge` no-op silencieux via l'env non-TTY de CC) ; diff brut systématiquement relu avant merge (a permis de cadrer les déviations CC : footer flex-1 conservé #117, fix em-dash commentaire #116, badge variant prop #116).

## 3. Sprints récents précédents (25-26 mai 2026)

Pour rappel synthèse des marathons précédents (détails section 3 du v14) :

### 3.1 Sprint Custom Signal Builder V1 (25 mai — PRs #31 à #40)
9 sub-blocs avec migration 042 (signals/prospect_signals) + Approval Queue (mig 043). Bloc E3 send Instantly DIFFÉRÉ Sprint 8 S4.

### 3.2 Sprint Pricing Triple Protection (26 mai PR #41)
3 layers : monthly cap per tier + rate limit 200 prospects/10min/workspace + daily cost cron $50.

### 3.3 Operational Readiness SR1-SR4 (26 mai)
SR1 PostHog Error Tracking (PR #42), SR2 /api/health + /status (PR #43), SR3 Upstash Ratelimit (PR #44+#46), SR4 Supabase Pro backups (PR #49).

### 3.4 V2 Discovery V1 auto-scan cron (26 mai PR #45+#47)
Refactor `signal-scanner.ts` + cron daily 5am UTC.

### 3.5 GDPR cookie consent banner V1 (26 mai PRs #48+#55)
`lib/cookie-consent.ts` + banner bottom-right + gate PostHog init.

### 3.6 SEO+Perf+Security batches (26 mai PRs #50-#53)
Sitemap+robots + 404/500 + OG + manifest + JSON-LD + DNS prefetch + security headers.

### 3.7 Sprint Mobile Responsive COMPLET (26 mai PRs #56-#62)
41 issues + sidebar drawer + overflow tabs + responsive table card view + 18 modal mobile fixes.

### 3.8 Console fixes (26 mai PRs #63-#66)
Manifest path + PostHog direct api_host + params.id async + PostHog skip dev + middleware static bypass.

---

## 4. Pre-launch checklist actualisée (29 mai post-Sprint 2+3)

### Critical pre-launch (must)
- [x] **Bug signup email enumeration fix** — ✅ PR #82 (résiduel 5-min trick côté backend traîne, à fix next session quand opportunité)
- [x] **DNS `mirvo.ai` → Vercel** — ✅ 29 mai
- [x] **ADMIN_NOTIFICATION_EMAIL → adresse Mirvo dédiée** — ✅ 29 mai `admin@mirvo.ai`
- [x] **Sprint 2 — Email automation Resend** — ✅ **29 mai PR #89**
- [x] **Sprint 3 — KB articles MDX** — ✅ **29 mai PRs #90+#91+#92+#93**
- [ ] **Clay enrichment integration** (pre-launch CRITIQUE) : EnrichmentProvider abstraction + branchement Find Prospects + enforcement Prospect Credits, vendor-invisible. +$185-495/mo. Sprint dédié.
- [ ] **Stripe live mode setup** : switch test→live + create products live + configure webhook live + signing secret. **Coupler avec Stripe Communication preferences** (toggles grisés en test : `dashboard.stripe.com/settings/communication-preferences` → activer Échecs de paiement + Litiges + Détection fraude Radar + Solde négatif + Remboursements inattendus + déjà OK en test). ~1j critical.
- [ ] **OWASP scan + rotation tous secrets** : skill claude-security-audit VicKayro OR CheckVibe scan + rotate Stripe/Supabase/Anthropic/PostHog/Vercel/Upstash/Cloudflare secrets. EN FIN avant launch. ~1-2j.
- [ ] **Phase 1.2 légales juriste freelance EU** (Max async). NE PAS relancer.

### Should pre-launch
- [ ] **Sprint 4 — Videos AI** (Max solo) : 4 walkthroughs Tella ($15/mo) + 1 video flagship "Mirvo en 90s" HeyGen ($29 one-time). Placeholders `<Video>` déjà préparés dans Help Center.
- [ ] **Bloc E3 send Instantly** : couplé Sprint 8 S4 (activation Instantly Hypergrowth account $97/mo)
- [ ] **Mobile responsive smoke test final** sur prod après naming complet
- [x] **Cookie consent banner UX no-reload** — ✅ PR #84 + verif prod 29 mai
- [x] **Page /status indicators intégrés dans Admin** — ✅ PR #88
- [x] **a11y/SEO quick fixes** — ✅ PR #87

### Post-launch acceptable
- [ ] **Refaire Help Center screenshots Phase 8 V2** : 25 captures actuelles ont Welcome modal en premier plan + répétitives. Pipeline existant à étendre : dismiss welcome modal + onboarding tooltips AVANT capture, varier states UI, refaire les 10 placeholders au fur et à mesure que features sortent (reply inbox, DNS verification, signal condition editor, etc.). Mémoire #30.
- [ ] **Update `MIRVO_LAUNCH_ALERTS_SETUP.md`** : PostHog Email destination déprécié du wizard (workaround V1 = notif natives profil), Stripe Communication preferences URL renamed (`dashboard.stripe.com/settings/communication-preferences`), Vercel Notifications Account-level pas Project-level.
- [ ] Major Mobile V2 refactors restants : modal migration vers Modal.tsx wrapper consistent
- [ ] Microcopy review
- [ ] PostHog dashboards configuration (funnel + cohorts + business metrics)
- [ ] **Mobile Perf 67 → 90+ sprint dédié** : framer-motion lazy + supprimer unused chunks + critical CSS inline. 1-2 jours.
- [ ] **Color-contrast Ash `#9a9a9a` landing-wide a11y sprint** : 18 éléments flaggés. Décision design : darken Ash globalement OU override per-élément.
- [ ] **PostHog alerts proper setup** (workaround V1 = notif natives profil) : Email déprécié. Options : (1) Slack workspace dédié Mirvo + intégration PostHog, OU (2) HTTP Webhook → endpoint Mirvo qui envoie Resend email vers `admin@mirvo.ai`.
- [ ] E2E tests Playwright critical paths (avec auth fixture pour /admin)
- [ ] Help docs FAQ enrichment (au-delà des 21 articles V1)
- [ ] ProductHunt assets + launch posts drafts (LinkedIn, Reddit, IndieHackers)
- [ ] Loom demo video
- [ ] 58 TS errors préexistants cleanup
- [x] **Incohérence palette landing #2563eb vs skill #3b6bef** — ✅ tranchée 29 mai `f7e1c8a2`
- [ ] App auth i18n complet (V1 EN only)
- [x] **apple-touch-icon** — ✅ PR #83
- [x] **ADMIN_NOTIFICATION_EMAIL → adresse Mirvo dédiée** — ✅ 29 mai
- [x] **FROM_ADDRESS Mirvo `hello@mirvo.ai`** — ✅ PR #89 29 mai
- [x] Next.js 15 cookies() async migration — ✅ PR #85
- [ ] Update pricing/limits content in MDX articles (#9 + #18) avec valeurs finales pre-launch — markers `<!-- PRICING_DATA -->` + `<!-- LIMITS_DATA -->` en place
- [ ] **Bot AI knowledge update** : sections `<!-- PRICING_DATA -->` / `<!-- CREDIT_SYSTEM_DATA -->` / `<!-- LIMITS_DATA -->` à mettre à jour pre-launch quand cost plan final décidé.

### Différés / bloqués
- Instantly Hypergrowth $97/mo (activation Sprint 8 S4)
- Brand naming (Mirvo finalisé 27 mai ✅, logo/branding restant)
- 5-min fix backend signup email enumeration trick (`signupData?.user?.identities?.length === 0`) : traîne depuis Sprint Onboarding 1A-1C.2.2, à fix opportunément

---

## 5. Bugs récurrents documentés (mémoire)

### CSP en dev bloque HMR (22/5 + 26/5)
- Symptôme : HTML charge mais CSS Tailwind ne s'applique pas
- Fix : `if (!isDev) res.headers.set('Content-Security-Policy', CSP_HEADER)`

### .next cache corrompu après git pull main
- Fix : Ctrl+C terminal A + `rm -rf .next && npm run dev`
- Règle protocole POST-PULL main SYSTÉMATIQUE

### Chrome ERR_INVALID_HANDLE / ERR_QUIC_PROTOCOL_ERROR (Max local)
- Workaround : disable QUIC ou Safari

### DNS ISP filter PostHog (Max local)
- Fix : skip PostHog init en dev mode (NODE_ENV check)

### Mac DNS negative cache stuck (29/5)
- Diagnostic : `dig +short DOMAIN @1.1.1.1` bypass
- Workaround : DNS Mac → 1.1.1.1, OU attendre TTL négatif, OU `curl --resolve`

### Vercel UI env vars value vidée silencieusement
- Symptôme : NEXT_PUBLIC_* vidée après edit scope
- Fix : toujours re-paste valeur intégralement + curl bundle prod + grep valeur

### Cookie banner Secure flag Safari HTTP localhost
- Fix : conditional `isSecure = window.location.protocol === 'https:'`

### CC affirme "shipped" sans vérifier git push (15/5, 27/5)
- Fix : vérification dure post-push obligatoire (`git log origin/branch --oneline -3`)

### CC affirme "shipped" sans valider CHECK constraints DB (27/5)
- Fix : pour inserts critiques, valider valeurs vs enums + required fields AVANT shipping

### CC ship sans valider migration AVANT test critique (29/5 Sprint 2)
- Cas : cron testé pré-migration → 9 emails réels envoyés sans idempotency log
- Fix : pour features dépendant d'une nouvelle table, appliquer migration AVANT test runtime + valider information_schema post-apply

### CC Playwright auth admin fail headless (29/5)
- Solution propre post-launch : Playwright auth fixture qui setup session admin via Supabase Auth admin API

### MDX dev Webpack dynamic import bypass loader (29/5)
- Pattern à éviter : `import(`@/content/.../${var}.mdx`)` pour content directories
- Fix : static imports OU `next-mdx-remote` (compile-at-runtime)

### YAML frontmatter rendu en texte avec `@next/mdx` (29/5)
- Cause : `createMDX({ extension })` sans `remarkPlugins` n'extrait pas le frontmatter
- Fix : ajouter `['remark-frontmatter', ['yaml']]` + `['remark-mdx-frontmatter', { name: 'frontmatter' }]`

### `prose` Tailwind classes inactives sans plugin (29/5)
- Cause : `@tailwindcss/typography` non installé
- Fix : `npm install -D @tailwindcss/typography` + `plugins: [require('@tailwindcss/typography')]`

### MDX prerender ReferenceError `{xxx}` non échappé (29/5)
- Cause : MDX évalue `{...}` comme expression JavaScript
- Fix : wrap merge field placeholders dans backticks (code inline) — `` `{firstName}` ``

### Playwright Welcome modal overlay sur captures (29/5)
- Symptôme : majorité des screenshots avec Welcome modal au premier plan, captures répétitives
- Fix V2 : dismiss welcome modal + onboarding tooltips AVANT chaque capture, varier states UI

### Auth GitHub credential helper Mac désynchronisé entre sprints
- Fix : `gh auth setup-git`

---

## 6. Workflow rules essentielles (rappel + renforcements 29 mai)

### 6.1 Brief CC = audit READ-ONLY préalable obligatoire (Rule 22 mémoire)
Tout brief CC créant/modifiant code aligné sur fichier existant DOIT être précédé d'une étape READ-ONLY explicite où CC lit verbatim (cat/view brut) le fichier actuel. Pas de supposition.

### 6.2 Git commit + push systématique fin de sprint — VÉRIFICATION DURE
Tout sprint modifiant code → brief CC inclut : (1) commit message descriptif, (2) `git push origin main` + capture output, (3) `git fetch origin && git log origin/main --oneline -3` + capture output, (4) confirmation SHA + URL GitHub commit.

### 6.3 Restart dev server systématique
Tout brief CC touchant code/env/config → `pkill -f 'next dev' && rm -rf .next && npm run dev`. Protocole POST-PULL main : `rm -rf .next` OBLIGATOIRE.

### 6.4 Vendor invisibility
Jamais mentionner dans UI/emails/error messages/marketing/content : Claude/Anthropic/Sonnet/Haiku, GPT/OpenAI, Clay/Apollo/Instantly/Resend/Cognism/Hunter. Remplacer par "Mirvo AI", "AI prospect research", "deliverability infrastructure", etc.

### 6.5 PR workflow vérification avant patch
Avant fix/diagnostic lié à PR récente : `gh pr list --state open` ou `gh pr view N` pour confirmer mergées vs open.

### 6.6 Execution location toujours explicite
- Brief markdown → "Push ce brief à CC" AVANT code block
- Commande shell → "Terminal Mac (Cmd+T), colle :" + code block
- Action dashboard → "Va sur [tool], fais X"
- JAMAIS demander à Max d'éditer manuellement (Max veut copy-paste, pas éditer)

### 6.7 Une étape à la fois + ZÉRO anticipation (Rule 19/20 renforcée 29 mai après 5 violations cumulées)
(a) UNE instruction par message, attendre, next. (b) ZÉRO phrase "Après le retour…", "Une fois X…", "Avec ça je pourrai…", "Si Y alors Z…", "Attendu :", "Expected:", "voici ce qu'on apprendra", "ensuite je…". (c) Pas de pré-explication de plan/sous-étapes. (d) Le message s'arrête à l'instruction, point. (e) Placeholders : `<X>` = remplacer sans chevrons.

### 6.8 Sprint tracker updates en fin de sprint uniquement
Pas de mise à jour CURRENT_STATE / Tracker pendant le sprint. Updates groupés en fin.

### 6.9 Rigueur ABSOLUE avant chaque livraison
Double-check : fichier généré vs source knowledge, brief CC "qu'est-ce qui peut foirer ?", récap CC challengé. Pour inserts DB critiques : valider valeurs vs enums + required fields AVANT shipping. **NEW 29/5 (Sprint 2)** : pour cron/runtime features dépendant d'une nouvelle table, **appliquer migration AVANT test runtime**.

### 6.10 Deploy progressif + assumption non vérifiée
Tout changement présentation/protection prod = mode SOFT d'abord. Assumption non confirmée = BLOQUANTE.

### 6.11 Doc UI tierces périmées — fetch web obligatoire
Si UI tierce ne matche pas la description Knowledge, `web_search` + `web_fetch` la doc officielle AVANT de continuer. Cas 29/5 : Stripe Communication preferences renamed + PostHog Error tracking Email déprécié + Vercel Notifications déplacé Account-level.

### 6.12 pbcopy systématique sur output Claude/CC (rappelé 5× cette session)
Toute commande Terminal Max + brief CC dont Claude a besoin de l'output → pipe pbcopy (`2>&1 | tee /dev/tty | pbcopy`). CC : consolider build/SHA/PR/grep en UN bloc final pbcopy. Max Cmd+V direct sans chercher les lignes.

---

## 7. Stack technique consolidé

### Frontend / Hosting
- **Next.js 15** App Router + TypeScript ES2017 target
- **React 19**
- **Vercel Pro** (deployment + cron jobs)
- **DNS apex+www → Vercel CNAME `6229eedd197eee7d.vercel-dns-016.com`** (Cloudflare DNS-only, SSL Let's Encrypt, www canonical)
- **next.config.mjs** (migré depuis .js 29 mai pour ESM remark plugins)

### Content & docs
- **`@next/mdx`** ^16.2.6 + `pageExtensions: ['ts','tsx','mdx']`
- **`gray-matter`** ^4.0.3 (frontmatter parsing)
- **`@mdx-js/loader`** ^3.1.1 + **`@mdx-js/react`** ^3.1.1
- **`@tailwindcss/typography`** ^0.5.19 (prose classes)
- **`remark-frontmatter`** ^5.0.0 + **`remark-mdx-frontmatter`** ^5.2.0 (YAML strip)
- **Help Center static MDX_MODULES map** (`lib/help/mdxModules.ts`) — static imports par article pour dev runtime parity

### DB / Auth
- **Supabase Pro** $25/mo — daily backups 7j retention, RLS enforcement prod, EU region

### Email & outbound
- **Resend** SDK 6.12.3 (Mirvo compte dédié, domain `mirvo.ai` verified 27 mai) + **FROM `hello@mirvo.ai`** (PR #89)
- **Cloudflare Email Routing** 6 aliases @mirvo.ai → cyrus@noos.fr : hello / max / contact / support / catch-all / admin
- **Instantly API v2** (Hypergrowth account, vendor-invisible, à activer Sprint 8 S4)
- **Cron onboarding emails** day 0/2/4/7 — `/api/cron/onboarding-emails` daily 10am UTC + table `onboarding_emails` (mig 049)

### AI
- **Anthropic Claude SDK 0.97.1** — `lib/anthropic.ts` singleton
  - Models : Sonnet 4.6 (signal scan + variant generation), Haiku 4.5 (Widget Help bot V1, inbox analyze)

### Analytics & monitoring
- **PostHog Cloud EU** project 180750 — direct api_host, capture_exceptions on, skip dev mode
- **/api/health** + **/status** page + **AdminStatusIndicator** dans sidebar admin
- **PostHog Error Tracking** — notifications V1 via préférences profil natif (Email destination déprécié du wizard)

### Rate limiting & security
- **Upstash Ratelimit + Redis EU-west-1** free tier 10k req/day — 3 sliding window buckets
- **CSP enforcement** prod + skip dev
- **Cloudflare Turnstile** signup CAPTCHA
- **CORP same-origin** + HSTS + X-Frame-Options DENY
- **Claude Code AI Security Analysis** automatique GitHub Actions

### Enrichment
- **Clay** Prospect Credits ($185-495/mo) — **remonté pre-launch critique**

### Payments
- **Stripe** test mode (live mode pre-launch sprint pending)

### Reference & design
- **Firstsend Polsia** : visual/UX baseline (pages déjà Mirvo : ne pas régresser)
- **Palette** : `#2563eb` canonical + tokens AA-passing `#4a4a5a` (8.1:1) / `#6b5e4e` (5.78:1) sur fond `#faf8f5`

---

## 8. Cron jobs Vercel

| Cron | Schedule | Endpoint | Notes |
|---|---|---|---|
| Hard-delete users GDPR | Daily 3am UTC | `/api/cron/hard-delete-users` | Soft-delete 30j → hard delete |
| Trial expiry | Daily | `/api/cron/trial-expiry` | Workspaces trial → free |
| Daily cost check | Daily 9am UTC | `/api/cron/daily-cost-check` | Alert email si >$50/jour Anthropic spend. Destination = ADMIN_NOTIFICATION_EMAIL = admin@mirvo.ai |
| Auto-scan signals V2 | Daily 5am UTC | `/api/cron/auto-scan-signals` | Iterate active signals → run scan → email notif new matches |
| **Onboarding emails (PR #89)** | **Daily 10am UTC** | **`/api/cron/onboarding-emails`** | **Iterate workspaces, calcul `days_since_signup` (tolerance ±1j), send day 0/2/4/7 templates, skip `plan_tier='paid'` après day 0. Idempotency via table `onboarding_emails` (UNIQUE workspace+day_offset).** |

CRON_SECRET fail-closed guard + Buffer.timingSafeEqual sur tous les crons.

---

## 9. Migrations DB

| Numéro | Description | Status |
|---|---|---|
| 042 | Custom Signal Builder V1 Bloc A : signals + prospect_signals | ✅ |
| 043 | Custom Signal Builder V1 Bloc E1 : prospect_email_variants | ✅ |
| 044 | Pricing Triple Protection : signal_scan_events | ✅ |
| 045 | onboarding_state JSONB sur workspaces | ✅ 27 mai |
| 046 | is_sample BOOLEAN sur campaigns, prospects, signals, prospect_emails + 4 partial indexes | ✅ 27 mai |
| 047 | is_sample BOOLEAN sur prospect_email_variants, contacts, campaign_steps + 3 partial indexes | ✅ 28 mai |
| 048 | check_email_exists RPC (SECURITY DEFINER, search_path='', service_role grant) | ✅ 28 mai (PR #82) |
| **049** | **onboarding_emails (workspace_id + day_offset SMALLINT + sent_at + resend_message_id + UNIQUE constraint + RLS deny-all)** | **✅ 29 mai (PR #89)** |

Migrations workflow : copy-paste manuel SQL Editor Supabase pendant sprint actif. Post-launch : installer Supabase CLI pour migrations automatisées via Claude Code.

---

## 10. Onboarding architecture & flow (post-Sprint 1A→1C.2.2 + Sprint 2 emails)

### Tables & state
- `workspaces.onboarding_state` JSONB : `{ welcome_dismissed, checklist_dismissed, try_mirvo_mode, last_campaign_id, started_at, ... }`
- Auto-detection via 7 queries DB parallèles (Promise.all) dans `/api/onboarding/progress`
- **Email sequence idempotency** : table `onboarding_emails` (PR #89), UNIQUE (workspace_id, day_offset)

### Mapping detection (post-1C.2.2 — exclude is_sample=true)
- Step 1 ICP — `workspace_profiles.icp_description && product_description`
- Step 2 Domain — `email_accounts` count > 0
- Step 3 Mailbox — `email_accounts.setup_status='verified'`
- Step 4 Campaign — `campaigns` count > 0 AND is_sample=false
- Step 5 Prospects — `prospects` count > 0 AND is_sample=false
- Step 6 Variants reviewed — `prospect_emails.status='approved'` AND is_sample=false
- Step 7 Campaign launched — `campaigns.status='active'` AND is_sample=false

### Spark animations
Pulse + glow ripple + checkmark draw quand action essentielle complete (transition false→true détectée par OnboardingProgressProvider Context).

### Sample data "Try Mirvo" content
- 1 sample campaign "SaaS CTOs — Pain-Led Outbound (Demo)" (target CTOs B2B SaaS 50-500 employés)
- 5 sample contacts/prospects (James Harrington, Priya Mehta, Marcus Weber, Sofia Reyes, Daniel Kim @x.demo)
- 1 sample campaign step (initial type)
- 5 sample variants (drafts in Approval Queue)
- 2 sample signals (hiring SDRs + funding rounds, source_type=template, is_active=false)

### Email sequence (PR #89)
- **Day 0** : "Welcome to Mirvo — your first email goes out in <1 hour" (3-step ICP/Mailbox/Campaign)
- **Day 2** : "How Mirvo finds buyers (without you doing the research)" (signals moat)
- **Day 4** : "Are your emails landing in inbox?" (deliverability)
- **Day 7** : "Your first week with Mirvo — what to do next" (nudge avec 3 links)
- Skip workspaces `plan_tier='paid'` après day 0 (déjà converti, pas besoin de nurturing)

---

## 11. Help Center architecture (Sprint 3, PR #90 à #93)

### Routing
- `app/[locale]/help/page.tsx` (index) — HelpIndex avec 6 catégories + 21 articles
- `app/[locale]/help/[slug]/page.tsx` (article dynamique) — generateStaticParams from MDX_MODULES, render via lookup statique
- `lib/help/mdxModules.ts` — static imports map (key=slug, value=MDX module)
- `lib/help/getArticles.ts` — frontmatter parsing via gray-matter, sort by `order`
- `lib/help/types.ts` — ArticleMeta + CATEGORY_LABELS

### Composants MDX custom
- `<Steps>` — liste numérotée stylée
- `<Callout type="info|warning|tip">` — bloc colored
- `<Screenshot src alt caption [placeholder]>` — image avec zoom click + caption + mode placeholder
- `<Video src poster>` — player ou message "Video coming soon" si src vide
- `<FRBanner>` — affiché si locale==='fr'

### 21 articles + 25/35 screenshots
Détails §2.6 + §2.10. Markers `<!-- PRICING_DATA -->` + `<!-- LIMITS_DATA -->` pour update pre-launch.

### Pipeline screenshots re-runnable
`npm run help:seed` + `help:capture` + `help:replace` + `help:all`. Test account `screenshots-bot@mirvo.test`. 10 placeholders restent pour features pas build (voir §2.10).

---

## 12. Env vars production (Vercel)

### Sensitive (production)
- Supabase : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- Anthropic : ANTHROPIC_API_KEY
- Resend : RESEND_API_KEY (compte Mirvo dédié)
- Stripe : NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, 6× STRIPE_PRICE_*, 3× STRIPE_COUPON_LAUNCH_*
- Cron : CRON_SECRET
- Cloudflare Turnstile : NEXT_PUBLIC_TURNSTILE_SITE_KEY (public), TURNSTILE_SECRET_KEY (server)
- Upstash Redis : UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
- Admin : **ADMIN_NOTIFICATION_EMAIL = admin@mirvo.ai** (Cloudflare alias → forward cyrus@noos.fr)
- App : NEXT_PUBLIC_APP_URL = `https://www.mirvo.ai`
- Instantly (pour Sprint 8 S4) : INSTANTLY_API_KEY (absent), INSTANTLY_WEBHOOK_SECRET (stub)

### Local .env.local (gitignored)
- Maintenir .env.local.backup à jour (gitignored, source de vérité locale)
- **JAMAIS** `vercel env pull` qui écraserait .env.local sans backup préalable
- Pour ajouter UNE var : éditer .env.local manuellement, jamais pull global

---

## 13. Knowledge files actuels du Project

1. `SENTRA_REFERENCE.md` — strategic master doc
2. **`CURRENT_STATE_v15.md`** — ce document (29 mai 2026, post Sprint 2+3 + 3 fix PRs + screenshots automation)
3. `SENTRA_WORKFLOW_RULES.md`
4. `SENTRA_FIRSTSEND_PATTERNS.md`
5. `SENTRA_SPRINT_HISTORY.md`
6. `FIRSTSEND_AUDIT.md` + `FIRSTSEND_ANALYSIS.md` + `FIRSTSEND_COMPLETE_FEATURE_INVENTORY.md`
7. `CREDIT_SYSTEM_AND_RECENT_DECISIONS.md`
8. `SENTRA_BRIEF_V2.md`
9. `CUSTOM_INSTRUCTIONS.txt`
10. `KICKOFF_MESSAGE.md` + `PROJECT_SETUP_GUIDE.md`
11. `SENTRA_PROJECT_TRACKER.md`
12. `SENTRA_SECURITY_ROADMAP.md`
13. `FOUNDER_OPERATING_PREFERENCES.md` v2
14. `PRODUCTIVITY_STACK_REFERENCE.md`
15. `SENTRA_TOOLING_STACK.md`
16. `AUDIT_AND_SECURITY_TOOLS.md`
17. `AUDIT_AND_UX_TOOLS.md`
18. `AUDIT_LEGALES_CONCURRENTS.md`
19. `docs/DB_RESTORE_RUNBOOK.md`
20. `docs/MOBILE_RESPONSIVE_AUDIT_2026-05-26.md`
21. **`SESSION_BRIEF_NEXT.md`** (actualisé 29 mai post-Sprint 2+3, à utiliser pour reprise prochaine session)
22. **`MIRVO_LAUNCH_ALERTS_SETUP.md`** (à actualiser : PostHog Email déprécié + Stripe Communication preferences URL renamed + Vercel Notifications Account-level)
23. **`MIRVO_LAUNCH_MONITORING_DASHBOARDS.md`**
24. PDFs stratégiques

---

## 14. Pour reprendre la conversation après pause

Message type :

> "On reprend Mirvo. Knowledge à jour avec **CURRENT_STATE_v15.md** (29 mai 2026 Paris, post Sprint 2 + Sprint 3 + 4 fix PRs + screenshots automation). **Session 29 mai = 5 PRs mergées + 1 hotfix direct main** : #89 Sprint 2 Email automation Resend (cron day 0/2/4/7 + FROM hello@mirvo.ai + mig 049 idempotency) · #90 Sprint 3 Help Center MDX (21 articles) · #91 fix MDX dev runtime (static map vs dynamic import) · #92 fix render quality (frontmatter strip remark plugins + @tailwindcss/typography + Screenshot placeholder mode + bulk replace 35 placeholders) · #93 Sprint 3 Phase 8 screenshots automation (25/35 captures + pipeline re-runnable `npm run help:all`) · hotfix `ddf93d31` (escape `{firstName}` MDX prerender). **HEAD origin/main = `1d3e1cd5`**. Sessions précédentes : 28-29 mai overnight 6 quick wins (palette skill, ADMIN email, cookie banner, DNS mirvo.ai LIVE, Lighthouse + PR #87, PR #88 admin status) + 28 mai PRs #82-#86 + marathon 27-28 mai Onboarding 12 PRs + 25-26 mai 35 PRs. **Avance launch ~3 semaines sur schedule v4 initial**. Launch crédible mi-juin 2026. **Restant pre-launch critiques** : Clay enrichment (pre-launch critique), Sprint 4 Videos Max-solo Tella+HeyGen, Stripe live mode + Communication preferences setup (~1j critical), OWASP scan + rotation tous secrets (~1-2j EN FIN), Phase 1.2 légales juriste freelance EU (Max async). **Bloqués** : Bloc E3 send Instantly (Sprint 8 S4). **À refaire post-launch** : Help Center screenshots Phase 8 V2 (Welcome modal overlay + variation states, mémoire #30), MIRVO_LAUNCH_ALERTS_SETUP.md update (PostHog Email déprécié + Stripe URL renamed + Vercel Notifications Account-level), 5-min fix backend signup email enumeration trick, Mobile Perf 67→90+ sprint, color-contrast Ash a11y sprint, PostHog alerts Slack/Webhook setup, modal migration Tier 2 V2B, 58 TS errors, app auth i18n, PostHog dashboards, E2E Playwright tests, Help docs FAQ enrichment au-delà 21 articles V1, ProductHunt assets."

---

*Fin du document. À mettre à jour à chaque fin de sprint significatif.*
