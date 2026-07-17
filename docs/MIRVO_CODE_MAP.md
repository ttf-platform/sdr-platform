# MIRVO — CODE MAP

*Cartographie complète de l'état réel du code. Source initiale : audit Claude Code READ-ONLY du 30 mai 2026. Dernière régénération factuelle : audit READ-ONLY du 17 juin 2026, repo `/Users/maxbm/sdr-platform`, branche `main`, HEAD `3b7783e3` (#118).*

*Document distinct de CURRENT_STATE (historique narratif). Celui-ci = source de vérité de ce qui existe physiquement dans le code. À mettre à jour en fin de chaque run/sprint qui modifie routes / features / intégrations / migrations / crons / tech debt.*

*Maj 17 juin — run email-gen P0 + passe Impeccable rétroactive (#102→#118) : voir §2 (génération), §4 (ui/Modal), §7 (flags de build, dette design-system). Les autres sections restent vérifiées conformes à l'audit.*

---

## 1. Structure des routes

*(120 API routes, ~45 pages — audit 17 juin conforme à la liste ci-dessous.)*

### Auth (`app/[locale]/(auth)/`)
- `/[locale]/(auth)/login/page.tsx` — Login email/password
- `/[locale]/(auth)/signup/page.tsx` — Signup + Turnstile CAPTCHA (blocage email existant dès l'étape 1, #82)
- `/[locale]/(auth)/forgot-password/page.tsx` — Reset password request
- `/[locale]/(auth)/reset-password/page.tsx` — Reset password avec token

### Public / Marketing (`app/[locale]/`)
- `/[locale]/page.tsx` — Homepage / landing (section Signals intégrée au hero + how-it-works, #86)
- `/[locale]/about/page.tsx` — About
- `/[locale]/pricing/page.tsx` — Pricing plans
- `/[locale]/contact/page.tsx` — Contact / support form
- `/[locale]/onboarding/page.tsx` — Onboarding flow entry point
- `/[locale]/book/[slug]/page.tsx` — Public meeting booking (calendar, form)
- `/[locale]/legal/privacy` — Privacy policy
- `/[locale]/legal/terms` — Terms of service
- `/[locale]/legal/cookies` — Cookie policy
- `/[locale]/legal/dpa` — DPA avec sub-processors (Supabase Frankfurt, PostHog EU)
- `/[locale]/legal/gdpr` — GDPR compliance
- `/[locale]/legal/security` — Security policy
- `/[locale]/legal/sending-policy` — Email sending policy

### Help Center (`app/[locale]/help/`)
- `/[locale]/help/page.tsx` — Help center homepage (article index)
- `/[locale]/help/[slug]/page.tsx` — Article MDX individuel (21 slugs via `generateStaticParams`)

### Dashboard (`app/(dashboard)/dashboard/`)
- `/dashboard/page.tsx` — Home (KPIs, onboarding checklist widget)
- `/dashboard/campaigns/page.tsx` — Campaign list (create, filter, bulk actions)
- `/dashboard/campaigns/new/page.tsx` — Redirect → `campaigns?action=new`
- `/dashboard/campaigns/[id]/page.tsx` — Campaign detail editor (prospects, drafts, approval queue, carte next-step contextuelle sur l'onglet overview #113)
- `/dashboard/prospects/page.tsx` — Prospects list (import CSV/paste/manual, bulk edit, search, tags, notes) + panel Master ICP
- `/dashboard/signals/page.tsx` — Signals builder (template + custom, auto-scan toggle)
- `/dashboard/inbox/page.tsx` — Reply inbox (thread view, sentiment analysis)
- `/dashboard/meetings/page.tsx` — Meetings list (public link, booked meetings ; calendar view "coming soon")
- `/dashboard/analytics/page.tsx` — Analytics (emails sent, replies, meetings — Recharts)
- `/dashboard/billing/page.tsx` — Billing / subscription (Stripe checkout, usage indicator)
- `/dashboard/settings/page.tsx` — Settings (Master ICP, email signature, sending preferences)
- `/dashboard/settings/sending-domains/page.tsx` — Email accounts list (pause/resume, DNS verify)
- `/dashboard/settings/sending-domains/new/page.tsx` — Email account wizard 3 étapes
- `/dashboard/morning-brief/page.tsx` — Morning brief (AI summary, daily stats, profile quality score)
- `/dashboard/pipeline/page.tsx` — Pipeline / deals (stages, manual override, auto-sync on meeting)
- `/dashboard/team/page.tsx` — Team members (invite, roles)
- `/dashboard/call-recording/page.tsx` — Call recording storage management
- `/dashboard/admin/page.tsx` — Workspace admin controls (role-gated)

### Admin (`app/admin/`)
- `/admin/page.tsx` — Admin redirect / overview entry
- `/admin/overview/page.tsx` — KPIs (users, workspaces, MRR, deliverability, signup graph)
- `/admin/analytics/page.tsx` — Platform analytics (traffic sources = stub "coming soon")
- `/admin/support/page.tsx` — Support center (escalations, conversations, bug reports, broadcasts)
- `/admin/settings/page.tsx` — Platform settings (admin email, feature flags)
- `/admin/users/page.tsx` — User management (suspend, resume, delete, search)
- `/status/page.tsx` — Status page (poll `/api/health`, lié depuis sidebar admin)

### API Routes (`app/api/` — 120 routes)

**Auth** : `/login`, `/signup`, `/check-email`, `/signout`, `/callback`

**Campaigns** : `/campaigns` (GET/POST), `/check-name`, `/suggest`, `/ai-suggestions`, `/ai-suggestions/refresh`, `/[id]` (GET/PATCH/DELETE), `/[id]/steps`, `/[id]/steps/[step_id]`, `/[id]/steps/[step_id]/ai-write`, `/[id]/generate-drafts`, `/[id]/regenerate-drafts`, `/[id]/approval-queue`

**Prospects** : `/prospects` (GET/POST), `/import`, `/export`, `/bulk-delete`, `/[id]` (GET/PATCH/DELETE), `/[id]/signals`, `/[id]/notes`, `/[id]/tags`, `/[id]/tags/[tag_id]`, `/[id]/generate-personalized`

**Emails (drafts)** : `/prospect-emails` (GET), `/[id]` (GET/PATCH/DELETE), `/[id]/approve`, `/[id]/regenerate`, `/[id]/reject`, `/[id]/undo`, `/bulk-reject`, `/bulk-delete`, `/approval-queue` (GET, workspace-wide)

**Email variants** : `/prospect-email-variants/[id]` (GET/PATCH)

**Inbox** : `/inbox/draft`, `/inbox/messages/[id]/thread`, `/inbox/messages/[id]/analyze`

**Email accounts** : `/email-accounts` (GET/POST), `/[id]`, `/[id]/dns-verify`, `/[id]/pause`, `/[id]/resume`

**Signals** : `/signals` (GET/POST), `/[id]` (GET/PATCH/DELETE), `/[id]/run`, `/build-prompt`

**Contacts** : `/contacts` (GET/POST), `/[id]`, `/bulk-delete`

**Meetings / Booking** : `/meetings` (GET/POST), `/[id]`, `/[id]/ics`, `/book/[slug]` (GET/POST), `/book/[slug]/availability`, `/book/[slug]/prospect/[id]`

**Deals** : `/deals` (GET/POST), `/[id]`, `/stats`, `/sync`

**Billing / Stripe** : `/billing/overage`, `/stripe/checkout`, `/stripe/portal`, `/stripe/change-plan`, `/stripe/promo`, `/stripe/webhook`

**Admin** : `/admin/users`, `/[id]`, `/[id]/suspend`, `/[id]/resume`, `/[id]/delete`, `/admin/check`, `/admin/settings`, `/admin/stats`, `/admin/broadcast`, `/admin/conversations`, `/[id]`, `/admin/escalations`, `/[id]`, `/admin/feedback`, `/[id]`, `/admin/bug-reports`, `/[id]`, `/admin/credits`, `/admin/mailboxes/[id]/pause`, `/[id]/resume`

**Crons** : `/cron/trial-expiry`, `/cron/hard-delete-users`, `/cron/daily-cost-check`, `/cron/auto-scan-signals`, `/cron/onboarding-emails`

**Bot support** : `/bot/message`, `/bot/conversations`, `/bot/conversations/[id]/messages`, `/bot/escalate`

**Onboarding** : `/onboarding/progress`, `/onboarding/load-sample-data`, `/onboarding/clear-sample-data`

**Misc** : `/health`, `/auto-fill`, `/icp/parse`, `/morning-brief/generate`, `/dns-helpers/detect-provider`, `/dns-helpers/check-mail-usage`, `/sending-preferences`, `/usage/current`, `/workspace-profile`, `/workspace/profile`, `/workspace/create`, `/team/invite`, `/notes/[id]`, `/tags`, `/tags/[id]`, `/bug-reports`, `/feedback`, `/webhooks/instantly`, `/dev/simulate-reply/[id]`, `/dashboard/stats`

---

## 2. Features produit — état réel

| Feature | Statut | Fichier clé |
|---|---|---|
| Campaigns — création wizard | IMPLÉMENTÉ FONCTIONNEL | `app/api/campaigns/route.ts` |
| Campaigns — création UI (NewCampaignModal) | IMPLÉMENTÉ FONCTIONNEL | `components/NewCampaignModal.tsx` — prefill ICP structuré depuis Master ICP (#109), migré vers `ui/Modal` accessible (#117) |
| Campaigns — édition | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/campaigns/[id]/page.tsx` |
| Campaigns — templates | IMPLÉMENTÉ FONCTIONNEL | `lib/campaign-templates.ts` |
| Campaigns — AI suggestions | IMPLÉMENTÉ FONCTIONNEL | `app/api/campaigns/suggest/route.ts`, `lib/ai-suggestions.ts` |
| Prospects — CSV import | IMPLÉMENTÉ FONCTIONNEL | `app/api/prospects/import/route.ts` |
| Prospects — manual add | IMPLÉMENTÉ FONCTIONNEL | `app/api/prospects/import/route.ts` (mode=manual) |
| **Prospects — Find Prospects / enrichment** | **ABSENT** | Tier limits existent (`lib/tier-limits.ts`), aucun endpoint Clay, aucune route enrichment. *(Activation prévue juste avant launch.)* |
| Prospects — page globale + Master ICP | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/prospects/page.tsx` — panel ICP recoloré blueprint (#116), dirty-state Save/Reset + copy didactique (#111), labels associés a11y (#118) |
| Email generation AI — séquence | IMPLÉMENTÉ FONCTIONNEL | `lib/draft-generation.ts` (Claude Sonnet 4.6) — voix humaine / problem-first + auto-révision (#105), génération native multilingue EN+FR (#112) |
| Email generation AI — variants/prospect | IMPLÉMENTÉ FONCTIONNEL | `app/api/prospect-emails/[id]/regenerate/route.ts` |
| Email generation AI — personnalisation | IMPLÉMENTÉ FONCTIONNEL | `lib/personalization.ts` — `languageDirective` injecté (#112) |
| Email generation AI — voix partagée | IMPLÉMENTÉ FONCTIONNEL | `lib/ai-voice.ts` — `HUMAN_VOICE_RULES`, `STRATEGY_VOICE_RULES`, `selfRevisionBlock(wordCap)`, `languageDirective(language)`. Règle name-once + title hint (#114). Em-dashes bannis de l'output. |
| Signals — génération personnalisée (signal→problème) | IMPLÉMENTÉ FONCTIONNEL | `app/api/prospects/[id]/generate-personalized/route.ts` — intro problem-first cadrant le signal comme problème, pas comme name-drop ; `HUMAN_VOICE_RULES` injecté ; `signals.description` utilisé comme hypothèse (#115) |
| Approval Queue | IMPLÉMENTÉ FONCTIONNEL | `app/api/prospect-emails/approval-queue` (workspace-wide) + `app/(dashboard)/dashboard/approvals/` ; `app/api/campaigns/[id]/approval-queue` (per-campaign, variants) |
| **Outbound send — provider réel** | **STUB-MOCK** | `lib/email-provider-adapter.ts` — MockEmailProvider actif (Instantly stub = throw "not yet implemented"). *(Activation Instantly prévue juste avant launch.)* |
| Signals — builder | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/signals/page.tsx` |
| Signals — auto-scan cron | IMPLÉMENTÉ FONCTIONNEL | `app/api/cron/auto-scan-signals/route.ts` (5am UTC daily) ; helper `scanSignalOnCampaign` (#45) |
| **Signals — auto-approval** | **ABSENT** | Scan crée des drafts, approbation = manuelle |
| Inbox / replies | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/inbox/page.tsx`, `app/api/inbox/` |
| Analytics — user | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/analytics/page.tsx` (Recharts) |
| **Analytics — admin (traffic sources)** | **PLACEHOLDER** | `app/admin/analytics/` ("coming soon" — pas d'instrumentation UTM/referrers) |
| Meetings / booking public | IMPLÉMENTÉ FONCTIONNEL | `app/[locale]/book/[slug]/page.tsx`, `/api/book/[slug]` (POST rate-limité 10/10min #94) |
| **Meetings — calendar view** | **PLACEHOLDER** | `app/(dashboard)/dashboard/meetings/page.tsx:237` ("coming soon") |
| Pipeline | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/pipeline/page.tsx`, `app/api/deals/` |
| Settings — Master ICP | IMPLÉMENTÉ FONCTIONNEL | `app/(dashboard)/dashboard/settings/page.tsx` |
| Settings — auto-fill profil (website→ICP) | IMPLÉMENTÉ FONCTIONNEL | `app/api/auto-fill/route.ts` — cohérence ICP interne (titres/tailles vs description) renforcée (#110), enum tone aligné (#111) |
| Settings — profile quality badge | IMPLÉMENTÉ FONCTIONNEL | `components/ProfileQualityBadge.tsx` — pills missing-field, sticky `top-12`, masqué à 100% (#107/#108), bannières sans `border-l-4` (#116) |
| Settings — Sending Domain wizard | IMPLÉMENTÉ FONCTIONNEL | `.../settings/sending-domains/new/page.tsx` |
| Settings — sending preferences | IMPLÉMENTÉ FONCTIONNEL | `app/api/sending-preferences/route.ts` |
| Settings — billing/Stripe | IMPLÉMENTÉ FONCTIONNEL | `.../billing/page.tsx`, `app/api/stripe/` |
| Onboarding — welcome modal + checklist | IMPLÉMENTÉ FONCTIONNEL | `.../dashboard/page.tsx`, `/api/onboarding/progress` (#71→#81) |
| Onboarding — sample data | IMPLÉMENTÉ FONCTIONNEL | `/api/onboarding/load-sample-data`, `/clear-sample-data` |
| Onboarding — séquence email | IMPLÉMENTÉ FONCTIONNEL | `/api/cron/onboarding-emails` (J0/J2/J4/J7 via Resend, FROM hello@mirvo.ai #89) |
| Help Center MDX | IMPLÉMENTÉ FONCTIONNEL | `app/[locale]/help/`, `lib/help/mdxModules.ts` (21 articles, static map #91) |
| Help Center — screenshots | PARTIEL | pipeline `scripts/help-screenshots/` (#93) ; captures à interaction et FR translations "coming soon" |
| Widget Help / AI Bot | IMPLÉMENTÉ FONCTIONNEL | `app/api/bot/message/route.ts` (Claude + tool use : createMeeting, viewCampaign, listProspects, escalateToHuman ; prompt caching #69 ; Signal feature dans le prompt #70) |
| Modals — primitive accessible | IMPLÉMENTÉ FONCTIONNEL | `components/ui/Modal.tsx` — role="dialog", aria-modal, focus trap, ESC, scroll lock, restore focus, portal. **Wrapper à utiliser pour TOUT nouveau modal** ; ~20 modals existants à migrer au fur et à mesure qu'on les touche (NewCampaignModal migré #117). |
| Status badges | IMPLÉMENTÉ FONCTIONNEL | Deux composants : `components/StatusBadge.tsx` (prop `variant` : orange/blue/green/gray/purple/amber/red/yellow/**blueprint** #116) et `components/ui/status-badge.tsx` (prop `status` : active/paused/draft/completed/error) |
| Admin — Support Center | IMPLÉMENTÉ FONCTIONNEL | `app/admin/support/page.tsx` |
| Admin — Users | IMPLÉMENTÉ FONCTIONNEL | `app/admin/users/page.tsx` |
| Admin — Overview | IMPLÉMENTÉ FONCTIONNEL | `app/admin/overview/page.tsx` |
| Admin — Platform Settings | IMPLÉMENTÉ FONCTIONNEL | `app/admin/settings/page.tsx` |
| Admin — status indicator | IMPLÉMENTÉ FONCTIONNEL | sidebar admin poll `/api/health` 30s (#88) |
| Observability — health + status | IMPLÉMENTÉ FONCTIONNEL | `/api/health` + `/status` (#43) ; PostHog error tracking client+server (#42) |

---

## 3. Intégrations externes

| Provider | Statut | Fichier | Notes |
|---|---|---|---|
| **Stripe** | BRANCHÉ RÉEL | `lib/stripe.ts`, `app/api/stripe/` | `STRIPE_SECRET_KEY` ; live mode actif (Entropian SARL, 6 live Price IDs, webhook "Mirvo Production") |
| **Resend** | BRANCHÉ RÉEL | `lib/email.ts` | `RESEND_API_KEY` ; transactionnel (admin escalation, séquence onboarding J0/J2/J4/J7) |
| **Instantly** | MOCK (stub) | `lib/email-provider-adapter.ts` | Toutes méthodes throw "not yet implemented" ; `INSTANTLY_API_KEY` manquant → MockEmailProvider actif. Webhook `/api/webhooks/instantly` câblé (Sprint 8.5b). |
| **Clay** | ABSENT | `lib/tier-limits.ts` (limite définie seulement) | Aucune route enrichment, aucun appel Clay API |
| **Anthropic SDK** | BRANCHÉ RÉEL | `lib/anthropic.ts` | SDK `^0.97.1` ; Claude Sonnet 4.6 (drafts, suggestions, génération), Claude Haiku 4.5 (parse/auto-fill, sentiment), Claude + tools (bot, avec prompt caching) |
| **PostHog** | BRANCHÉ RÉEL | `lib/track.ts`, `app/providers.tsx` | EU cloud `eu.i.posthog.com` ; `NEXT_PUBLIC_POSTHOG_KEY` ; error tracking + analytics, gaté par cookie consent |
| **Upstash** | BRANCHÉ RÉEL | `lib/ratelimit.ts`, `lib/rate-limit.ts` | `KV_REST_API_URL` + token ; 60 req/min global, 50 req/min AI ; rate limit AI par workspace sur 10 endpoints Claude (#44) |
| **Turnstile** | BRANCHÉ RÉEL | `lib/turnstile.ts` | `TURNSTILE_SECRET_KEY` ; signup uniquement (pas login) |

**Stack (package.json, 17 juin)** : Next `^15.3.9`, React `^18.3.1` (PAS React 19), next-intl `^3.26.5`, `@anthropic-ai/sdk ^0.97.1`, resend `^6.12.3`, stripe `^14.25.0`, `@upstash/redis ^1.38.0`, posthog-js `^1.373.5` + posthog-node `^5.35.2`, `@supabase/ssr ^0.1.0` + `supabase-js ^2.39.0`, clsx `^2.1.0`, lucide-react `^0.263.1`.

---

## 4. Abstractions / providers

### IEmailProvider (abstract) — EXISTE
`lib/email-provider-adapter.ts`
Interface : `provisionInbox()`, `triggerWarmup()`, `getWarmupStatus()`, `sendEmail()`, `pauseInbox()`, `resumeInbox()`, `deleteInbox()`
Implémentations :
- `MockEmailProvider` — réponses déterministes, 5% simulated failure
- `InstantlyProvider` — stub complet (throw "not yet implemented" partout)
Factory : `getEmailProvider()` → Mock si `MOCK_EMAIL_PROVIDER=true` ou `INSTANTLY_API_KEY` absent, Instantly sinon

### Modal (UI primitive accessible) — EXISTE
`components/ui/Modal.tsx` — wrapper accessible (role="dialog", aria-modal, aria-labelledby/describedby, focus trap Tab/Shift+Tab, ESC, body scroll lock, restore focus à la fermeture, rendu via `createPortal`, SSR-safe). Props : `isOpen`, `onClose`, `title`, `description?`, `size` (sm/md/lg/xl), `children`, `footer?`, `closeOnBackdropClick?`, `closeOnEscape?`, `initialFocusRef?`. Consigne in-code : utiliser pour TOUS les nouveaux modals ; migration incrémentale des ~20 modals existants au fur et à mesure (ExportProspectsModal, NewCampaignModal migrés).

### WarmupProvider — ABSENT
Warmup intégré dans IEmailProvider (méthodes `triggerWarmup`, `getWarmupStatus`)

### EnrichmentProvider — ABSENT
Aucune abstraction, aucun endpoint, aucun appel Clay

### Autres abstractions — AUCUNE
Stripe, Resend, Anthropic utilisés directement via SDK sans interface abstraite

---

## 5. Database

### Migrations (`supabase/migrations/` — 45 fichiers)
001 meetings · 002 update_meeting_durations · 003 workspace_profile_fields · 004 stripe_subscriptions · 005 overage_charges · 006 campaigns_v2 · 007 icp_company_sizes · 008 cleanup_orphan_campaigns · 009 drop_step_number_not_null · 011 backfill_single_meeting_duration · 012 prospects_v2 · 013 contacts_extract · 014 prospect_emails · 015 initial_booking_link · 016 campaign_suggestions · 017 campaign_icp_fields · 018 prospect_emails_rejected_at · 019 campaign_steps_cascade · 020 workspace_profile_audience_fields · 022 workspace_profiles_user_company · 023 deals · 024 deals_manual_override · 025 email_signature · 026 user_name · 027 tags_notes · 028 admin_actions_log · 029 email_accounts_rls_and_warmup_v2 · 030 email_accounts_setup_status · 031 email_accounts_alignment · 035 admin_settings · 036 create_inbox_messages · 037 add_tracking_to_prospect_emails · 038 rls_campaigns_contacts · 039 fix_admin_actions_log_rls · 040 export_history · 041 deleted_users · 042 signals · 043 prospect_email_variants · 044 signal_scan_events · 045 onboarding_state · 046 sample_data_flag · 047 sample_data_extended · 048 check_email_exists · 049 onboarding_emails_log

*Numéros absents : 010, 021, 032, 033, 034 (retirés ou renumérotés). Dernières migrations (045→049) = système onboarding + sample data + check email.*

### Tables référencées dans le code (37 uniques)
admin_actions_log, admin_settings, bot_conversations, bot_messages, broadcast_messages, bug_reports, call_recordings, campaign_steps, campaign_suggestions, campaigns, contacts, credit_history, deals, deleted_users, email_accounts, email_send_log, escalations, export_history, feedback, inbox_messages, inboxes, meetings, morning_briefs, onboarding_emails, prospect_email_variants, prospect_emails, prospect_notes, prospect_signals, prospect_tag_assignments, prospect_tags, prospects, signal_scan_events, signals, usage_tracking, workspace_members, workspace_profiles, workspaces

*Tables les plus sollicitées (par nb de `.from()`) : prospects (46), workspaces (41), workspace_members (39), campaigns (33), prospect_emails (29), email_accounts (27), workspace_profiles (23).*

---

## 6. Crons (`vercel.json`)

| Endpoint | Schedule | UTC | Rôle |
|---|---|---|---|
| `/api/cron/trial-expiry` | `0 2 * * *` | 2h | Check expiry trials, emails deadline |
| `/api/cron/hard-delete-users` | `0 3 * * *` | 3h | Hard delete users marqués après grace period |
| `/api/cron/daily-cost-check` | `0 9 * * *` | 9h | Check overage costs, alerte si coût Claude > $50, charge si `overage_enabled` |
| `/api/cron/auto-scan-signals` | `0 5 * * *` | 5h | Scan signals actifs sur campagnes actives, queue les matches |
| `/api/cron/onboarding-emails` | `0 10 * * *` | 10h | Séquence onboarding Resend (J0, J2, J4, J7) |

---

## 7. Tech debt

### Flags de build (`next.config.mjs`)
- `typescript.ignoreBuildErrors: false` ✅ — **gate TS actif depuis #103** (codebase TS-clean, 0 erreur, sprint #99→#102). Le build échoue désormais sur toute erreur de type.
- `eslint.ignoreDuringBuilds: true` — ESLint toujours ignoré en build (pas de gate lint).
- `images.unoptimized: true` — Next.js image optimization désactivée

### tsconfig.json
- `strict: true` ✓ · `allowJs: true` · `skipLibCheck: true`

### TODO / FIXME dans app/ et lib/
| Fichier | Ligne | Catégorie | Note |
|---|---|---|---|
| `lib/bot-ai.ts` | 353 | Feature stub | `overage_enabled` toujours false dans le bot (Clay/credits non câblé) |
| `app/api/prospects/[id]/route.ts` | 9 | API design | Move-to-campaign devrait être endpoint dédié (Sprint 17) |
| `app/api/prospects/import/route.ts` | 89 | Race condition | COALESCE merge applicatif → imports concurrents peuvent s'écraser (Sprint 17 : UPSERT atomique) |
| `app/api/contacts/route.ts` | 153 | Performance | Agrégation status contacts en JS → devrait être GROUP BY SQL (Sprint 17) |
| `app/api/workspace/profile/route.ts` | 1 | API design | POST au lieu de PUT pour l'update |
| `app/api/usage/current/route.ts` | 69 | Feature stub | `prospect_credits_used: 0` toujours (Clay) |
| `app/api/usage/current/route.ts` | 74 | Billing | Reset date hardcodé 1er du mois. **`current_period_end` n'existe NULLE PART** (aucune colonne DB, jamais lu ; seul `stripe_subscription_id` persisté). Fix ≠ trivial → item sprint billing post-Clay (voir note ci-dessous). |

### Dette design-system (run Impeccable 17 juin)
- **S1 — double bleu (à reconcilier).** Le bleu de marque est `#3b6bef` (wordmark Mirvo, partout : auth, booking, dashboard). L'outlier est `#2563eb`, présent uniquement sur `contact`/`about` (focus ring) + `legal/sending-policy` (puces) ≈ 8 endroits. La `.impeccable/design.json` est désynchronisée (référence `#2563eb`), ce qui fait qu'Impeccable flag le vrai bleu de marque à tort. **À faire (hors run) :** aligner les `#2563eb` outliers → `#3b6bef` + resynchroniser `design.json` sur `#3b6bef`. Aucun token de couleur n'est défini dans tailwind.config/globals/DESIGN.md (tout est en hex hardcodé dans les classNames).
- **Contraste WCAG — re-check à faire.** La passe Impeccable n'a pas pu vérifier les ratios réels (app derrière auth gate + dev server éteint au moment de l'audit). À vérifier via Playwright sur les surfaces rendues après le recolor blueprint.
- **S2 group labels (follow-up mineur).** Les `<label>` posés au-dessus de groupes de boutons/pills (Company Size/Revenue, pills tone) n'ont pas de contrôle associé → devraient devenir `<span>` + `role="group" aria-label`. Hors scope du PR #118 (qui a câblé les couples label↔input réels).

### "Coming soon" UI
`app/admin/analytics/` (traffic sources) · `.../settings/page.tsx` (feature badge `variant="orange"`) · `.../meetings/page.tsx` (calendar view) · `.../campaigns/[id]/page.tsx` ×2 (boutons désactivés) · `.../prospects/page.tsx` (AI prospect discovery désactivé — Sprint 9/Clay) · `.../morning-brief/page.tsx` (delivery settings UI-only, Sprint 4 persistence) · `app/[locale]/legal/security/page.tsx` (post-mortem link status.mirvo.ai) · Help Center (screenshots à interaction, Video, FR translations)

### 5 items tech debt les plus critiques
1. **Instantly stub** (`lib/email-provider-adapter.ts`) — 0 email réel envoyé en prod ; toute la chaîne approval→send utilise Mock. Bloquant pour launch. *(Activation prévue juste avant launch.)*
2. **Clay absent** (`app/api/usage/current/route.ts:69`) — Find Prospects = feature absente ; `prospect_credits` = métrique zombie. *(Activation prévue juste avant launch.)*
3. **Race condition CSV import** (`app/api/prospects/import/route.ts:89`) — atomicité manquante ; scale risk.
4. **ESLint silencé en build** (`next.config.mjs`) — `ignoreDuringBuilds: true`. (Le gate TS, lui, est désormais actif via `ignoreBuildErrors: false`, #103.)
5. **design.json désynchronisé** (dette design-system S1 ci-dessus) — Impeccable flag le bleu de marque à tort tant que ce n'est pas reconcilié.

### Note billing — reset_date / current_period_end (audit 30/5, toujours valide)
Le `reset_date` exposé par `/api/usage/current` est hardcodé au 1er du mois suivant. Le câbler sur le vrai cycle Stripe n'est PAS un quick win :
- `current_period_end` n'est persisté nulle part (aucune migration, jamais lu) ; seul `stripe_subscription_id` existe en DB.
- En trial (majorité des users au launch), il n'y a AUCUNE subscription Stripe → `current_period_end` serait null de toute façon.
- 3 options : (a) `stripe.subscriptions.retrieve()` live à chaque hit (latence), (b) persister `current_period_end` via webhook + migration (ne couvre pas les trials), (c) caler sur date anniversaire signup/trial (sans dépendance Stripe).
- **Décision** : requalifié en item de sprint billing post-Clay. Tant que les caps ne sont pas enforced et que les trials dominent, le reset_date hardcodé est cosmétiquement faux mais sans impact fonctionnel.

### Help Center screenshots — pipeline
- Pipeline : `scripts/help-screenshots/` (inventory → seed → capture → replace.py). Manifest `manifest.json`. Compte bot `screenshots-bot@mirvo.test`, workspace slug `screenshots-test`. `capture.ts` dismisse welcome modal + cookie banner avant chaque capture (#95).
- Migration prévue post-launch vers shot-scraper (déclaratif YAML) ; sécurité : `auth.json` gitignored, pas de `--bypass-csp`, venv dédié.

---

*Fin. Mettre à jour en fin de chaque run/sprint qui modifie la structure du code.*
