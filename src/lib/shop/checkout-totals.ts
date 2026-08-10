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

import {
  COD_FEE,
  isCodMethod,
  isPrepaidMethod,
  NO_PAYMENT_METHOD,
  prepaidSaving,
} from "./payment-methods";

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
  /** Money off for paying up front. Zero on a COD order. */
  prepaidDiscount: number;
  shipping: number;
  tax: number;
  /** The courier's collection charge. Zero on a prepaid order. */
  codFee: number;
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

/**
 * One entry in a signed-in shopper's address book.
 *
 * Carries its own `phone` and recipient name rather than borrowing the
 * customer's: parcels go to a flatmate, a parent, an office reception, and the
 * number the courier should ring is a property of the destination.
 */
export interface SavedAddress extends CheckoutAddress {
  id: string;
  /** Free text — "Home", "Work", "Mum's place". */
  label: string;
  phone: string;
  isDefault: boolean;
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
  /**
   * Saved addresses, default first. Always empty for a guest — the book is
   * only readable by the account that owns it.
   */
  addresses: SavedAddress[];
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
 *
 * How the payment method enters the sum matters, because the shopper is being
 * shown the difference and will check it:
 *
 *   - The prepaid saving comes off *after* any coupon and is taxable value the
 *     store is giving up, so tax is charged on what is left of the merchandise,
 *     not on what it was before.
 *   - The free-shipping threshold is tested before the prepaid saving, so
 *     choosing to pay online can never push an order back under the bar and
 *     hand the shopper a shipping charge for saving the store money.
 *   - The COD fee is a service charge on top of everything and is not taxed
 *     here, for the same jurisdiction reason shipping is not.
 *
 * Called with no method — which is how checkout starts, see
 * `NO_PAYMENT_METHOD` — this prices neither, and the total it returns is the
 * one the shopper owes before the payment section moves it in one direction or
 * the other. That figure is a real number they can check against their bag; it
 * is simply not the last word, which is what the summary says beside it.
 */
export function quoteTotals(
  subtotal: number,
  discount: number,
  settings: CheckoutSettings,
  freeShippingCode = false,
  paymentMethod: string = NO_PAYMENT_METHOD
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

  /* Both tested positively, never as each other's negation: until the shopper
     picks, neither applies and the total is the plain merchandise total. */
  const prepaidDiscount = isPrepaidMethod(paymentMethod)
    ? prepaidSaving(merchandise)
    : 0;
  const codFee = isCodMethod(paymentMethod) ? COD_FEE : 0;

  const taxable = Math.max(merchandise - prepaidDiscount, 0);
  const tax = Math.round(taxable * settings.taxRate * 100) / 100;

  return {
    subtotal,
    discount,
    prepaidDiscount,
    shipping,
    tax,
    codFee,
    total: taxable + shipping + tax + codFee,
    freeShipping: shipping === 0,
  };
}
