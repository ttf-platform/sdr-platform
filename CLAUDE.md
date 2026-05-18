# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # development server (Next.js)
npm run build        # production build (rm -rf .next first for a clean build)
npm run lint         # ESLint
npm run test         # vitest (watch mode)
npm run test:run     # vitest (single run, all tests)
npm run test:rls     # RLS integration tests only (requires live Supabase)
npm run test:rls:gc  # garbage-collect orphan test fixtures older than 24h
```

For a clean production build before shipping: `rm -rf .next && npm run build`.

## Architecture

**Stack**: Next.js 15 App Router · TypeScript · Tailwind CSS · Supabase (Auth + Postgres + RLS) · Stripe · Anthropic Claude · Resend · PostHog EU · Vercel

### Route groups

- `app/(auth)/` — login, signup, onboarding (public)
- `app/(dashboard)/dashboard/` — authenticated product (billing guard + trial guard)
- `app/admin/` — internal admin panel (Sentra admin only, separate auth guard)
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

### Middleware

`middleware.ts` handles auth redirects for `/dashboard/**` (Supabase session refresh) and applies CSP headers via the `CSP_HEADER` module-level constant to all responses. Admin routes (`/admin/**`) have a separate `requireSentraAdmin()` guard in `lib/admin-auth.ts`.

## Workflow

### Git
- PR-based for any code change. Never push directly to `main`.
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`, `refactor/<scope>`.
- One sub-sprint = one PR. Auto-delete branch enabled on merge.
- After every push, verify the new SHA reached origin:
```bash
  git fetch origin
  git log origin/<branch> --oneline -3
```
  Silent pushes have happened in the past (15 May 2026, commit `62fe33e0` stayed local 1h+ despite CC reporting "pushed").
- Commit messages: descriptive, scope-prefixed. Sprint-level commits prefixed with sprint id where applicable.

### Dev server lifecycle
After any change to code, env vars, or config, the dev server must be restarted:
```bash
pkill -f 'next dev' && rm -rf .next && npm run dev
```
Wait for "Ready" before declaring done. Without this, browser shows perpetual "Loading" on refresh.

### `.env.local` backup discipline
Never run `vercel env pull` or any command that overwrites `.env.local` without backup first:
```bash
cp .env.local .env.local.backup
```
`.env.local.backup` is gitignored and treated as the local source of truth for vars not synced to Vercel. To add a single var, edit `.env.local` directly — never global pull (will wipe local-only vars).

## Tooling

### Skills (`.claude/skills/`)
Project-level skills installed in this repo:
- **`impeccable`** (symlink → `~/.agents/skills/impeccable`) — design / UI / UX audit. 4 commands: `audit`, `critique`, `polish`, `typeset`. Sidecar config in `.impeccable/design.json` (Sentra design tokens: palette Linen-and-Blueprint, Fraunces Budget Rule, Weight Step Rule, One Signal Rule). Apply 4-pass on every UI sprint before E2E tests.
- **`sentra-design-system`** — canonical widths, brand colors, status pill badges (never colored text alone), Portal tooltips, vendor invisibility rules, Playwright MCP validation patterns.
- **`sentra-edit-modal-pattern`** — symmetric Edit Modal pattern (Email / FollowUp / Prospect / Deal / Settings sections), shared helpers.
- **`sentra-rls-pattern`** — RLS Supabase patterns workspace-scoped, non-recursive policies on `workspace_members`, author-only patterns, idempotent DROP/CREATE, post-migration validation, multi-user Playwright MCP tests.

Globally available (`~/.claude/skills/` via symlinks to `~/.agents/skills/`):
- `find-skills` (Vercel Labs) — discovery of new skills.

### MCP servers (`~/.claude.json`)
- **Playwright MCP** (`npx @playwright/mcp@latest`) — E2E flows, multi-workspace RLS isolation tests, cross-feature regression, vendor invisibility audits. Activate with `use playwright mcp` in the session prompt. Reserved for repetitive or long tests — not for trivial 30s manual checks.

### Slash commands
- `/security-review` (Anthropic native) — pre-commit security audit on diff vs main. Used systematically before merging UI/auth/billing-touching PRs.
- `/ultrareview` (Anthropic native, Opus 4.7) — end-of-sprint multi-agent review for critical sprints (DB migrations, security, shared code, 5+ files). 3 free runs/month then $5-25/run.
- `/impeccable {audit|critique|polish|typeset}` — UI 4-pass on UI sprints before E2E tests. Demonstrated value on Sprint L5/L5.1 landing (caught 3 WCAG AA contrast fails invisible to the eye, 1 TS runtime error, semantic HTML fix, mobile/desktop bar misalignment).

### GitHub Actions
- `.github/workflows/security-review.yml` — `anthropics/claude-code-security-review` audits every PR (triggers: opened, synchronize, reopened). Comments findings inline. Validated on 6 Stripe PRs on 18 May 2026, all clean.

## API conventions

### Error response format
Always capital-first, human-readable, matches HTTP status text:
- `401` → `{ error: 'Unauthorized' }`
- `403` → `{ error: 'Forbidden' }`
- `404` → `{ error: '<Resource> not found' }` (e.g. `'Workspace not found'`)
- `400` invalid JSON body → `{ error: 'Invalid JSON' }`
- `400` Zod validation fail → `{ error: 'Invalid payload', issues: [...] }` via `badRequest()` helper from `lib/schemas/index.ts` (96 usages across the codebase)

Never lowercase snake_case (`'invalid_payload'`, `'unauthorized'`). Open debt: 2 auth routes (signup, login) still inline `'invalid_payload'` — to normalize in a follow-up mini-sprint.

## Branding & vendor invisibility

### User-facing (UI, emails, error messages, marketing copy) — STRICT
**Never mention** in any user-visible string:
- Claude, Anthropic, Sonnet, Haiku
- GPT, OpenAI
- Clay, Apollo, Cleanlist, Vibe (enrichment providers)
- Instantly, Resend (email infrastructure)
- Cognism, Hunter, Dropcontact, Clearbit

**Use instead**:
- AI → "Sentra AI"
- Enrichment → "AI prospect research" / "verified contact data"
- Email warmup → "deliverability infrastructure"
- Discovery → "AI prospect discovery"

### Internal code (allowed)
Imports, env vars, dev comments are fine: `model: 'claude-sonnet-4-6'`, `import Stripe from 'stripe'`, `ANTHROPIC_API_KEY`, `INSTANTLY_API_KEY`, etc.

### Stripe public business name
"Sentra" (not "Max Command Center" — the previous project's name; webhook deactivated 18 May 2026).

## Build & deployment notes

### `next.config.js` — important
- `typescript.ignoreBuildErrors: true` — TypeScript errors do NOT block production build. A passing `npm run build` is NOT the same as "TypeScript clean". Run `npx tsc --noEmit` separately to verify type safety.
- `images.unoptimized: true` — Next.js Image Optimization off (acceptable pre-launch, monitor for future versions).

### Production
- Vercel Pro, project `sdr-platform`
- URL: `https://sdr-platform-sigma.vercel.app`
- Auto-deploy on push to `main`
- Custom domain `sentra.app` deferred until final brand name confirmed

## Known tech debt
- **#21** — Weight Step Rule design system not respected: 50+ `font-semibold` usages. Dedicated UI polish sprint, future.
- **#29** (ex-#23) — Workspace routes architecture: `/api/workspace-profile` vs `/api/workspace/profile`. Refactor aborted 18 May 2026 (superficial audit ≠ actual returned data). Future dedicated sprint with deep audit of returned fields and consumers.
- **`badRequest()` follow-up** — 2 auth routes (signup, login) still inline `'invalid_payload'` lowercase, not using centralized helper.

## Related project documents

The following are maintained in the Claude.ai Project Knowledge (not in this repo). Founder consults them; CC sessions cannot read them directly. CC should rely on this CLAUDE.md as the in-repo source of truth.

- `CURRENT_STATE_v7.md` — full project state snapshot (sprints, bugs, roadmap)
- `SENTRA_WORKFLOW_RULES.md` — detailed workflow rules
- `SENTRA_TOOLING_STACK.md` — consolidated tooling registry
- `SENTRA_REFERENCE.md` — product / architecture reference
- `SENTRA_PROJECT_TRACKER.md` — bugs / sprints tracker
- `AUDIT_AND_SECURITY_TOOLS.md` + `AUDIT_AND_UX_TOOLS.md` — generic tool catalogs

In this repo (root level):
- `PRODUCT.md` — brand personality, anti-references, design principles, audience
- `DESIGN.md` — north star "The Quiet Operator", palette, Fraunces Budget Rule, Weight Step Rule, One Signal Rule
- `.impeccable/design.json` — machine-readable design tokens sidecar for Impeccable

When material changes are made to this `CLAUDE.md`, reflect them in `SENTRA_TOOLING_STACK.md` (knowledge doc) to keep both aligned.
