import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { staffFromClaims, type StaffClaims } from "@/lib/auth/claims";

/**
 * The signed-in staff member, for server components and Server Actions.
 *
 * Verifies the session token locally (ES256 against the cached JWKS) and reads
 * identity and staff status from it — no round trip to the Auth server and no
 * `is_staff` RPC. The request proxy has already turned away anyone who is not
 * staff before an admin page renders, and RLS refuses the data regardless, so
 * this is for *identity* (who is acting, for notes and audit fields) and for a
 * cheap early return in actions, not for the security boundary itself.
 *
 * Memoised per request with React `cache`: a page and the actions and layout
 * pieces it renders share one verification.
 */
export const getStaffSession = cache(async (): Promise<StaffClaims> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  let claims: Parameters<typeof staffFromClaims>[0] = data?.claims ?? null;
  if (!claims && error) {
    // Same fallback as the proxy: a key-set fetch failure is not a sign-out.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) claims = { sub: user.id, email: user.email, app_metadata: user.app_metadata };
  }
  const session = staffFromClaims(claims);

  // A token minted before the staff stamp existed (0032) carries no claim.
  // Ask once — it is a hundred-odd milliseconds — and only for this request;
  // the stamp arrives with the next token refresh.
  if (session.userId && !session.isStaff) {
    const { data: isStaff } = await supabase.rpc("is_staff");
    if (isStaff) return { ...session, isStaff: true };
  }

  return session;
});

/**
 * For Server Actions: the acting staff member, or a message for the caller.
 * Actions that reach the database through the cookie client are protected by
 * RLS either way; this exists so the ones that use the service-role client —
 * payment and integration secrets — refuse before touching it.
 */
export async function requireStaff(): Promise<
  { ok: true; session: StaffClaims } | { ok: false; error: string }
> {
  const session = await getStaffSession();
  if (!session.userId) return { ok: false, error: "Not signed in" };
  if (!session.isStaff) return { ok: false, error: "Staff only" };
  return { ok: true, session };
}
