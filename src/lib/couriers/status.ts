import type { CourierProvider } from "./providers";

/**
 * Normalising two couriers' status vocabularies into stages we can filter and
 * alert on.
 *
 * Same idea as `qikink/status.ts`, and for the same reasons: Shree Maruti's
 * webhook speaks in `SCREAMING_SNAKE` codes (`OUT_FOR_DELIVERY`,
 * `RTO_INITIATED`), Blue Dart's tracking speaks in scan sentences ("SHIPMENT
 * FURTHER CONNECTED", "SHIPMENT DELIVERED"), and both are theirs to change.
 * Matching is done on a squashed, lowercased form; an unrecognised string
 * becomes `unknown` and surfaces as its own bucket rather than vanishing.
 *
 * The stages are ordered by how far along the parcel is, because "stuck" is
 * defined as time spent without the stage advancing.
 */

export const SHIPMENT_STAGES = [
  "not_booked",
  "booked",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "undelivered",
  "rto",
  "cancelled",
  "unknown",
] as const;

export type ShipmentStage = (typeof SHIPMENT_STAGES)[number];

export function isShipmentStage(value: unknown): value is ShipmentStage {
  return typeof value === "string" && (SHIPMENT_STAGES as readonly string[]).includes(value);
}

/** Rank along the happy path. Stages off it — detours and endings — sit at -1. */
const STAGE_ORDER: Record<ShipmentStage, number> = {
  not_booked: 0,
  booked: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
  undelivered: -1,
  rto: -1,
  cancelled: -1,
  unknown: -1,
};

export function stageRank(stage: ShipmentStage): number {
  return STAGE_ORDER[stage] ?? -1;
}

/** Stages where the parcel has stopped moving, for good or ill. */
export function isTerminalStage(stage: ShipmentStage): boolean {
  return stage === "delivered" || stage === "rto" || stage === "cancelled";
}

/** Booked and somewhere between the warehouse and the doorstep. */
export function isInFlight(stage: ShipmentStage): boolean {
  return (
    stage === "booked" ||
    stage === "picked_up" ||
    stage === "in_transit" ||
    stage === "out_for_delivery" ||
    stage === "undelivered" ||
    stage === "unknown"
  );
}

