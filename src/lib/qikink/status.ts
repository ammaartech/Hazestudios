/**
 * Normalising Qikink's status text into stages we can filter and alert on.
 *
 * Qikink's `/api/order` returns `status` as free text — "In Transit", "Out For
 * Delivery", "RTO Initiated" — and it is theirs to change. Two consequences
 * shape this file:
 *
 *   1. Matching is done on a squashed, lowercased form, so a casing change or
 *      an extra space on their side cannot silently empty a tab.
 *   2. An unrecognised string becomes `unknown` rather than being dropped. A
 *      status we have not learned yet is exactly the case an operator most
 *      needs to see, so it surfaces as its own bucket instead of disappearing
 *      into "Delivered".
 *
 * The stages are ordered by how far along the parcel is. That ordering is the
 * whole point of `STAGE_ORDER`: "stuck" is defined as time spent without the
 * stage advancing, and without a rank there is nothing to advance.
 */

export const STAGES = [
  "not_sent",
  "created",
  "on_hold",
  "in_production",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "rto",
  "cancelled",
  "unknown",
] as const;

export type QikinkStage = (typeof STAGES)[number];

/** Rank along the happy path. Terminal-but-bad stages sit outside it (-1). */
const STAGE_ORDER: Record<QikinkStage, number> = {
  not_sent: 0,
  created: 1,
  // Ranked just past `created` because that is where Qikink parks an order it
  // has accepted but not started: observed live, every "On Hold" order has a
  // null `live_date`, no AWB and no courier, while the delivered one has all
  // three. It is a real position in the sequence, not a detour — but it is a
  // position an order is stuck *at*, which is why `alertFor` times it out.
  on_hold: 2,
  in_production: 3,
  picked_up: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
  rto: -1,
  cancelled: -1,
  unknown: -1,
};

export function stageRank(stage: QikinkStage): number {
  return STAGE_ORDER[stage] ?? -1;
}

/** Stages where the parcel has stopped moving, for good or ill. */
export function isTerminal(stage: QikinkStage): boolean {
  return stage === "delivered" || stage === "rto" || stage === "cancelled";
}

/**
 * Substring rules, checked in order — first match wins.
 *
 * Order matters more than it looks. "out for delivery" contains "delivery",
 * and "rto delivered" contains "delivered", so the specific and the alarming
 * are tested before the general and the reassuring. Adding a rule means asking
 * where it sits, not just what it says.
 */
const RULES: [test: string, stage: QikinkStage][] = [
  // Failure and reversal first: these strings often embed a happier one.
  ["cancel", "cancelled"],
  ["rto", "rto"],
  ["return", "rto"],
  ["undeliver", "rto"],
  ["failed delivery", "rto"],

  // Qikink's holding pen, and by volume the most common status this account
  // sees. Before the happy-path rules because "On Hold" must never be read as
  // progress, and its own stage rather than `unknown` so the operator gets a
  // stale-timer on it instead of a permanent "we don't recognise this" warning.
  ["on hold", "on_hold"],
  ["onhold", "on_hold"],
  ["hold", "on_hold"],

  ["out for delivery", "out_for_delivery"],
  ["ofd", "out_for_delivery"],

  ["delivered", "delivered"],
  ["complete", "delivered"],

  ["in transit", "in_transit"],
  ["intransit", "in_transit"],
  ["shipped", "in_transit"],
  ["dispatch", "in_transit"],

  ["picked up", "picked_up"],
  ["pickup", "picked_up"],
  ["pick up", "picked_up"],
  ["manifest", "picked_up"],
  ["ready to ship", "picked_up"],

  ["production", "in_production"],
  ["printing", "in_production"],
  ["processing", "in_production"],
  ["accepted", "in_production"],
  ["confirmed", "in_production"],
  // Qikink's word for "released from hold and now being made" — what the
  // dashboard's "Move to Live" button produces, and the counterpart to
  // `on_hold`. Confirmed against a real order moved live: `live_date` gets set
  // while `awb` and `courier_provider_name` stay null, so the job has started
  // but no courier has it yet. That is precisely `in_production`.
  //
  // Placed last among these because "live" is a short, greedy substring: any
  // future status containing it — "Live Delivered", say — should match the more
  // specific rule above rather than being caught here.
  ["live", "in_production"],

  ["created", "created"],
  ["new", "created"],
  ["pending", "created"],
  ["open", "created"],
];

