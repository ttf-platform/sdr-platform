import { createAdminClient } from '@/lib/supabase/admin'

export async function logAdminAction(params: {
  admin_id:    string
  action_type: string
  target_type?: string
  target_id?:   string
  metadata?:    Record<string, unknown>
}): Promise<void> {
  try {
    await createAdminClient().from('admin_actions_log').insert({
      admin_id:    params.admin_id,
      action_type: params.action_type,
      target_type: params.target_type ?? null,
      target_id:   params.target_id   ?? null,
      metadata:    params.metadata    ?? null,
    })
  } catch (err) {
    console.error('[logAdminAction] failed:', err)
  }
}
