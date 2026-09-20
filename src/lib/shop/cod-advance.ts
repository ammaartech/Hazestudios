import type { Order, PaymentRequest } from "@/lib/types";

/**
 * Partial COD, the pure half.
 *
 * Everything here is arithmetic and string-building over values the caller
 * already holds, so it is safe to import from a Client Component (the request
 * dialog previews the WhatsApp message as the amount is typed) as well as from
 * Server Actions and the storefront. The database reads live in `./cod.ts`,
 * which pulls in the server client and must stay out of the browser bundle —
 * the same split as `checkout-totals.ts` / `checkout.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/** `shop_settings.cod`, with every field present. */
export interface CodSettings {
  /** Park COD orders for review instead of auto-sending them to Qikink. */
  holdEnabled: boolean;
  /** …but only those at or above this total. Null means every COD order. */
  holdMinTotal: number | null;
  /** Quick-pick advance amounts on the request dialog, in rupees. */
  presets: number[];
  /** The "% of order total" quick pick. */
  percent: number;
  /** How long a request stays payable, by default. */
  expiryHours: number;
  /** Share template. See `advanceShareMessage` for the placeholders. */
  message: string;
}

export const DEFAULT_ADVANCE_MESSAGE =
  "Hi {name}, thanks for your order #{order} with Haze Studios. " +
  "To confirm this Cash on Delivery order we need a small advance of {amount} — " +
  "the remaining {balance} is payable to the courier on delivery.\n\n" +
  "Pay securely here: {link}\n\n" +
  "The link is valid until {expires}. Reply to this message if you have any questions.";

export const DEFAULT_COD_SETTINGS: CodSettings = {
  holdEnabled: false,
  holdMinTotal: null,
  presets: [99, 199, 299],
  percent: 20,
  expiryHours: 48,
  message: DEFAULT_ADVANCE_MESSAGE,
};

/** Bounds on the settings form and the action behind it. */
export const EXPIRY_HOURS_MIN = 1;
export const EXPIRY_HOURS_MAX = 24 * 14;

/**
 * Parses the stored jsonb into a full `CodSettings`, tolerating any shape: the
 * column defaults to `{}`, and an operator who saved a half-filled form should
 * get defaults for the rest rather than NaN in a price.
 */
export function parseCodSettings(raw: unknown): CodSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) && value !== null && value !== ""
      ? Number(value)
      : fallback;

  const presets = Array.isArray(source.presets)
    ? source.presets
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
        .slice(0, 6)
    : DEFAULT_COD_SETTINGS.presets;

  return {
    holdEnabled: source.hold_enabled === true,
    holdMinTotal:
      source.hold_min_total == null || source.hold_min_total === ""
        ? null
        : Math.max(0, number(source.hold_min_total, 0)),
    presets: presets.length ? presets : DEFAULT_COD_SETTINGS.presets,
    percent: clamp(number(source.percent, DEFAULT_COD_SETTINGS.percent), 1, 99),
    expiryHours: clamp(
      number(source.expiry_hours, DEFAULT_COD_SETTINGS.expiryHours),
      EXPIRY_HOURS_MIN,
      EXPIRY_HOURS_MAX
    ),
    message:
      typeof source.message === "string" && source.message.trim()
        ? source.message
        : DEFAULT_ADVANCE_MESSAGE,
  };
}

/** The inverse of `parseCodSettings`: what gets written to the jsonb column. */
export function serializeCodSettings(settings: CodSettings): Record<string, unknown> {
  return {
    hold_enabled: settings.holdEnabled,
    hold_min_total: settings.holdMinTotal,
    presets: settings.presets,
    percent: settings.percent,
    expiry_hours: settings.expiryHours,
    message: settings.message,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* The hold rule                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether a freshly placed COD order should wait for a human before it goes to
 * the printer. Total only, for now: the rule the operator asked for. Pincode,
 * first-order and past-RTO signals all belong here when they arrive.
 */
export function shouldHoldCod(settings: CodSettings, total: number): boolean {
  if (!settings.holdEnabled) return false;
  if (settings.holdMinTotal == null) return true;
  return Number(total) >= settings.holdMinTotal;
}

/** On hold: parked for review and nobody has released it yet. */
export function isOnHold(
  order: Pick<Order, "held_at" | "released_at">
): boolean {
  return Boolean(order.held_at) && !order.released_at;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a request currently *is*, as opposed to what its row says. An open
 * request past its deadline reads as expired without anyone having written
 * that — the deadline is a fact about time, and time does not need a cron.
 */
export type RequestState = "open" | "expired" | "paid" | "cancelled";

export function requestState(
  request: Pick<PaymentRequest, "status" | "expires_at">,
  now: Date = new Date()
): RequestState {
  if (request.status === "open" && new Date(request.expires_at) <= now) {
    return "expired";
  }
  return request.status;
}

/** The request the shopper can act on right now, if there is one. */
export function findOpenRequest<T extends Pick<PaymentRequest, "status" | "expires_at">>(
  requests: T[],
  now: Date = new Date()
): T | null {
  return requests.find((r) => requestState(r, now) === "open") ?? null;
}

/** What the courier will ask for at the door. Never negative. */
export function balanceDue(
  order: Pick<Order, "total" | "amount_paid">
): number {
  return Math.max(0, Number(order.total) - Number(order.amount_paid ?? 0));
}

/**
 * Rounds a percentage of the total to a whole rupee, which is what every
 * quick-pick produces: a shopper reading "pay ₹212.40 now" trusts it less than
 * "pay ₹212 now", and the gateway does not care either way.
 */
export function percentOf(total: number, percent: number): number {
  return Math.max(1, Math.round((Number(total) * percent) / 100));
}

/**
 * Validates an amount staff typed for an advance. Strictly less than the total
 * — an advance equal to the whole order is a prepaid order wearing a disguise,
 * and the checkout already has a button for that.
 */
export function validateAdvanceAmount(
  amount: number,
  total: number
): string | null {
  if (!Number.isFinite(amount)) return "Enter an amount.";
  if (amount < 1) return "The advance must be at least ₹1.";
  if (amount >= Number(total)) {
    return "The advance must be less than the order total.";
  }
  if (Math.round(amount * 100) !== amount * 100) {
    return "Use at most two decimal places.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Sharing                                                                     */
/* -------------------------------------------------------------------------- */

export interface ShareFields {
  name: string;
  orderNumber: number | string;
  amount: string;
  balance: string;
  link: string;
  expires: string;
}

/**
 * Fills the operator's template. Every placeholder is optional in the
 * template; an unknown one is left as typed so a typo is visible in the
 * preview rather than silently swallowed.
 */
export function advanceShareMessage(
  template: string,
  fields: ShareFields
): string {
  const map: Record<string, string> = {
    name: fields.name || "there",
    order: String(fields.orderNumber),
    amount: fields.amount,
    balance: fields.balance,
    link: fields.link,
    expires: fields.expires,
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in map ? map[key] : match
  );
}

/**
 * A `wa.me` deep link that opens the shopper's chat with the message typed in.
 * `phone` is stored with its dialling code; WhatsApp wants exactly that, as
 * digits. Null when there is no usable number, so the button can hide rather
 * than open a chat with nobody.
 */
export function whatsappHref(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
