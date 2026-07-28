/**
 * Checkout money and the shapes around it.
 *
 * Split from `checkout.ts` because the summary has to price a discount as the
 * shopper types it, and that makes this code client-side. `checkout.ts` reaches
 * for `next/headers` through the Supabase server client, so a single module
 * holding both would drag the server client into the browser bundle — the
 * import graph does not care that the client only wanted one pure function.
 *
 * Nothing in here touches the network or the request. That is the rule that
 * keeps it importable from both sides.
 *
 * The authority on what an order actually costs is `place_order()` in
 * 0014_checkout.sql. This is the preview of that arithmetic — and because the
 * function re-checks inside the transaction, a preview that drifts can only be
 * corrected downward. It cannot overcharge. When shipping zones replace
 * `shop_settings.checkout`, `quoteTotals()` and the money section of
 * `place_order()` have to move together.
 */

export interface CheckoutSettings {
  /** Flat shipping charge, before any threshold or free-shipping code. */
  flatRate: number;
  /** Order value at or above which shipping is free, or null when there is none. */
  freeThreshold: number | null;
  /** Fraction, not percent — 0.2 is 20%. */
  taxRate: number;
  currency: string;
}

export interface CheckoutTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  /** True when shipping came out at zero, so the summary can say "Free". */
  freeShipping: boolean;
}

export interface CheckoutAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
}

/** What we can fill in for a shopper we already know. */
export interface CheckoutPrefill {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  address: Partial<CheckoutAddress>;
  /** Drives "signed in as…" vs. the guest sign-in prompt. */
  signedIn: boolean;
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  flatRate: 0,
  freeThreshold: null,
  taxRate: 0,
  currency: "INR",
};

/**
 * The same arithmetic as the money section of `place_order()`.
 *
 * Tax is charged on the discounted merchandise total and not on shipping, for
 * the reason given in the migration: whether shipping is taxable is a
 * jurisdiction question, and this stand-in should not pretend to answer it.
 */
export function quoteTotals(
  subtotal: number,
  discount: number,
  settings: CheckoutSettings,
  freeShippingCode = false
): CheckoutTotals {
  const merchandise = Math.max(subtotal - discount, 0);

  let shipping = freeShippingCode ? 0 : settings.flatRate;
  if (
    !freeShippingCode &&
    settings.freeThreshold != null &&
    merchandise >= settings.freeThreshold
  ) {
    shipping = 0;
  }

  const tax = Math.round(merchandise * settings.taxRate * 100) / 100;

  return {
    subtotal,
    discount,
    shipping,
    tax,
    total: merchandise + shipping + tax,
    freeShipping: shipping === 0,
  };
}
