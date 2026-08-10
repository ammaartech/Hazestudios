/**
 * The payment methods checkout offers, what they cost, and which of them
 * actually work.
 *
 * Isomorphic on purpose: the form renders from this list, the server action
 * validates against it, `quoteTotals()` prices from it, and `place_order()`
 * keeps its own copy of the same allowlist and the same two numbers. Four
 * places have to agree, and a typo in any of them is either an order that
 * cannot be placed or a total that disagrees with the one the shopper was shown.
 *
 * The gateway makes a fifth reader, and the one with the most at stake: what
 * Cashfree is asked to charge is `orders.total` read back from the database
 * after `place_order()` has arbitrated between the copies. So a drift here can
 * still show a shopper the wrong number — it can no longer charge them one.
 *
 * `available` is the honest half of this file. A method listed here is a
 * promise the store makes at the moment someone clicks it, so a method whose
 * plumbing does not exist yet is rendered and disabled rather than quietly
 * omitted — a shopper who cannot see a method at all assumes the store will
 * never have it, and one who sees it greyed out knows to come back.
 *
 * The flag below is the static half of that answer: whether the store offers a
 * method at all. Whether it can collect through it *today* depends on a
 * gateway being connected, which is a database read — see
 * `getOfferedPaymentMethods()` in `./checkout`, which folds that in before the
 * form ever sees this list.
 */

/**
 * What the courier's collection costs the shopper.
 *
 * COD is not free to run: it is a handling fee to the logistics partner plus a
 * materially worse return rate, and until now the store absorbed both. Charging
 * it is also the lever that makes prepaid the obvious choice, which is the point
 * — the two numbers in this file are a nudge, not just cost recovery.
 *
 * Duplicated in the money section of place_order() (0022). Changing one without
 * the other means the summary quotes a total the transaction will not honour.
 */
export const COD_FEE = 49;

/** Fraction, not percent — 0.05 is 5%. Same duplication note as `COD_FEE`. */
export const PREPAID_DISCOUNT_RATE = 0.05;

/**
 * The prepaid saving on a given merchandise total.
 *
 * Taken off the discounted merchandise total rather than the raw subtotal, so
 * it never compounds with a coupon into more than the goods are worth — and it
 * is deliberately not applied to shipping or to the COD fee, neither of which
 * is the store's margin to give away.
 *
 * Transcribed into place_order(); the rounding has to match to the paisa.
 */
export function prepaidSaving(merchandise: number): number {
  return Math.round(Math.max(merchandise, 0) * PREPAID_DISCOUNT_RATE * 100) / 100;
}

export const PAYMENT_METHODS = [
  {
    value: "prepaid",
    label: "Pay online",
    description: "UPI, cards, net banking or wallets.",
    available: true,
    unavailableReason: null,
  },
  {
    value: "cod",
    label: "Cash on delivery",
    description: "Pay the courier when your order arrives.",
    available: true,
    unavailableReason: null,
  },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/**
 * One row of the list, widened out of the `as const` literal.
 *
 * The constant is frozen so `PaymentMethod` can be a union of its two strings;
 * this is the shape the form takes as a prop, where that narrowness would only
 * make the component harder to reuse.
 */
export interface PaymentMethodOption {
  value: string;
  label: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
}

/**
 * What a shopper is allowed to submit.
 *
 * Derived rather than written out, so an option cannot be switched on in the
 * list above and stay rejected by the guard below.
 */
const AVAILABLE: readonly string[] = PAYMENT_METHODS.filter(
  (method) => method.available
).map((method) => method.value);

/**
 * Nothing is preselected, and that is the point.
 *
 * A default is a decision made on the shopper's behalf, and whichever one this
 * store picked would be the one most orders arrived as — a preselected COD is
 * a COD business, because the payment section is the part of checkout people
 * scroll past. Neither is worth defaulting to on its own terms either: COD is
 * the expensive option, and prepaid opens a payment window the moment the
 * order is placed — not something to spring on somebody who never chose it.
 *
 * So the form starts empty and both options state their price. The cost is one
 * more required field; what it buys is that every order carries a payment
 * method somebody actually chose.
 */
export const NO_PAYMENT_METHOD = "";

/**
 * The server-side gate.
 *
 * A disabled radio is a hint to a browser, not a constraint on a request — the
 * form posts to a Server Action, and everything a Server Action receives is
 * untrusted. This is what actually stops an order being placed against a method
 * the store cannot collect through.
 *
 * Half of the gate. `placeOrder` pairs it with a check that the gateway behind
 * a prepaid choice is switched on, which this cannot know without a query.
 */
export function isPayableMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && AVAILABLE.includes(value);
}

/**
 * Does this method mean the money arrives before the parcel does?
 *
 * The question the money code asks, kept here rather than as a `=== "prepaid"`
 * scattered across four files — 'upi' is a legacy value from before this list
 * was consolidated, and it is prepaid by any reading.
 */
export function isPrepaidMethod(value: string): boolean {
  return value === "prepaid" || value === "upi";
}

/**
 * Does the courier have to collect for this one?
 *
 * The inverse of `isPrepaidMethod` for every method the store offers, and
 * deliberately not written as one: with nothing preselected, "not prepaid" is
 * also true of the empty string, and charging a shopper 49 for a choice they
 * have not made yet is exactly the bug this spells out to avoid.
 */
export function isCodMethod(value: string): boolean {
  return value === "cod";
}

/**
 * A method's display name, for the admin.
 *
 * Three kinds of value reach this. Ours ('cod', 'prepaid') get the label the
 * shopper saw. The Shopify import carries Shopify's own descriptions verbatim —
 * "Cash on Delivery (COD)", "01 Cards, UPI, NB, Wallets by Razorpay" — and
 * those are shown as-is, because a string written by the gateway that actually
 * took the money is better evidence than anything this file could map it onto.
 *
 * Null only for 'manual', the placeholder every storefront order carried before
 * checkout offered a choice. It records no decision, so a badge saying so is
 * noise on 63 orders.
 */
export function paymentMethodLabel(value: string): string | null {
  const known = PAYMENT_METHODS.find((method) => method.value === value);
  if (known) return known.label;

  // Predates the rename, and no longer in the list above.
  if (value === "upi") return "UPI";

  const trimmed = value.trim();
  return trimmed && trimmed !== "manual" ? trimmed : null;
}
