// @ts-check
import createNextIntlPlugin from 'next-intl/plugin'
import createMDX from '@next/mdx'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import remarkGfm from 'remark-gfm'

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

export default withNextIntl(withMDX(nextConfig))
