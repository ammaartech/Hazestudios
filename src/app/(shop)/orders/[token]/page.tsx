import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { getOrderByToken } from "@/lib/shop/checkout";
import { countryName } from "@/lib/shop/countries";
import type { CheckoutAddress } from "@/lib/shop/checkout-totals";
import { PurchaseBeacon } from "./purchase-beacon";

export const metadata: Metadata = {
  title: "Order confirmed",
  // Reachable by anyone holding the token, which is the point — and exactly why
  // it must never be crawled into an index.
  robots: { index: false, follow: false },
};

/**
 * Order confirmation, and the order status page.
 *
 * The same route serves both: the shopper lands here the moment the order is
 * placed, and the link keeps working afterwards. That is deliberate — a guest
 * with no account otherwise has no way back to their own order, and "where is
 * my order" with no answer is the single most expensive support email a small
 * store gets.
 *
 * Under the full storefront shell rather than the checkout one: the flow is
 * finished, and the next useful thing is the rest of the shop.
 */
export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByToken(token);

  // A wrong token is indistinguishable from a missing order, on purpose: any
  // other response would confirm which tokens exist.
  if (!order) notFound();

  const address = order.shipping_address as Partial<CheckoutAddress>;
  const hasAddress = Boolean(address?.address1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-20">
      <PurchaseBeacon orderId={order.id} total={Number(order.total)} />

      <header className="flex flex-col items-start gap-5">
        <span
          className="flex size-11 items-center justify-center rounded-full bg-(--shop-success)/10 text-(--shop-success)"
          aria-hidden
        >
          <Check className="size-5" strokeWidth={2.5} />
        </span>

        <div>
          <p className="meta text-(--shop-mute)">
            Order #{order.order_number} · {formatDate(order.created_at)}
          </p>
          <h1 className="display mt-2 text-3xl tracking-[-0.03em] md:text-4xl">
            Thank you{order.shipping_address?.first_name
              ? `, ${(address.first_name ?? "").trim()}`
              : ""}
            .
          </h1>
          <p className="mt-3 max-w-prose text-(--shop-mute)">
            Your order is confirmed and reserved, under{" "}
            <span className="text-(--shop-ink)">{order.email}</span>.{" "}
            {paymentNote(order.payment_method, order.payment_status)}
          </p>
        </div>
      </header>

      {/* ---- Items ---- */}
      <section className="mt-12">
        <h2 className="meta text-(--shop-mute)">Order</h2>
        <ul className="mt-4 divide-y divide-(--shop-ink)/8 border-y border-(--shop-ink)/8">
          {order.items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-4 py-4">
              <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden bg-(--shop-cloud)">
                {order.images[index] ? (
                  <Image
                    src={order.images[index]}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                ) : (
                  <span className="meta absolute inset-0 flex items-center justify-center text-(--shop-stone)">
                    —
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {/* The snapshot, not a live lookup: this is what was bought, at
                    the price it was bought for, whatever the catalogue says now. */}
                <p className="text-sm">{item.title_snapshot}</p>
                {item.variant_snapshot && (
                  <p className="mt-0.5 text-xs text-(--shop-mute)">
                    {item.variant_snapshot}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-(--shop-mute)">
                  Qty {item.quantity}
                </p>
              </div>

              <p className="shrink-0 text-sm tabular-nums">
                {formatMoney(
                  Number(item.price_snapshot) * item.quantity,
                  order.currency
                )}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-6 flex flex-col gap-3 text-sm">
          <Row label="Subtotal" value={formatMoney(order.subtotal, order.currency)} />
          {Number(order.discount_total) > 0 && (
            <Row
              label={
                order.discount_code ? `Discount · ${order.discount_code}` : "Discount"
              }
              value={`−${formatMoney(order.discount_total, order.currency)}`}
            />
          )}
          <Row
            label="Shipping"
            value={
              Number(order.shipping_total) === 0
                ? "Free"
                : formatMoney(order.shipping_total, order.currency)
            }
          />
          {Number(order.tax_total) > 0 && (
            <Row label="Tax" value={formatMoney(order.tax_total, order.currency)} />
          )}
        </dl>

        <div className="mt-5 flex items-baseline justify-between border-t border-(--shop-ink)/10 pt-5">
          <span className="font-medium">Total</span>
          <span className="display text-2xl tracking-[-0.02em] tabular-nums">
            {formatMoney(order.total, order.currency)}
          </span>
        </div>
      </section>

      {/* ---- Delivery ---- */}
      {hasAddress && (
        <section className="mt-12">
          <h2 className="meta text-(--shop-mute)">Delivery</h2>
          <address className="mt-4 text-sm not-italic leading-relaxed text-(--shop-charcoal)">
            {[address.first_name, address.last_name].filter(Boolean).join(" ")}
            <br />
            {address.address1}
            {address.address2 && (
              <>
                <br />
                {address.address2}
              </>
            )}
            <br />
            {[address.city, address.province, address.postal_code]
              .filter(Boolean)
              .join(", ")}
            <br />
            {countryName(address.country ?? "")}
          </address>
        </section>
      )}

      {/* ---- Next ---- */}
      <div className="mt-12 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="glass glass-pill glass-press glass-primary flex min-h-14 flex-1 cursor-pointer items-center justify-center px-8 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
        >
          Keep shopping
        </Link>
        <Link
          href="/account/orders"
          className="glass glass-on-light glass-quiet glass-pill glass-press flex min-h-14 flex-1 cursor-pointer items-center justify-center px-8 text-base font-medium text-(--shop-ink) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--shop-ink)"
        >
          View your orders
        </Link>
      </div>

      <p className="mt-6 text-center text-xs text-(--shop-stone)">
        Keep this page bookmarked to check your order status at any time.
      </p>
    </div>
  );
}

/**
 * What happens next about the money.
 *
 * This page is the status page as well as the confirmation, so it is read again
 * weeks later — the sentence has to stay true, not just be true at the moment
 * of purchase. It previously promised an emailed payment link, which no code in
 * this repo has ever sent.
 *
 * `payment_status` is checked before the method because an order paid by any
 * route is finished, and the operator can mark one paid by hand.
 */
function paymentNote(method: string, status: string): string {
  if (status === "paid") return "It's paid in full — nothing more to do.";
  if (status === "refunded") return "This order has been refunded.";

  if (method === "cod") {
    return "Pay the courier when it arrives — nothing has been charged now.";
  }
  if (method === "upi") {
    return "We'll be in touch with payment details shortly. Nothing has been charged yet.";
  }
  // 'manual', and anything imported. Deliberately vague: the store knows how
  // these were arranged and this page does not.
  return "Nothing has been charged yet.";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-(--shop-mute)">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
