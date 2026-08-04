# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the in-repo source of truth for CC (CC sessions cannot read the Claude.ai Project Knowledge). Keep it aligned with the Project's `00_CORE/` — specifically `00_CORE/05_METHODE.md`, which supersedes the former RUNBOOKS and CONSTITUTION.

> Naming: the product is **Mirvo** (ex-**Sentra**, ex-**Firstsend/Polsia** v0). The `sentra-` prefix on skills, `requireSentraAdmin`, and internal identifiers is a **legacy technical name — do NOT rename**. Only user-visible strings must say Mirvo.

## Commands

```bash
npm run dev          # development server (Next.js)
npm run build        # production build (rm -rf .next first for a clean build)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (fast type gate, no build)
npm run test         # vitest (watch mode, both projects)
npm run test:run     # vitest (single run, both projects — red without a live Supabase)
npm run test:unit    # vitest project `unit` only — hermetic, no .env needed. THE gate.
npm run test:rls     # vitest project `rls` only — RLS integration (requires live Supabase)
npm run test:rls:gc  # garbage-collect orphan test fixtures older than 24h
```

`npm run typecheck && npm run test:unit` is the pair to run before pushing: both must
exit 0 from a clean clone with no `.env`, and also on a machine that has `.env.local`.
`test:run` includes the `rls` project and is therefore expected to fail without a live
Supabase — do not use it as a gate. Project split lives in `vitest.config.ts`;
`npx vitest list --run --filesOnly` prints every test file prefixed `[unit]` or `[rls]`,
which is how you verify no file fell out of both projects.

For a clean production build before shipping: `rm -rf .next && npm run build`.

## Architecture

**Stack**: Next.js 15 App Router · TypeScript · Tailwind CSS · Supabase (Auth + Postgres + RLS, **EU / Paris** since the EU migration) · Stripe · Anthropic Claude · Resend · PostHog EU · Vercel Pro

### Route groups
- `app/(auth)/` — login, signup, onboarding (public)
- `app/(dashboard)/dashboard/` — authenticated product (billing guard + trial guard)
- `app/admin/` — internal admin panel (Mirvo admin only, separate auth guard `requireSentraAdmin()` — legacy name)
- `app/api/` — all API routes (Next.js Route Handlers)
- `app/book/[slug]/` — public booking pages (no auth)

### Supabase client pattern
Every API route uses **two** clients, never mixed:
```ts
import { createClient } from '@/lib/supabase/server'        // anon key — respects RLS
import { createAdminClient } from '@/lib/supabase/admin'    // service role — bypasses RLS
```
Auth check always via `createClient()`. Data mutations that need to bypass RLS use `createAdminClient()`. Never trust user-supplied workspace IDs — always resolve from `workspace_members` using the authenticated `user.id`.

### API route pattern
All routes follow: **auth → Zod parse → DB lookup → business logic**. Zod parse happens before any DB lookups (fail-fast). Validation errors go through the centralized `badRequest()` helper from `@/lib/schemas` which returns `{ error: 'Invalid payload', issues: [...] }`.
```ts
import { someSchema, badRequest } from '@/lib/schemas'
const parsed = someSchema.safeParse(rawBody)
if (!parsed.success) return badRequest(parsed.error.issues)
```
Error format convention: `'Unauthorized'`, `'Forbidden'`, `'Workspace not found'`, `'Invalid JSON'` — capital first letter, human-readable.

### Billing and trial guards
`lib/billing-guard.ts` exports `billingGuard()` — call at the top of any API route that requires an active subscription or valid trial. Returns `{ blocked: true, response }` or `{ blocked: false, workspaceId, userId }`.

Plan tiers: `starter | pro | power`. Billing intervals: `monthly | yearly`. Stripe price IDs live in env vars; resolved via `lib/stripe-prices.ts` (STRIPE_PRICES map) and `lib/stripe-plans.ts` (inverse map priceId → tier+interval).

Stripe plan changes for **active** subscribers go through `/api/stripe/change-plan` (uses `subscriptions.update` with proration). Non-active users go through `/api/stripe/checkout` (creates a new Checkout Session). Webhook at `/api/stripe/webhook` syncs DB after Stripe events — never update `plan_tier` / `billing_interval` directly in non-webhook routes.

### Schemas
Zod schemas are centralized in `lib/schemas/` (one file per domain) and re-exported from `lib/schemas/index.ts`. Add new schemas there, not inline in route files.

