export * from './auth'
export * from './campaigns'
export * from './prospects'
export * from './email-accounts'
export * from './workspace-profile'
export * from './admin'
export * from './billing'
export * from './bulk'

import { NextResponse } from 'next/server'

export function badRequest(issues: unknown) {
  return NextResponse.json({ error: 'invalid_payload', issues }, { status: 400 })
}
