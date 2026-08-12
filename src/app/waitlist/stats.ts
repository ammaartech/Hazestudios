import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { WAITLIST_TAG } from "@/lib/shop/cache";
import { SEATS } from "@/lib/shop/waitlist";

/**
 * The seat count behind the "20 seats · 6 left" line.
 *
 * Kept out of `@/lib/shop/waitlist` and next to its only caller because that
 * module is imported by the Client Component that draws the form. Anything
 * reachable from there is bundled for the browser, and `next/cache` is not — the
 * build fails outright rather than tree-shaking it away.
 */

export interface WaitlistStats {
  /** How many people have signed up. */
  signups: number;
  /** Seats still unclaimed, floored at zero. */
  seatsLeft: number;
}

/**
 * Reads on the **service-role** client, not the anon one the catalogue queries
 * use. `waitlist_entries` grants nothing to `anon` on purpose (0024), so an anon
 * read would come back empty and the page would cheerfully report all twenty
 * seats free forever. Only a `count` crosses the boundary — no attendee row is
 * read here, let alone sent to the browser.
 *
 * `use cache` is what keeps this off the request path. Without it a live count
 * in the page body would opt the whole route out of prerendering under
 * `cacheComponents`, and every visitor would wait on Postgres to see a number
 * that changes a few times a day. The sign-up action expires the tag, so the
 * figure is stale only for the gap between someone else's sign-up and the next
 * read.
 */
export const getWaitlistStats = cache(async (): Promise<WaitlistStats> => {
  "use cache";
  cacheLife("catalog");
  cacheTag(WAITLIST_TAG);

  const supabase = createAdminClient();
  if (!supabase) return { signups: 0, seatsLeft: SEATS };

  const { count, error } = await supabase
    .from("waitlist_entries")
    .select("id", { count: "exact", head: true });

  // A failed count is not worth failing the page over: the form still works,
  // and the line degrades to the full twenty rather than showing a wrong number.
  if (error || count === null) return { signups: 0, seatsLeft: SEATS };

  return { signups: count, seatsLeft: Math.max(0, SEATS - count) };
});