### Analytics
PostHog EU Cloud. SDK initialized in `app/providers.tsx` with `api_host: '/ingest'` (reverse proxy via Next.js rewrites to bypass AdBlock). Typed event helper: `lib/track.ts` — `track(event, properties?)`. UTM super properties captured by `components/UTMCapture.tsx` (mounted in `app/layout.tsx`, 30-day localStorage persistence).

### RLS tests
`__tests__/rls/` contains integration tests that run against a live Supabase instance. They create real test workspaces (named `Test Workspace *`) and validate row-level security policies. Run `test:rls:gc` periodically to clean up orphan fixtures. Tests require `.env.local` with a live Supabase service role key.

**Convention — `__tests__/rls/` holds only tests that need a live database.** It is the `rls` vitest project and is excluded from `test:unit`; anything dropped there silently leaves the gate. Hermetic tests go in `lib/__tests__/` (or a sibling `__tests__/` folder next to the code), never here. Conversely, a test in `lib/__tests__/` must not touch the network: mock `@/lib/supabase/admin` (dispatch by table, `throw` on an unexpected one) so its verdict never depends on whether `.env.local` exists.

### Middleware
`middleware.ts` handles auth redirects for `/dashboard/**` (Supabase session refresh) and applies CSP headers via the `CSP_HEADER` module-level constant to all responses. Admin routes (`/admin/**`) have a separate `requireSentraAdmin()` guard in `lib/admin-auth.ts`.

## Workflow

