import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock every server dep dispatchAdminAlert reaches for. Each mock exposes
// a `__set` hook so each test can steer its behaviour without re-mocking.
let __recipients: Array<{ userId: string; workspaceId: string; email: string }> = []
let __notificationEmail: string | null = null
let __sendPreBakedCalls: Array<{ to: string; subject: string; html: string }> = []
let __sendAdminAlertCalls: Array<{ subject: string }> = []
let __sendAdminAlertResult: { ok: boolean; error?: string } = { ok: true }
let __notificationsInsertRows: unknown[] = []

vi.mock('../supabase/admin', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      insert: (rows: unknown) => ({
        select: () => Promise.resolve({
          data:  Array.isArray(rows) ? rows.map((_, i) => ({ id: `notif-${i}` })) : [],
          error: null,
        }),
      }),
    }),
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }) } },
  }),
}))

vi.mock('../admin-settings', () => ({
  getAdminSetting: async (_key: string) => null, // no per-event overrides in tests → registry defaults win
  getAdminNotificationEmail: async () => __notificationEmail,
}))

vi.mock('../admin-auth', () => ({
  getAdminEmails: () => [], // irrelevant here — recipient list is mocked below
}))

vi.mock('../email', () => ({
  sendAdminAlertEmail: async ({ subject }: { subject: string }) => {
    __sendAdminAlertCalls.push({ subject })
    return __sendAdminAlertResult
  },
  sendPreBakedAdminEmail: async (to: string, subject: string, html: string) => {
    __sendPreBakedCalls.push({ to, subject, html })
  },
}))

import { dispatchAdminAlert, __resetAdminRecipientsCache } from '../admin-alerts'

// The recipient resolver is inside admin-alerts.ts and uses createAdminClient
// under the hood. We can't intercept it cleanly without mocking the whole
// listUsers/workspace_members path, so we override the module's cache
// directly by patching the module's own internals.
// The simplest way : monkey-patch resolveAdminRecipients via require. Since
// the resolver is an internal fn (not exported), we swap it by pre-populating
// the cache through __resetAdminRecipientsCache + a side-channel we control :
// stub `auth.admin.listUsers` to return the wanted set. But we mocked to
// return [] above → recipients will always resolve to [].
// This is EXACTLY the scenario the fix targets : recipients=[] must not
// short-circuit the email branch.

beforeEach(() => {
  __recipients = []
  __notificationEmail = null
  __sendPreBakedCalls = []
  __sendAdminAlertCalls = []
  __sendAdminAlertResult = { ok: true }
  __notificationsInsertRows = []
  __resetAdminRecipientsCache()
})

describe('dispatchAdminAlert — email path decoupled from in-app recipients (PR3 fix 1)', () => {
  it('recipients=0 + email=ON + notification email configured → email fires (generic)', async () => {
    // getAdminSetting → null → registry defaults kick in. `bug_report` defaults
    // to { email: true, in_app: true } and recipient list is [] (see mocks).
    // Pre-fix : the early `if (recipients.length === 0) return result` killed
    // the email branch too. Post-fix : recipients=[] only skips in-app, email
    // still runs and lands via getAdminNotificationEmail.
    __notificationEmail = 'admin@mirvo.test'

    const r = await dispatchAdminAlert({
      event: 'bug_report',
      title: 'A bug happened',
      body:  'details',
      link:  '/admin/support',
    })

    expect(r.in_app_inserted).toBe(0)
    expect(r.email_sent).toBe(true)                 // ← the core fix
    expect(__sendAdminAlertCalls).toHaveLength(1)   // generic template (no pre-baked payload provided)
    expect(__sendAdminAlertCalls[0].subject).toBe('A bug happened')
    expect(__sendPreBakedCalls).toHaveLength(0)
  })

  it('recipients=0 + email=ON + pre-baked payload → pre-baked email fires', async () => {
    // Bug report route provides a pre-baked HTML template. The `input.email`
    // branch must fire even with zero in-app recipients.
    __notificationEmail = 'admin@mirvo.test'

    const r = await dispatchAdminAlert({
      event: 'bug_report',
      title: 'Pre-baked title',
      email: { subject: 'Rich subject', html: '<p>Rich HTML</p>' },
    })

    expect(r.email_sent).toBe(true)
    expect(__sendPreBakedCalls).toHaveLength(1)
    expect(__sendPreBakedCalls[0]).toEqual({
      to:      'admin@mirvo.test',
      subject: 'Rich subject',
      html:    '<p>Rich HTML</p>',
    })
    expect(__sendAdminAlertCalls).toHaveLength(0)
  })

  it('recipients=0 + email=ON + no notification email configured → email SKIPPED softly', async () => {
    // Fail-soft : no admin email anywhere → email_sent stays false, no throw,
    // no send attempted.
    __notificationEmail = null

    const r = await dispatchAdminAlert({
      event: 'bug_report',
      title: 'A bug happened',
      email: { subject: 'x', html: 'y' },
    })

    expect(r.email_sent).toBe(false)
    expect(__sendPreBakedCalls).toHaveLength(0)
    expect(__sendAdminAlertCalls).toHaveLength(0)
  })

  it('unknown event → no-op ok result, no send', async () => {
    const r = await dispatchAdminAlert({
      event: 'not_a_real_event' as never,
      title: 'x',
    })
    expect(r.email_sent).toBe(false)
    expect(r.in_app_inserted).toBe(0)
    expect(__sendPreBakedCalls).toHaveLength(0)
    expect(__sendAdminAlertCalls).toHaveLength(0)
  })
})
