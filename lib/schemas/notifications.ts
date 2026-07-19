import { z } from 'zod'
import { NOTIFICATION_CATEGORIES } from '@/lib/notifications'

export const notificationCategoryEnum = z.enum(NOTIFICATION_CATEGORIES)

export const notificationsListQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit:  z.coerce.number().int().min(1).max(50).optional(),
}).strict()

// PATCH /api/notifications/preferences body :
// tableau d'upserts { category, in_app?, email? }. Au moins un champ à modifier.
export const notificationPreferencesPatchSchema = z.object({
  updates: z.array(
    z.object({
      category: notificationCategoryEnum,
      in_app:   z.boolean().optional(),
      email:    z.boolean().optional(),
    })
    .strict()
    .refine(
      (o) => o.in_app !== undefined || o.email !== undefined,
      { message: 'At least one of in_app or email must be provided' },
    ),
  ).min(1).max(NOTIFICATION_CATEGORIES.length),
}).strict()
