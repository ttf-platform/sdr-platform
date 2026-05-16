import { z } from 'zod'

const TAG_COLOR_VALUES = ['gray', 'blue', 'green', 'purple', 'orange', 'red', 'yellow', 'pink'] as const

export const tagCreateSchema = z.object({
  label: z.string().min(1).max(30),
  color: z.enum(TAG_COLOR_VALUES).optional(),
}).strict()

export const prospectTagAttachSchema = z.object({
  tag_id: z.string().uuid(),
}).strict()
