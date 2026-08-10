import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/shop/cart";
import { getCheckoutPrefill, getCheckoutSettings } from "@/lib/shop/checkout";
import { getCountries } from "@/lib/shop/countries";
import { PAYMENT_METHODS } from "@/lib/shop/payment-methods";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  // A checkout page in an index is a checkout page being crawled with somebody
  // else's cart cookie, and it has nothing to rank for either way.
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * Everything the form needs is resolved here, on the server, in one pass: the
 * cart (already re-priced against today's catalogue by `getCart`), the shop's
 * shipping and tax configuration, and whatever the store already knows about
 * this shopper. The client component below is handed finished values rather
 * than fetching its own — a checkout that renders empty and then fills in is a
 * checkout that flashes the wrong total.
 */
export default async function CheckoutPage() {
  const cart = await getCart();

  // Nothing to buy. Bouncing to the bag is friendlier than an empty checkout,
  // and it is also the page that explains itself.
  if (cart.lines.length === 0) redirect("/cart");

  // Sold-out lines have to be resolved in the bag, where they can be removed.
  // The cart page gates its own button on exactly this, so arriving here with
  // one means a stale tab or a hand-typed URL.
  if (cart.lines.some((line) => !line.available)) redirect("/cart");

  const [settings, prefill] = await Promise.all([
    getCheckoutSettings(),
    getCheckoutPrefill(),
  ]);

  return (
    <CheckoutForm
      cart={cart}
      settings={settings}
      prefill={prefill}
      countries={getCountries()}
      // Passed rather than imported by the form, like `countries` beside it.
      // Which methods a store offers is a property of the store, and the day it
      // comes from the database instead of a constant, this line is the only
      // thing that changes.
      paymentMethods={[...PAYMENT_METHODS]}
    />
  );
}
