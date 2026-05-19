import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://sentra.app/',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: 'https://sentra.app/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://sentra.app/contact',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://sentra.app/pricing',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://sentra.app/legal/privacy',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: 'https://sentra.app/legal/terms',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: 'https://sentra.app/legal/cookies',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: 'https://sentra.app/legal/security',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: 'https://sentra.app/legal/sending-policy',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: 'https://sentra.app/legal/dpa',
      lastModified: new Date('2026-05-19'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ];
}
