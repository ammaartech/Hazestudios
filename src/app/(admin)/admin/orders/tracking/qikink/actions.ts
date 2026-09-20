"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/staff";
import { syncAllQikinkOrders } from "@/lib/qikink/tracking";

/**
 * Manual "Sync now" for the tracking page.
 *
 * Gated on staff status for the same reason as qikink-actions.ts: the work
 * underneath runs on the service-role client, and a Server Action is a public
 * POST endpoint. Without this check anyone could drive a merchant's Qikink
 * rate limit into the ground.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function syncQikinkTracking(): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (!staff.ok) return { ok: false, error: "You do not have permission to do this." };
  } catch {
    return { ok: false, error: "You do not have permission to do this." };
  }

  // force: this is an explicit button press, so the view throttle does not
  // apply — the operator asked for fresh data and deserves the API call.
  const result = await syncAllQikinkOrders(true);

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Could not sync with Qikink." };
  }

  revalidatePath("/admin/orders/tracking/qikink");

  if (result.skipped === "nothing-to-sync") {
    return { ok: true, message: "Nothing in flight — every order is delivered or cancelled." };
  }

  const orders = `${result.matched} order${result.matched === 1 ? "" : "s"}`;
  const parts = [
    result.changed > 0 ? `${result.changed} moved` : "no changes",
    // Worth calling out separately: an adopted order is one we had recorded as
    // failed while Qikink had it all along, so the operator's picture of it
    // just changed materially.
    result.adopted > 0 ? `${result.adopted} recovered` : null,
  ].filter(Boolean);

  return { ok: true, message: `Synced ${orders} — ${parts.join(", ")}.` };
}
