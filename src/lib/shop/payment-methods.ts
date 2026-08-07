/**
 * The payment methods checkout offers, and which of them actually work.
 *
 * Isomorphic on purpose: the form renders from this list, the server action
 * validates against it, and `place_order()` keeps its own copy of the same
 * allowlist. Three places have to agree on two strings, and a typo in any of
 * them is an order that either cannot be placed or cannot be collected on.
 *
 * `available` is the honest half of this file. A method listed here is a
 * promise the store makes at the moment someone clicks it, so a method whose
 * plumbing does not exist yet is rendered and disabled rather than quietly
 * omitted — a shopper who cannot see UPI at all assumes the store will never
 * have it, and one who sees it greyed out knows to come back. It also means
 * turning UPI on is this one boolean rather than a hunt through the form.
 */

export const PAYMENT_METHODS = [
  {
    value: "cod",
    label: "Cash on delivery",
    description: "Pay the courier when your order arrives.",
    available: true,
    unavailableReason: null,
  },
  {
    value: "upi",
    label: "UPI",
    description: "Pay instantly with any UPI app — GPay, PhonePe, Paytm.",
    available: false,
    unavailableReason: "Coming soon",
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

/** Preselected in the form. The first thing that works, not a hardcoded value. */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod =
  (AVAILABLE[0] as PaymentMethod | undefined) ?? "cod";

/**
 * The server-side gate.
 *
 * A disabled radio is a hint to a browser, not a constraint on a request — the
 * form posts to a Server Action, and everything a Server Action receives is
 * untrusted. This is what actually stops an order being placed against a method
 * the store cannot collect through.
 */
export function isPayableMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && AVAILABLE.includes(value);
}

/**
 * A method's display name, for the admin.
 *
 * Three kinds of value reach this. Ours ('cod', 'upi') get the label the
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

  const trimmed = value.trim();
  return trimmed && trimmed !== "manual" ? trimmed : null;
}
