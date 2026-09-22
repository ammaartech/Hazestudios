"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/staff";
import { revalidateOrders } from "@/lib/analytics/dashboard";
import { addTimelineNote, cancelOpenRequests, releaseHold } from "@/lib/cashfree/advance";
import { getCourierConfig } from "@/lib/couriers/config";
import { isValidPincode, packageProblems, type PackageInput } from "@/lib/couriers/draft";
import { COURIERS, isCourierProvider, type CourierProvider } from "@/lib/couriers/providers";
import {
  bookShipment,
  cancelShipment,
  draftForOrder,
  syncShipment,
  type CourierShipment,
} from "@/lib/couriers/shipments";
import { adapterFor, isCourierError } from "@/lib/couriers/adapters";

/**
 * Order-page courier actions.
 *
 * Every one of these re-checks staff status before touching anything: the
 * booking code runs on the service-role client, and a Server Action is a
 * public POST endpoint. Without the gate, anyone on the internet could book
 * parcels on the merchant's courier account.
 *
 * The browser is trusted for exactly four things — which courier, which
 * service, how heavy the box is, and a note — and each is validated here. The
 * address and the money come from the database inside `bookShipment`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(id: unknown): Promise<{ id: string; actor: { userId: string | null; email: string | null } } | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  try {
    const staff = await requireStaff();
    if (!staff.ok) return null;
    return { id, actor: { userId: staff.session.userId, email: staff.session.email } };
  } catch {
    return null;
  }
}

const DENIED = "You do not have permission to do this.";

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export interface ShipOrderInput {
  provider: string;
  service: string;
  pkg: { weightKg: unknown; lengthCm: unknown; widthCm: unknown; heightCm: unknown; pieces: unknown };
  note?: string;
}

export type ShipOrderResult =
  | { ok: true; message: string; shipment: CourierShipment; warnings: string[] }
  | { ok: false; error: string; problems?: string[] };

export async function shipOrder(orderId: string, input: ShipOrderInput): Promise<ShipOrderResult> {
  const guarded = await guard(orderId);
  if (!guarded) return { ok: false, error: DENIED };

  if (!isCourierProvider(input.provider)) return { ok: false, error: "Pick a courier." };
  const provider: CourierProvider = input.provider;
  if (!COURIERS[provider].services.some((s) => s.code === input.service)) {
    return { ok: false, error: `Pick a ${COURIERS[provider].name} service.` };
  }

  const pkg: PackageInput = {
    weightKg: toNumber(input.pkg?.weightKg),
    lengthCm: toNumber(input.pkg?.lengthCm),
    widthCm: toNumber(input.pkg?.widthCm),
    heightCm: toNumber(input.pkg?.heightCm),
    pieces: Math.trunc(toNumber(input.pkg?.pieces)),
  };
  const problems = packageProblems(pkg);
  if (problems.length) return { ok: false, error: "Check the parcel details.", problems };

  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";

  const result = await bookShipment({ orderId: guarded.id, provider, service: input.service, pkg, note, actor: guarded.actor });

  // Pressing "Ship" on a held order *is* the decision, exactly as sending to
  // Qikink is (see qikink-actions.ts): once the courier has the COD amount it
  // cannot change, so the hold (0033) is released and any advance still being
  // asked for is withdrawn — otherwise the shopper would be asked online for
  // money the courier is also about to collect at the door. After the booking
  // rather than before it: a refused booking ships nothing, and the order
  // should stay parked exactly as it was.
  if (result.ok && (await releaseHold(guarded.id))) {
    await cancelOpenRequests(guarded.id);
    await addTimelineNote(guarded.id, `Released the COD hold — shipped by hand via ${COURIERS[provider].name}.`, guarded.actor);
  }

  revalidatePath(`/admin/orders/${guarded.id}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/tracking/${provider}`);
  revalidateOrders();

  if (!result.ok) return { ok: false, error: result.error, problems: result.problems };
  return {
    ok: true,
    message: `Booked with ${COURIERS[provider].name} — ${COURIERS[provider].awbLabel} ${result.shipment.awb}`,
    shipment: result.shipment,
    warnings: result.warnings,
  };
}

export type ShipmentActionResult = { ok: true; message: string; shipment: CourierShipment } | { ok: false; error: string };

export async function cancelCourierShipment(shipmentId: string, reason: string): Promise<ShipmentActionResult> {
  const guarded = await guard(shipmentId);
  if (!guarded) return { ok: false, error: DENIED };

  const result = await cancelShipment(guarded.id, typeof reason === "string" ? reason.slice(0, 200) : "", guarded.actor);
  if (!result.ok) return result;

  revalidatePath(`/admin/orders/${result.shipment.order_id}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/tracking/${result.shipment.provider}`);
  revalidateOrders();
  return { ok: true, message: "Booking cancelled. The order is unfulfilled again.", shipment: result.shipment };
}

export async function refreshCourierShipment(shipmentId: string): Promise<ShipmentActionResult> {
  const guarded = await guard(shipmentId);
  if (!guarded) return { ok: false, error: DENIED };

  const result = await syncShipment(guarded.id);
  if (!result.ok) return result;

  revalidatePath(`/admin/orders/${result.shipment.order_id}`);
  revalidatePath(`/admin/orders/tracking/${result.shipment.provider}`);
  return {
    ok: true,
    message: result.changed ? `Now “${result.shipment.provider_status ?? result.shipment.stage}”` : "Status is up to date",
    shipment: result.shipment,
  };
}

export type ServiceabilityResult =
  | { ok: true; serviceable: boolean; codServiceable: boolean | null; reason: string; destination: string | null }
  | { ok: false; error: string; unsupported?: boolean };

/**
 * Asks a courier whether they deliver to the order's pincode, for the dialog
 * to show before the operator commits. Shree Maruti, DTDC and Delhivery can
 * answer cheaply; Blue Dart has no equivalent — their pincode master is a bulk
 * download — so a Blue Dart booking finds out at booking time, with the same
 * message in the same place.
 */
export async function checkCourierServiceability(orderId: string, provider: string): Promise<ServiceabilityResult> {
  const guarded = await guard(orderId);
  if (!guarded) return { ok: false, error: DENIED };
  if (!isCourierProvider(provider)) return { ok: false, error: "Unknown courier." };

  const adapter = adapterFor(provider);
  if (!adapter.serviceability) {
    return { ok: false, unsupported: true, error: `${COURIERS[provider].name} has no serviceability check; the booking itself will say.` };
  }

  const [config, draft] = await Promise.all([getCourierConfig(provider), draftForOrder(guarded.id)]);
  if (!config) return { ok: false, error: `${COURIERS[provider].name} is not connected.` };
  if (!draft?.pickup || !isValidPincode(draft.pickup.postal_code) || !isValidPincode(draft.consignee.postal_code)) {
    return { ok: false, error: "Both pincodes must be valid before a serviceability check." };
  }

  try {
    const result = await adapter.serviceability(config, draft);
    return { ok: true, ...result };
  } catch (cause) {
    return {
      ok: false,
      error: isCourierError(cause) || cause instanceof Error ? cause.message : `Could not reach ${COURIERS[provider].name}.`,
    };
  }
}
