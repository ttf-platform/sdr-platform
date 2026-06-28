import { z } from 'zod'

// POST /api/auto-fill body. Scrapes the URL with Anthropic Haiku to extract
// company info — caller must own a valid URL the scraper can reach.
export const autoFillSchema = z.object({
  url: z.string().url().max(2048),
}).strict()
