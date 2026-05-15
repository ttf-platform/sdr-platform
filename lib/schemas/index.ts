export * from './auth'
export * from './campaigns'
export * from './prospects'
export * from './email-accounts'

import { NextResponse } from 'next/server'

export function badRequest(issues: unknown) {
  return NextResponse.json({ error: 'invalid_payload', issues }, { status: 400 })
}
