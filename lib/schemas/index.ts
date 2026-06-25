export * from './auth'
export * from './signals'
export * from './campaigns'
export * from './prospects'
export * from './email-accounts'
export * from './workspace-profile'
export * from './admin'
export * from './billing'
export * from './bulk'
export * from './booking'
export * from './campaigns-llm'
export * from './list-queries'
export * from './meetings'
export * from './deals'
export * from './notes'
export * from './tags'
export * from './contacts'
export * from './prospect-emails'
export * from './sending-preferences'
export * from './bot'
export * from './support'
export * from './email-variants'
export * from './dfy'

import { NextResponse } from 'next/server'

export function badRequest(issues: unknown) {
  return NextResponse.json({ error: 'Invalid payload', issues }, { status: 400 })
}
