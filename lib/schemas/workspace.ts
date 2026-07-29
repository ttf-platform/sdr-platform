import { z } from 'zod'
import { ianaSchema } from './booking'

// POST /api/workspace/create body.
// workspaceName is used as a display name AND as the seed for the URL slug
// (lowercased + non-alphanumerics → hyphen). The schema only enforces length;
// the slug helper sanitises whatever is left.
//
// `timezone` mirrors the signup path (lib/schemas/auth.ts::signupSchema) :
// the client detects the browser's IANA zone and posts it here so the
// recovery / onboarding path lands with the user's real timezone rather
// than the JSONB DEFAULT 'America/Toronto' (000_baseline.sql:1285).
// Same `.optional().catch(undefined)` discipline — a malformed value MUST
// NOT gate workspace creation ; the DEFAULT then applies.
export const workspaceCreateSchema = z.object({
  workspaceName: z.string().min(1).max(100),
  timezone:      ianaSchema.optional().catch(undefined),
}).strict()
