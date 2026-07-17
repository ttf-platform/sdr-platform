// Sentry configuration — server runtime (Node.js).
// Loaded via instrumentation.ts.register() on server boot.
//
// Cohabitation with PostHog: PostHog (posthog-node) captures errors via
// instrumentation.ts::onRequestError for product analytics. Sentry runs in
// parallel here for engineering-grade monitoring and alerting. Both fire on
// the same error surface; that duplication is intentional.
//
// EU data residency: the DSN itself carries the region hint (Sentry.io EU
// projects use `.ingest.de.sentry.io` in the DSN host), so we don't need an
// explicit region flag — the ingest URL follows the DSN.
//
// Fail-safe: if NEXT_PUBLIC_SENTRY_DSN is unset (dev without setup, preview
// without secrets, a fresh clone) the SDK stays fully disabled. No crash,
// no side-channel calls, no source-map upload, nothing.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const enabled = !!dsn && process.env.NODE_ENV === 'production'

if (enabled) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii:   false,
    environment:      process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  })
}
