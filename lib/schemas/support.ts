import { z } from 'zod'

const FEEDBACK_CATEGORIES = ['suggestion', 'feature_request', 'ux', 'performance', 'other'] as const

export const bugReportSchema = z.object({
  title:            z.string().min(1).max(200),
  description:      z.string().min(1).max(5000),
  stepsToReproduce: z.string().max(5000).optional(),
  expectedBehavior: z.string().max(2000).optional(),
  browser:          z.string().max(200).optional(),
  pageUrl:          z.string().max(500).optional(),
  screenshotUrl:    z.string().max(500).optional(),
}).strict()

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  content:  z.string().min(1).max(5000),
  wouldPay: z.boolean().optional(),
}).strict()