/**
 * Maps Qikink's status text to a stage.
 *
 * `awb` is a second signal and deliberately weaker than the text: a tracking
 * number means the courier has the parcel, so an order still reading "created"
 * while carrying an AWB is really at least picked up. It only ever moves a
 * stage forward, never back — Qikink's own words win whenever they say more.
 */
export function normalizeStage(
  qikinkStatus: string | null | undefined,
  awb?: string | null
): QikinkStage {
  const text = (qikinkStatus ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  let stage: QikinkStage = text ? "unknown" : "created";

  for (const [test, mapped] of RULES) {
    if (text.includes(test)) {
      stage = mapped;
      break;
    }
  }

  if (awb && stageRank(stage) >= 0 && stageRank(stage) < stageRank("picked_up")) {
    return "picked_up";
  }

  return stage;
}

const LABELS: Record<QikinkStage, string> = {
  not_sent: "Not sent",
  created: "Created",
  on_hold: "On hold",
  in_production: "In production",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rto: "Returned (RTO)",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export function stageLabel(stage: QikinkStage): string {
  return LABELS[stage] ?? stage;
}

/**
 * How long a stage may sit unchanged before it is worth looking at.
 *
 * These are deliberately generous. The cost of a false alarm is an operator
 * checking an order that was fine; the cost of a missed one is a return. Hours,
 * so they read the same way the badge does.
 */
const STALE_AFTER_HOURS: Partial<Record<QikinkStage, number>> = {
  not_sent: 6,
  created: 48,
  // Deliberately tighter than the others. An order Qikink is holding is one
  // nobody is printing, and it stays that way until someone intervenes — so
  // this is the one stage where the timer is the entire point.
  on_hold: 24,
  in_production: 96,
  picked_up: 72,
  in_transit: 168,
  out_for_delivery: 48,
};

export type AlertLevel = "critical" | "warning" | null;

export interface Alert {
  level: Exclude<AlertLevel, null>;
  reason: string;
}

/**
 * Whether an order needs attention, and why.
 *
 * This is the reason the page exists: the merchant wants problems to find them
 * rather than the other way round. Anything that returns non-null here appears
 * under "Needs attention" regardless of which stage it is in.
 */
export function alertFor(input: {
  stage: QikinkStage;
  pushStatus: "queued" | "sent" | "failed" | null;
  error: string | null;
  /** When the stage was last observed to change. */
  stageSince: string | null;
  /** Fallback when the stage has never been observed to change. */
  createdAt: string;
  now?: Date;
}): Alert | null {
  const { stage, pushStatus, error, stageSince, createdAt } = input;
  const now = input.now ?? new Date();

  if (pushStatus === "failed") {
    return { level: "critical", reason: error?.trim() || "Push to Qikink failed." };
  }
  if (stage === "rto") {
    return { level: "critical", reason: "Returned to origin — this order did not reach the customer." };
  }
  if (stage === "cancelled") {
    return { level: "critical", reason: "Cancelled at Qikink." };
  }
  if (stage === "unknown") {
    return { level: "warning", reason: "Qikink reported a status we don't recognise yet." };
  }

  // Delivered is the end of the line; a delivered order is never late.
  if (stage === "delivered") return null;

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
      stage === "not_sent"
        ? `Placed ${age} ago and still not sent to Qikink.`
        : stage === "on_hold"
          // Named rather than described as "stuck": Qikink holds an order for a
          // reason — unpaid wallet, an unresolved design, a stock problem — and
          // it will not move until someone opens their dashboard and clears it.
          // "Stuck at On hold" would read as a delay to wait out; this does not.
          ? `On hold at Qikink for ${age} — production has not started. Check the order in Qikink.`
          : `Stuck at “${stageLabel(stage)}” for ${age}.`,
  };
}
