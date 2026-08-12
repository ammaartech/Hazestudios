/**
 * TEMPORARY — the testing-phase lock on the storefront.
 *
 * ===========================================================================
 * WHAT THIS DOES
 * ===========================================================================
 * The Summer Sands waitlist is live and being handed out on Instagram, but the
 * shop around it is half-built. Without this, someone arriving for the event
 * could tap the header and land in an unfinished catalogue with real prices and
 * a checkout that is still being wired up.
 *
 * So: `/waitlist` is open to the world, and everything else on the storefront
 * asks for an account first. The gate is enforced in `src/lib/supabase/proxy.ts`
 * — at the edge, before a route renders — and the message explaining it lives in
 * `AuthShell`.
 *
 * ===========================================================================
 * REMOVING IT AT LAUNCH
 * ===========================================================================
 * Set `STOREFRONT_PREVIEW_LOCK=off` to open the store without a deploy. When the
 * shop is genuinely live, delete this file and the three places that import it;
 * `git grep preview-lock` finds all of them.
 *
 * The default is *locked*, deliberately. A missing environment variable should
 * fail towards a closed shop, not towards an unfinished one being publicly
 * browsable.
 */

export const PREVIEW_LOCK = process.env.STOREFRONT_PREVIEW_LOCK !== "off";

/**
 * Who gets through.
 *
 * Any signed-in account — not staff only. That is the point: it lets a handful
 * of testers register and look around without anyone on the team handing out
 * credentials, while still stopping waitlist traffic from wandering in.
 *
 * It is a speed bump, not a vault. Registration is open, so anyone determined
 * enough to make an account can browse. If the shop needs to be genuinely
 * private, change the check in `proxy.ts` from "has a user" to the
 * `is_staff()` RPC the admin branch already calls.
 */

/**
 * Paths that stay public while the lock is on.
 *
 * Two kinds, and both are load-bearing:
 *
 *   * `/waitlist` — the whole reason for the lock. It must never redirect.
 *   * the auth screens — a gate that stands between someone and the page that
 *     lets them past it is just an outage. `/auth/callback` is on the list for
 *     the same reason: it is the hop that turns a confirmation email into a
 *     session, and it necessarily runs before one exists.
 *
 * `/admin` and `/login` are absent because the staff branch in `proxy.ts` runs
 * first and answers for them on its own terms.
 */
const OPEN_PREFIXES = [
  "/waitlist",
  "/account/login",
  "/account/register",
  "/account/reset",
  "/account/check-email",
  "/auth/callback",
];

export function isOpenDuringPreview(pathname: string): boolean {
  return OPEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