### Git
- PR-based for any code change. **Never push directly to `main`.**
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`, `refactor/<scope>`.
- One sub-sprint = one PR. Auto-delete branch enabled on merge.
- After every push, verify the new SHA reached origin:
```bash
git fetch origin
git log origin/<branch> --oneline -3
```
  Silent pushes have happened in the past (15 May 2026, commit `62fe33e0` stayed local 1h+ despite CC reporting "pushed").
- If a push to `main` does not trigger a Vercel deploy (webhook missed): `git commit --allow-empty -m "trigger redeploy"` && push.
- Commit messages: descriptive, scope-prefixed. Sprint-level commits prefixed with sprint id where applicable.

### Dev server lifecycle
After any change to code, env vars, or config, the dev server must be restarted:
```bash
pkill -f 'next dev' && rm -rf .next && npm run dev
```
Wait for "Ready" before declaring done. Without this, browser shows perpetual "Loading" on refresh, or webpack chunk 404s. If deps changed (package.json/lock): `pkill -f 'next dev'; npm install && rm -rf .next && npm run dev`.

### `.env.local` backup discipline
Never run `vercel env pull` or any command that overwrites `.env.local` without backup first:
```bash
cp .env.local .env.local.backup
```
`.env.local.backup` is gitignored and treated as the local source of truth for vars not synced to Vercel. To add a single var, edit `.env.local` directly — never global pull (will wipe local-only vars).

## Security & secrets

### Never print secret values in the clear
Never display the value of a secret in the clear — API keys, tokens, service-role keys, passwords, connection strings — even in a read-only / audit context. Report only:
- the variable name
- its presence (yes / no)
- if useful, a masked fingerprint (e.g. last 4 characters)

Applies to any terminal output, report, diff, or chat message. When shelling out to read env, redact before printing (e.g. `sed 's/=.*/=<redacted>/'`).

## Tooling

### Skills (`.claude/skills/`)
Project-level skills installed in this repo:
- **`impeccable`** (symlink → `~/.agents/skills/impeccable`) — design / UI / UX audit. 4 commands: `audit`, `critique`, `polish`, `typeset`. Sidecar config in `.impeccable/design.json` (design tokens: palette Linen-and-Blueprint, Fraunces Budget Rule, Weight Step Rule, One Signal Rule). Apply 4-pass on every UI sprint before E2E tests.
- **`sentra-design-system`** — canonical widths, brand colors, status pill badges (never colored text alone), Portal tooltips, vendor invisibility rules, Playwright MCP validation patterns.
- **`sentra-edit-modal-pattern`** — symmetric Edit Modal pattern (Email / FollowUp / Prospect / Deal / Settings sections), shared helpers.
- **`sentra-rls-pattern`** — RLS Supabase patterns workspace-scoped, non-recursive policies on `workspace_members`, author-only patterns, idempotent DROP/CREATE, post-migration validation, multi-user Playwright MCP tests.

Globally available (`~/.claude/skills/` via symlinks to `~/.agents/skills/`):
- `find-skills` (Vercel Labs) — discovery of new skills.

### MCP servers (`~/.claude.json`)
- **Playwright MCP** (`npx @playwright/mcp@latest`) — E2E flows, multi-workspace RLS isolation tests, cross-feature regression, vendor invisibility audits. Activate with `use playwright mcp` in the session prompt. Reserved for repetitive or long tests — not for trivial 30s manual checks.

### Slash commands
- `/security-review` (Anthropic native) — pre-commit security audit on diff vs main. Used systematically before merging UI/auth/billing-touching PRs.
- `/ultrareview` (Anthropic native, Opus) — end-of-sprint multi-agent review for critical sprints (DB migrations, security, shared code, 5+ files).
- `/impeccable {audit|critique|polish|typeset}` — UI 4-pass on UI sprints before E2E tests. Demonstrated value on Sprint L5/L5.1 landing (caught 3 WCAG AA contrast fails invisible to the eye, 1 TS runtime error, semantic HTML fix, mobile/desktop bar misalignment).

### GitHub Actions
- `.github/workflows/security-review.yml` — `anthropics/claude-code-security-review` audits every PR (triggers: opened, synchronize, reopened). Comments findings inline.

## API conventions

### Error response format
Always capital-first, human-readable, matches HTTP status text:
- `401` → `{ error: 'Unauthorized' }`
- `403` → `{ error: 'Forbidden' }`
- `404` → `{ error: '<Resource> not found' }` (e.g. `'Workspace not found'`)
- `400` invalid JSON body → `{ error: 'Invalid JSON' }`
- `400` Zod validation fail → `{ error: 'Invalid payload', issues: [...] }` via `badRequest()` helper from `lib/schemas/index.ts`

Never lowercase snake_case (`'invalid_payload'`, `'unauthorized'`). Open debt: 2 auth routes (signup, login) still inline `'invalid_payload'` — normalize in a follow-up mini-sprint (verify current status before assuming open).

## Branding & vendor invisibility

### User-facing (UI, emails, error messages, marketing copy) — STRICT
**Never mention** in any user-visible string:
- Claude, Anthropic, Sonnet, Haiku
- GPT, OpenAI
- **Explorium, FullEnrich, Crustdata** (current sourcing/enrichment stack), Clay, Apollo, Cleanlist, Vibe, PDL, Findymail, Cognism, Hunter, Dropcontact, Clearbit
- Instantly, Resend (email infrastructure)

**Use instead**:
- AI → "Mirvo AI"
- Enrichment → "AI prospect research" / "verified contact data"
- Email warmup → "deliverability infrastructure"
- Discovery → "AI prospect discovery"

### Internal code (allowed)
Imports, env vars, dev comments are fine: `model: 'claude-sonnet-4-6'`, `import Stripe from 'stripe'`, `ANTHROPIC_API_KEY`, `INSTANTLY_API_KEY`, etc.

### Stripe public business name
"Mirvo" (rename pending in the Stripe dashboard from "Sentra" / "Max Command Center" — the previous projects' names).

## Build & deployment notes

### `next.config.mjs` — important (verified 10 Jul 2026)
- `typescript.ignoreBuildErrors: **false**` — TypeScript errors **block** the production build. A failing `tsc` fails the build (strict). (Changed from `true` in PR #103; older CLAUDE.md revisions said `true` — that is obsolete.)
- `eslint.ignoreDuringBuilds: **false**` — ESLint errors also block the build.
- `typedRoutes: true` — typed routes, extra compile-time protection on `Link` href.
- `images.unoptimized: true` — Next.js Image Optimization off (acceptable pre-launch, monitor).
- Security headers via `headers()`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Resource-Policy: same-origin`, HSTS `max-age=31536000; includeSubDomains`.
- Permanent redirects: `/landing-v2 → /`, `/dashboard/admin → /admin`.
- Plugins: `withNextIntl(withMDX(nextConfig))` (MDX + next-intl).

Since the build gates TS and ESLint, a passing `npm run build` **is** a type/lint check. `npm run typecheck` (i.e. `tsc --noEmit`) is still useful for fast local feedback before pushing (avoids a failed Vercel deploy cycle).

### Production
- Vercel Pro, project `sdr-platform` (repo name unchanged).
- URL: `https://www.mirvo.ai` (custom domain live). Supabase in EU (Paris) since the EU migration (3 Jul 2026).
- Auto-deploy on push to `main`.

