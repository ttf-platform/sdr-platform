import { NextResponse } from 'next/server'
import { runHealthChecks } from '@/lib/health-checks'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const result = await runHealthChecks()
  const httpStatus = result.status === 'down' ? 503 : 200
  return NextResponse.json(result, {
    status: httpStatus,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}
