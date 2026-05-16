import { z } from 'zod'

const timeHHMM  = z.string().regex(/^\d{2}:\d{2}$/)
const dayOfWeek = z.number().int().min(0).max(6)

export const sendingPreferencesSchema = z.object({
  prefs: z.object({
    defaultSendTime: timeHHMM,
    sendWindowStart: timeHHMM,
    sendWindowEnd:   timeHHMM,
    sendDays:        z.array(dayOfWeek).min(1).max(7),
  }).strict(),
}).strict()
