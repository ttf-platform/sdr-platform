import { z } from 'zod'

// POST /api/workspace/create body.
// workspaceName is used as a display name AND as the seed for the URL slug
// (lowercased + non-alphanumerics → hyphen). The schema only enforces length;
// the slug helper sanitises whatever is left.
export const workspaceCreateSchema = z.object({
  workspaceName: z.string().min(1).max(100),
}).strict()
