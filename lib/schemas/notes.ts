import { z } from 'zod'

const noteContent = z.string().min(1).max(5000)

export const noteCreateSchema = z.object({ content: noteContent }).strict()
export const noteUpdateSchema = z.object({ content: noteContent }).strict()
