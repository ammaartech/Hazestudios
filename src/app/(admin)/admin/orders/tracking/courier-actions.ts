"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/staff";
import { isCourierProvider } from "@/lib/couriers/providers";
import { syncInFlight } from "@/lib/couriers/shipments";

/**
 * Manual "Sync now" for the courier tracking pages.
 *
 * Gated on staff status for the same reason as the Qikink one: the work
 * underneath runs on the service-role client and calls a rate-limited API on
 * the merchant's account, and a Server Action is a public POST endpoint.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function syncCourierTracking(provider: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (!staff.ok) return { ok: false, error: "You do not have permission to do this." };
  } catch {
    return { ok: false, error: "You do not have permission to do this." };
  }
  if (!isCourierProvider(provider)) return { ok: false, error: "Unknown courier." };

  // force: an explicit button press deserves the API calls even inside the
  // throttle window.
  const result = await syncInFlight(provider, { force: true });
  revalidatePath(`/admin/orders/tracking/${provider}`);

  if (result.skipped === "not-configured") return { ok: false, error: result.error ?? "Not connected." };
  if (result.skipped === "nothing-to-sync") {
    return { ok: true, message: "Nothing in flight — every parcel is delivered, returned or cancelled." };
  }
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Could not sync." };
  }
  const parcels = `${result.checked} parcel${result.checked === 1 ? "" : "s"}`;
  return { ok: true, message: `Checked ${parcels} — ${result.changed > 0 ? `${result.changed} moved` : "no changes"}.` };
}
