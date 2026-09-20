/**
 * What the admin reads off a verified Supabase JWT.
 *
 * Shared by the request proxy (which has no `cookies()` and builds its own
 * client) and by server code (which goes through `getStaffSession`), so the
 * meaning of "staff" is defined in exactly one place.
 */

export type StaffRole = "owner" | "admin" | "staff";

export interface StaffClaims {
  userId: string | null;
  email: string | null;
  /** True when the token carries the staff stamp written by 0032's trigger. */
  isStaff: boolean;
  /** Present only when `isStaff`; null on a token minted before the stamp. */
  role: StaffRole | null;
}

interface ClaimsLike {
  sub?: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
}

const ROLES = new Set<string>(["owner", "admin", "staff"]);

export function staffFromClaims(claims: ClaimsLike | null | undefined): StaffClaims {
  if (!claims?.sub) return { userId: null, email: null, isStaff: false, role: null };
  const meta = claims.app_metadata ?? {};
  const role = typeof meta.staff_role === "string" && ROLES.has(meta.staff_role)
    ? (meta.staff_role as StaffRole)
    : null;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    isStaff: meta.is_staff === true,
    role,
  };
}
