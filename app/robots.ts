import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/', '/dashboard/', '/_next/'],
      },
    ],
    sitemap: 'https://sentra.app/sitemap.xml',
    host: 'https://sentra.app',
  }
}
