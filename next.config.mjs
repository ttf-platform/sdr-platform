// @ts-check
import createNextIntlPlugin from 'next-intl/plugin'
import createMDX from '@next/mdx'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import remarkGfm from 'remark-gfm'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    // Order matters: frontmatter MUST run before gfm so it strips the YAML
    // block out of the tree before gfm starts parsing tables/lists/etc.
    remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  typedRoutes: true,
  images: {
    domains: ['localhost'],
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: '/landing-v2', destination: '/', permanent: true },
      { source: '/dashboard/admin', destination: '/admin', permanent: true },
    ]
  },
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // HSTS — enforced by Vercel in prod; also applied here for defence-in-depth
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
}

// Wrapper composition (outer → inner): next-intl → Sentry → MDX → base config.
// Sentry's plugin only rewrites the webpack config; MDX and next-intl each
// mutate `pageExtensions` / plugin loaders on top, so they must stay
// respectively inside and outside Sentry's wrap.
//
// The Sentry options are all build-time only. `silent: true` keeps the CI
// log clean when the auth token is absent (dev, previews without secrets,
// fresh clones); `authToken` is read from the env at build time, and
// `sourcemaps.disable = true` when it is missing so `npm run build` NEVER
// fails on a missing Sentry credential. `tunnelRoute` routes browser events
// through a same-origin path to bypass ad-blockers.
const sentryBuildOptions = {
  org:            process.env.SENTRY_ORG,
  project:        process.env.SENTRY_PROJECT,
  authToken:      process.env.SENTRY_AUTH_TOKEN,
  silent:         !process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute:    '/monitoring/sentry',
  hideSourceMaps: true,
  webpack: {
    treeshake: {
      // Strip Sentry's own debug logger from production bundles.
      // Replaces the deprecated top-level `disableLogger` flag.
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
}

export default withNextIntl(withSentryConfig(withMDX(nextConfig), sentryBuildOptions))