## Known tech debt (verify current status before assuming open)
- **#21** — Weight Step Rule design system not respected: 50+ `font-semibold` usages. Dedicated UI polish sprint, future.
- **#29** (ex-#23) — Workspace routes architecture: `/api/workspace-profile` vs `/api/workspace/profile`. Refactor aborted 18 May 2026 (superficial audit ≠ actual returned data). Future dedicated sprint with deep audit of returned fields and consumers.
- **`badRequest()` follow-up** — 2 auth routes (signup, login) still inline `'invalid_payload'` lowercase, not using centralized helper.

## Related project documents

Maintained in the Claude.ai Project Knowledge (not in this repo). CC sessions cannot read
them directly and must rely on this CLAUDE.md as the in-repo source of truth.

**Knowledge layout — five zones, in production since 04 Aug 2026.**

| Zone | What it holds | Living? |
|---|---|---|
| `00_CORE/` | The truth of the project — 9 documents, one question each | **yes — canonical project knowledge** |
| `10_ENGINEERING/` | How Claude works — engineering OS, Project Instructions, this file, generator | yes |
| `20_AUDITS/` | Proof — dated reports, never rewritten | frozen |
| `30_ARCHIVES/` | History — 92 pre-noyau documents in 5 sub-folders. **Never a source of truth** | frozen |
| `40_WORKING/` | Temporary — absorbed into its carrier, or deleted | transient |

**`00_CORE/` — the canonical set, frozen at v1.0.** It replaces every document previously
listed here.

| Document | The single question it answers |
|---|---|
| `00_CORE/00_START.md` | Where do I start? Routing matrix, the ten non-negotiable rules |
| `00_CORE/01_PRODUIT.md` | What does Mirvo do, and for whom? |
| `00_CORE/02_SYSTEME.md` | How is the system built? **Generated, never hand-written** |
| `00_CORE/03_ETAT.md` | Where does the project stand, and what command proves it? |
| `00_CORE/04_DECISIONS.md` | Why these choices, and what would invalidate them? |
| `00_CORE/05_METHODE.md` | How do we work? Supersedes RUNBOOKS and CONSTITUTION |
| `00_CORE/06_RISQUES.md` | What exposes us? |
| `00_CORE/A1_GLOSSAIRE.md` | What does this term mean, where does this figure come from? |
| `00_CORE/A2_ARCHIVE.md` | Where did old document X go, and who carries it now? |

**Superseded — do not consult, do not cite.** The pre-refonte set once listed here
(`start.md`, `MIRVO_RESTE_A_FAIRE_v13`, `CURRENT_STATE_v39`, `MIRVO_CODE_MAP_v9`,
`MIRVO_A1_PROVIDERS_WATERFALL_v5`, `HISTORIQUE_v1`, `CONSTITUTION`) — **seven of those
names no longer exist in the Project under any version**. The 92 legacy documents live in
`30_ARCHIVES/` as a safety net only: they are opened solely when Max asks, or when a
`00_CORE/` document points to one. A fact taken from an archive and not re-verified against
the repo is N1, never N2.

**Single-carrier rule.** Never create a new document if an existing one can carry the
information — revise the carrier instead, and cross-reference rather than copy. Three
exceptions only: `00_START` (orientation), `A1_GLOSSAIRE` (definitions), `A2_ARCHIVE`
(traceability). Temporary work lives in `40_WORKING/` and is then absorbed or deleted.
Full rule: `00_CORE/05_METHODE.md` §16.5.

**Reference SHAs.** Audit dossier: `17a62bc1`. `02_SYSTEME` generated at: `dc3b9a5a`.
Any figure quoted without its revision is not usable.

In this repo (root level):
- `PRODUCT.md` — brand personality, anti-references, design principles, audience
- `DESIGN.md` — north star "The Quiet Operator", palette, Fraunces Budget Rule, Weight Step Rule, One Signal Rule
- `.impeccable/design.json` — machine-readable design tokens sidecar for Impeccable

When material changes are made to this `CLAUDE.md`, there is no mirror to update:
`SENTRA_TOOLING_STACK.md` is archived (`30_ARCHIVES/PRODUIT_ET_MARCHE/`) and this file is
the sole in-repo carrier for tooling and repo conventions. If a change alters a *project
fact* rather than a repo convention, update its carrier in the Project's `00_CORE/` —
never both.
