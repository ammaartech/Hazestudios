import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MIN_REMOTE_TERM, type Result } from "./types";

/**
 * The half of admin search that cannot live in the browser.
 *
 * Orders (6,772), customers (3,974) and variant SKUs (2,659) are too many to
 * ship to the client and change too often to cache, so they are ranked in
 * Postgres by `admin_search` (migration 0030). One RPC rather than three
 * queries: the function unions and ranks the three entities against each other,
 * so a keystroke costs one round trip and the caller receives an ordered list
 * rather than three races to reconcile.
 *
 * Scores come back on the same 0..1 scale the browser-side matcher emits, which
 * is what lets the dropdown merge both tiers into a single ordered list.
 */

/** Per entity, not overall: the RPC applies it with a per-kind window, so forty
 *  matching orders can never push the one matching customer off the list. */
const PER_KIND = 5;

interface RemoteRow {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  amount: string | number | null;
  at: string | null;
  score: number;
}

const HREF: Record<string, (id: string) => string> = {
  order: (id) => `/admin/orders/${id}`,
  customer: (id) => `/admin/customers/${id}`,
  product: (id) => `/admin/products/${id}`,
};

export async function searchRemote(
  supabase: SupabaseClient,
  term: string
): Promise<Result[]> {
  const q = term.trim();
  if (q.length < MIN_REMOTE_TERM) return [];

  // The term is a bound parameter, so it needs no escaping here: the `%` and
  // `_` wildcards it may contain are assembled inside the function against that
  // parameter, never concatenated into SQL text.
  const { data, error } = await supabase.rpc("admin_search", { q, lim: PER_KIND });

  if (error) {
    // A failing remote tier must not take the dropdown down with it — the
    // catalogue results are already on screen and still correct. Logged, and
    // the caller sees an empty remote set.
    console.error("admin_search failed:", error.message);
    return [];
  }

  return ((data ?? []) as RemoteRow[])
    .filter((row) => row.kind in HREF)
    .map((row) => ({
      kind: row.kind as Result["kind"],
      id: row.id,
      href: HREF[row.kind](row.id),
      title: row.title,
      subtitle: row.subtitle,
      meta: row.meta,
      // `numeric` crosses PostgREST as a string so arbitrary precision survives.
      // Every money column here is numeric(12,2), well inside what a double
      // holds exactly, so converting is safe and lets the row align it as money.
      amount: row.amount === null ? null : Number(row.amount),
      score: row.score,
    }));
}
