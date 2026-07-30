import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The storefront catalogue client — anon key, and deliberately cookie-blind.
 *
 * `server.ts` builds a client around `cookies()`, which is correct for anything
 * that depends on who is asking. The public catalogue does not: a hoodie's
 * price, photos and stock are the same for every visitor. Reading cookies to
 * fetch them costs twice over —
 *
 *   1. `cookies()` is a request API, so the read can never enter a cache scope.
 *      `unstable_cache` throws outright if it finds one. Every catalogue query
 *      was therefore forced to be a live round trip, per visitor, per render.
 *   2. It makes the response *depend* on the caller's session. A signed-in
 *      staff member's RLS context differs from anon, so caching a cookie-bound
 *      read risks filling the shared cache with a staff-shaped response and
 *      serving it to the public — the exact reason the explicit `status` and
 *      `published_at` filters in `queries.ts` exist as belt-and-braces.
 *
 * Dropping cookies fixes both: the result is identical for everyone, so it is
 * safe to compute once and share, and every caller is `anon` so the public RLS
 * policies in 0003_storefront_public_read.sql are the only ones in play. Staff
 * browsing the storefront now see exactly what a shopper sees, which is what
 * the storefront was always meant to show them.
 *
 * Anything reading per-shopper state (carts, orders, account) keeps using
 * `server.ts`. This client is for the shared catalogue only.
 */

let cached: SupabaseClient | null = null;

export function createPublicClient(): SupabaseClient {
  // One client for the lifetime of the server instance. `createClient` opens no
  // connection on its own — it is a thin fetch wrapper — but rebuilding it per
  // query allocated a new auth subsystem each time for no benefit.
  if (cached) return cached;

  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // No session to keep, refresh, or parse out of a URL. Left on, the
        // refresh timer is a background task that keeps a serverless
        // invocation alive past the response.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  return cached;
}
