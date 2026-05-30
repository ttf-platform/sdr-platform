import dotenv from 'dotenv'
import path from 'path'
import { adminClient } from './setup'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function gc() {
  const admin  = adminClient()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 1. Delete orphan test workspaces older than 24h (CASCADE handles all fixtures)
  const { data: workspaces, error: wsErr } = await admin
    .from('workspaces')
    .select('id, name, created_at')
    .like('name', 'Test Workspace %')
    .lt('created_at', cutoff)

  if (wsErr) {
    console.error('[gc] Failed to query workspaces:', wsErr.message)
  } else if (workspaces && workspaces.length > 0) {
    const ids = workspaces.map(w => w.id)
    const { error: delErr } = await admin.from('workspaces').delete().in('id', ids)
    if (delErr) {
      console.error('[gc] Failed to delete workspaces:', delErr.message)
    } else {
      console.log(`[gc] Deleted ${workspaces.length} orphan test workspace(s)`)
    }
  } else {
    console.log('[gc] No orphan test workspaces found (older than 24h)')
  }

  // 2. Delete orphan test auth users older than 24h
  const { data: usersResp, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) {
    console.error('[gc] Failed to list auth users:', listErr.message)
    process.exit(1)
  }

  const orphans = (usersResp?.users ?? []).filter(u =>
    u.email?.startsWith('test-rls-') &&
    u.email?.endsWith('@example.com') &&
    new Date(u.created_at) < new Date(cutoff),
  )

  let deletedUsers = 0
  for (const u of orphans) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) {
      console.warn(`[gc] Failed to delete auth user ${u.id} (${u.email}):`, error.message)
    } else {
      deletedUsers++
    }
  }

  if (orphans.length > 0) {
    console.log(`[gc] Deleted ${deletedUsers}/${orphans.length} orphan test auth user(s)`)
  } else {
    console.log('[gc] No orphan test auth users found (older than 24h)')
  }

  console.log('[gc] Done.')
}

gc().catch(err => { console.error('[gc] Fatal:', err); process.exit(1) })
