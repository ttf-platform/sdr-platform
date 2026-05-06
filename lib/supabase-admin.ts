import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let _adminClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client with the SERVICE_ROLE key, bypassing RLS.
 * Use ONLY in server-side admin routes after requireSentraAdmin() has
 * verified the caller is a Sentra admin.
 *
 * NEVER expose this client or its results to the browser/client without
 * filtering — it sees ALL rows in ALL workspaces.
 */
export function getAdminSupabaseClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin client'
    );
  }

  _adminClient = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}
