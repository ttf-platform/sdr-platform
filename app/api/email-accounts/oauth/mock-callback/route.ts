/**
 * GET /api/email-accounts/oauth/mock-callback?session=...
 *
 * Only used when MOCK_EMAIL_PROVIDER=true (or INSTANTLY_API_KEY is missing).
 * Stands in for the provider's hosted OAuth page so the popup flow can be
 * exercised end-to-end locally without external calls.
 *
 * In a real production environment (INSTANTLY_API_KEY set and mock not
 * forced) this route MUST NOT exist — otherwise an attacker could simulate
 * a "successful" connection without going through Instantly. Gate hard.
 */

import { NextResponse } from 'next/server'

function isMockEnabled(): boolean {
  if (process.env.MOCK_EMAIL_PROVIDER === 'true') return true
  if (!process.env.INSTANTLY_API_KEY) return true
  return false
}

export async function GET() {
  if (!isMockEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Connecting your mailbox…</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #f5f2ee; color: #1a1a1a;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: white; border: 1px solid #e8e3dc; border-radius: 8px;
          padding: 24px 32px; max-width: 420px; text-align: center; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p  { font-size: 13px; color: #4a4a5a; margin: 0; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Mailbox connected</h1>
    <p>This window will close shortly. Return to the app to continue.</p>
  </div>
  <script>
    setTimeout(function () { try { window.close() } catch (e) {} }, 1500);
  </script>
</body>
</html>`
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
