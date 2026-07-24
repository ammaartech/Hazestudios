import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS, so it must never be imported into a client
 * component or a shared module that one could reach — keep it to route handlers
 * and server actions.
 *
 * Used by /api/track: the storefront is public and unauthenticated, but the
 * analytics tables grant nothing to `anon` on purpose (a public insert policy
 * would let anyone forge sessions), so the write has to be privileged.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
