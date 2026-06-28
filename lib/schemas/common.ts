import { z } from 'zod'
import { NextResponse } from 'next/server'

// Shared validator for routes that take no body.
//
// Usage in a POST handler that has no body (e.g. approve / reject / undo
// actions where the route parameters carry all the state):
//
//   const guardResp = await enforceEmptyBody(request)
//   if (guardResp) return guardResp
//
// Behaviour: if the caller sends no body at all (request.json() throws),
// the helper accepts silently — that's the canonical "no-body" POST.
// If the caller sends ANY parsable JSON value (object, array, string,
// number, null), the helper requires it to be an empty object — anything
// else is a mass-assignment attempt and returns 400.
export const emptyBodySchema = z.object({}).strict()

export async function enforceEmptyBody(request: Request): Promise<NextResponse | null> {
  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return null } // no body OR malformed body → keep the route's pre-Zod behaviour
  if (rawBody === undefined || rawBody === null) return null
  const parsed = emptyBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  return null
}
