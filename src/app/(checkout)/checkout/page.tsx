import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/shop/cart";
import {
  getCheckoutPrefill,
  getCheckoutSettings,
  getOfferedPaymentMethods,
} from "@/lib/shop/checkout";
import { getCountries } from "@/lib/shop/countries";
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

  const [settings, prefill, paymentMethods] = await Promise.all([
    getCheckoutSettings(),
    getCheckoutPrefill(),
    getOfferedPaymentMethods(),
  ]);

  return (
    <CheckoutForm
      cart={cart}
      settings={settings}
      prefill={prefill}
      countries={getCountries()}
      // Passed rather than imported by the form, like `countries` beside it —
      // and as of the gateway, no longer a constant: `getOfferedPaymentMethods`
      // disables prepaid when Cashfree is not connected, so the form renders
      // what the store can collect through today rather than what it offers in
      // principle.
      paymentMethods={paymentMethods}
    />
  );
}