const LABELS: Record<ShipmentStage, string> = {
  not_booked: "Not booked",
  booked: "Booked",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  undelivered: "Undelivered",
  rto: "Returned (RTO)",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export function shipmentStageLabel(stage: ShipmentStage): string {
  return LABELS[stage] ?? stage;
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Substring rules, first match wins, so order matters: "rto delivered"
 * contains "delivered", "undelivered" contains "delivered", "out for delivery"
 * contains "delivery". The alarming and the specific are tested before the
 * reassuring and the general.
 */
const RULES: [test: string, stage: ShipmentStage][] = [
  ["cancel", "cancelled"],

  // Returns, in every spelling both couriers use. Blue Dart says "RETURNED TO
  // SHIPPER"; Shree Maruti has four RTO_* codes. All of them mean the parcel
  // is coming back, whatever leg of that journey it is on.
  ["rto", "rto"],
  ["return", "rto"],

  // Failed attempts. Shree Maruti: UNDELIVERED. Blue Dart: "UNDELIVERED",
  // "CONSIGNEE NOT AVAILABLE", "ADDRESS INCOMPLETE", plus their NDR wording.
  // Before "delivered" because the word is inside two of them.
  ["undeliver", "undelivered"],
  ["not delivered", "undelivered"],
  ["delivery attempt", "undelivered"],
  ["not available", "undelivered"],
  ["refused", "undelivered"],
  ["ndr", "undelivered"],

  ["out for delivery", "out_for_delivery"],
  ["ofd", "out_for_delivery"],

  ["delivered", "delivered"],

  // Movement between hubs. Blue Dart's scans are "ARRIVED AT", "FURTHER
  // CONNECTED", "IN TRANSIT", "REACHED"; Shree Maruti's are IN_TRANSIT and
  // ARRIVED_AT_HUB. Anything that names a hub or a connection is movement.
  ["in transit", "in_transit"],
  ["intransit", "in_transit"],
  ["arrived", "in_transit"],
  ["connected", "in_transit"],
  ["reached", "in_transit"],
  ["dispatched", "in_transit"],
  ["shipped", "in_transit"],
  ["hub", "in_transit"],

  // Shree Maruti's READY_FOR_DISPATCH is categorised PICKED_UP in their own
  // docs; Blue Dart's first scan is "SHIPMENT PICKED UP".
  ["picked up", "picked_up"],
  ["pickup", "picked_up"],
  ["pick up", "picked_up"],
  ["ready for dispatch", "picked_up"],
  ["manifest", "picked_up"],

  // The pre-pickup states of a fresh booking.
  ["order created", "booked"],
  ["created", "booked"],
  ["confirmed", "booked"],
  ["processing", "booked"],
  ["processed", "booked"],
  ["booked", "booked"],
  ["softdata", "booked"],
  ["waybill", "booked"],
  ["pending", "booked"],
];

/**
 * Blue Dart's `StatusType` is a two-letter code alongside the sentence, and a
 * far more stable signal than the text when it is present. Only the codes seen
 * in their tracking documentation are mapped; anything else falls through to
 * the sentence.
 */
const BLUEDART_STATUS_TYPES: Record<string, ShipmentStage> = {
  DL: "delivered",
  UD: "undelivered",
  IT: "in_transit",
  PU: "picked_up",
  OD: "out_for_delivery",
  RT: "rto",
  RD: "rto",
  CN: "cancelled",
};

export function normalizeShipmentStage(
  provider: CourierProvider,
  statusText: string | null | undefined,
  hint?: { statusType?: string | null; hasAwb?: boolean }
): ShipmentStage {
  if (provider === "bluedart" && hint?.statusType) {
    const byCode = BLUEDART_STATUS_TYPES[hint.statusType.trim().toUpperCase()];
    if (byCode) return byCode;
  }

  const text = (statusText ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // No status yet but an AWB in hand is a booking the courier has not scanned;
  // no status and no AWB is nothing at all.
  if (!text) return hint?.hasAwb ? "booked" : "not_booked";

  for (const [test, stage] of RULES) {
    if (text.includes(test)) return stage;
  }
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How long a stage may sit unchanged before it is worth looking at. Generous
 * on purpose — a false alarm costs a glance, a missed one costs a return.
 */
const STALE_AFTER_HOURS: Partial<Record<ShipmentStage, number>> = {
  // Booked but never picked up is the failure mode of self-shipping: the
  // parcel is sitting in the studio and nobody has come for it.
  booked: 48,
  picked_up: 72,
  in_transit: 168,
  out_for_delivery: 48,
};

export type ShipmentAlertLevel = "critical" | "warning";

export interface ShipmentAlert {
  level: ShipmentAlertLevel;
  reason: string;
}

export function shipmentAlert(input: {
  status: "booked" | "failed" | "cancelled";
  stage: ShipmentStage;
  error: string | null;
  stageSince: string | null;
  createdAt: string;
  now?: Date;
}): ShipmentAlert | null {
  const { status, stage, error, stageSince, createdAt } = input;
  const now = input.now ?? new Date();

  if (status === "failed") {
    return { level: "critical", reason: error?.trim() || "Booking failed." };
  }
  if (status === "cancelled") return null;

  if (stage === "rto") {
    return { level: "critical", reason: "Returning to origin — this parcel did not reach the customer." };
  }
  if (stage === "undelivered") {
    return { level: "warning", reason: "Delivery attempt failed. The courier may retry, or start a return." };
  }
  if (stage === "unknown") {
    return { level: "warning", reason: "The courier reported a status we don't recognise yet." };
  }
  if (stage === "delivered" || stage === "cancelled") return null;

  const threshold = STALE_AFTER_HOURS[stage];
  if (threshold == null) return null;

  const since = new Date(stageSince ?? createdAt);
  if (Number.isNaN(since.getTime())) return null;

  const hours = (now.getTime() - since.getTime()) / 3_600_000;
  if (hours < threshold) return null;

  const days = Math.floor(hours / 24);
  const age = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.floor(hours)} hours`;

  return {
    level: hours >= threshold * 2 ? "critical" : "warning",
    reason:
      stage === "booked"
        ? `Booked ${age} ago and not picked up yet. Check the pickup with the courier.`
        : `Stuck at “${shipmentStageLabel(stage)}” for ${age}.`,
  };
}
