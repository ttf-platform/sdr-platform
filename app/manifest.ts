import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sentra',
    short_name: 'Sentra',
    description: 'Cold outreach that books meetings. All-in-one outbound for founders.',
    start_url: '/',
    scope: '/',
    id: '/',
    display: 'standalone',
    background_color: '#f7f4f0',
    theme_color: '#3b6bef',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}
