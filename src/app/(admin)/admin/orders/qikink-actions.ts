"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/staff";
import { pushOrderToQikink, syncQikinkOrder } from "@/lib/qikink/fulfillment";
import { addTimelineNote, cancelOpenRequests, releaseHold } from "@/lib/cashfree/advance";

/**
 * Order-page Qikink actions.
 *
 * Both re-check staff status: the work underneath runs on the service-role
 * client, so without a gate here a Server Action POST would let anyone send
 * arbitrary orders into a merchant's production queue. The check reads the
 * signed token (see `lib/auth/staff.ts`) rather than making a round trip.
 */

type Result =
  | { ok: true; message: string }
  | { ok: false; error: string; problems?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(orderId: unknown): Promise<string | null> {
  if (typeof orderId !== "string" || !UUID.test(orderId)) return null;
  try {
    const staff = await requireStaff();
    return staff.ok ? orderId : null;
  } catch {
    return null;
  }
}

export async function sendOrderToQikink(orderId: string): Promise<Result> {
  const id = await guard(orderId);
  if (!id) return { ok: false, error: "You do not have permission to do this." };

  // Pressing "Send" on a held order *is* the decision: it ships as whatever
  // it is right now, so the COD hold (0033) is released and any advance still
  // being asked for is withdrawn — once Qikink has the order the collectable
  // amount cannot change, and a request left open would be asking the shopper
  // for money the courier is also going to collect.
  if (await releaseHold(id)) {
    await cancelOpenRequests(id);
    const staff = await requireStaff();
    await addTimelineNote(
      id,
      "Released the COD hold and sent to Qikink by hand.",
      staff.ok ? { userId: staff.session.userId, email: staff.session.email } : null
    );
  }

  const result = await pushOrderToQikink(id);
  revalidatePath(`/admin/orders/${id}`);

  return result.ok
    ? { ok: true, message: `Sent to Qikink (order ${result.qikinkOrderId})` }
    : { ok: false, error: result.error, problems: result.problems };
}

export async function refreshQikinkStatus(orderId: string): Promise<Result> {
  const id = await guard(orderId);
  if (!id) return { ok: false, error: "You do not have permission to do this." };

  const result = await syncQikinkOrder(id);
  revalidatePath(`/admin/orders/${id}`);

  return result.ok
    ? { ok: true, message: "Status refreshed" }
    : { ok: false, error: result.error };
}
