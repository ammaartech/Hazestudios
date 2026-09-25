import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { getOrderByToken } from "@/lib/shop/checkout";
import { countryName } from "@/lib/shop/countries";
import { getPaymentAttempts } from "@/lib/cashfree/payment";
import { getPaymentRequests } from "@/lib/cashfree/advance";
import { isCodMethod, isPrepaidMethod } from "@/lib/shop/payment-methods";
import {
  balanceDue,
  findOpenRequest,
  requestState,
} from "@/lib/shop/cod-advance";
import type { CheckoutAddress } from "@/lib/shop/checkout-totals";
import type { PaymentRequest } from "@/lib/types";
import { PayNow } from "./pay-now";
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
  const closed = Boolean(order.cancelled_at) || order.payment_status === "voided";
  const paymentReview = order.hold_reason === "payment_review" && !order.released_at;
  const stopped = closed || paymentReview;

  /* Money owed on an order the shopper chose to pay for up front. The only
     state in which this page has anything left to ask of them, and the reason
     it is computed here rather than inside the block below: the heading copy
     and the delivery estimate both change when an order is not yet paid. */
  const awaitingPayment =
    !stopped && isPrepaidMethod(order.payment_method) && order.payment_status === "pending";

  /* The other thing this page can ask for: an advance on a cash-on-delivery
     order (0033). Only while the order is still pending — once the advance is
     in, `amount_paid` and the "pay on delivery" line below tell the rest. A
     request past its deadline is shown as lapsed rather than payable; the
     store decides what happens next, not the clock. */
  const isCod = isCodMethod(order.payment_method);
  const requests: PaymentRequest[] =
    !stopped && isCod && order.payment_status === "pending"
      ? await getPaymentRequests(order.id)
      : [];
  const advance = findOpenRequest(requests);
  const lapsedAdvance =
    !advance && requests.length > 0 && requestState(requests[0]) === "expired";
  const awaitingAdvance = Boolean(advance);
  const awaiting = awaitingPayment || awaitingAdvance;

  /* Whether to open the payment window without waiting for a click.
     "No attempt has ever been made on this order" is only true on the first
     render after checkout redirected here, and the attempt the auto-open
     creates is what makes it false — so a reload cannot replay it. Preferred
     over a `?pay=1` marker for exactly that reason: a query parameter survives
     a refresh and a bookmark, and this must not. */
  const autoStartPayment =
    awaitingPayment && (await getPaymentAttempts(order.id)).length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-20">
      {/* Held back while a prepaid order is unpaid. A purchase event is a claim
          that money changed hands, and counting one the moment a shopper opens
          a payment window would inflate every conversion figure by the people
          who closed it. The beacon dedupes on the order id, so it still fires
          exactly once — on whichever visit finds the order paid. */}
      {!stopped && !awaitingPayment && (
        <PurchaseBeacon orderId={order.id} total={Number(order.total)} />
      )}

      <header className="flex flex-col items-start gap-5">
        {/* A tick means finished, and an unpaid order is not. The clock is the
            same size and weight in the same circle, so the page does not
            restructure itself between the two states — only its claim
            changes. */}
        <span
          className={
            awaiting || stopped
              ? "flex size-11 items-center justify-center rounded-full bg-(--shop-ink)/8 text-(--shop-charcoal)"
              : "flex size-11 items-center justify-center rounded-full bg-(--shop-success)/10 text-(--shop-success)"
          }
          aria-hidden
        >
          {awaiting || stopped ? (
            <Clock className="size-5" strokeWidth={2.5} />
          ) : (
            <Check className="size-5" strokeWidth={2.5} />
          )}
        </span>

        <div>
          <p className="meta text-(--shop-mute)">
            Order #{order.order_number} · {formatDate(order.created_at)}
          </p>
          <h1 className="display mt-2 text-3xl tracking-[-0.03em] md:text-4xl">
            {paymentReview
              ? "Your payment needs a review."
              : closed
                ? "This order is closed."
              : awaitingPayment
              ? "One step left."
              : awaitingAdvance
                ? "One step to confirm."
                : `Thank you${
                  order.shipping_address?.first_name
                    ? `, ${(address.first_name ?? "").trim()}`
                    : ""
                }.`}
          </h1>
          <p className="mt-3 max-w-prose text-(--shop-mute)">
            {paymentReview ? (
              "We received a payment for an order that needs our attention. Please contact us before placing another order."
            ) : closed ? (
              "This order has been cancelled or its payment window has expired. It will not be dispatched. Please contact us if you need help with a payment."
            ) : (
              <>
                Your order is {awaiting ? "reserved" : "confirmed and reserved"},
                under <span className="text-(--shop-ink)">{order.email}</span>.{" "}
                {paymentNote(order, { advance, lapsedAdvance })}
              </>
            )}
          </p>
        </div>
      </header>

      {/* Directly under the header, above the items: the one thing this page
          still needs from the shopper goes before the things it is merely
          telling them. */}
      {awaitingPayment && (
        <PayNow token={token} autoStart={autoStartPayment} />
      )}
      {advance && (
        <PayNow
          token={token}
          autoStart={false}
          advance={{
            requestId: advance.id,
            amount: formatMoney(advance.amount, order.currency),
            balance: formatMoney(
              Math.max(0, Number(order.total) - Number(advance.amount)),
              order.currency
            ),
            expires: formatDate(advance.expires_at),
            reason: advance.reason,
          }}
        />
      )}

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
          {/* Both added in 0022, and both zero on every order placed before it —
              so an old order renders exactly as it always did. */}
          {Number(order.prepaid_discount) > 0 && (
            <Row
              label="Prepaid discount (5%)"
              value={`−${formatMoney(order.prepaid_discount, order.currency)}`}
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
          {Number(order.cod_fee) > 0 && (
            <Row
              label="Cash on delivery fee"
              value={formatMoney(order.cod_fee, order.currency)}
            />
          )}
        </dl>

        <div className="mt-5 flex items-baseline justify-between border-t border-(--shop-ink)/10 pt-5">
          <span className="font-medium">Total</span>
          <span className="display text-2xl tracking-[-0.02em] tabular-nums">
            {formatMoney(order.total, order.currency)}
          </span>
        </div>

        {/* Money already taken online against a COD order, and what that
            leaves for the door. Only rendered once something has been paid,
            so every order placed before 0033 reads exactly as it did. */}
        {!stopped && Number(order.amount_paid) > 0 && (
          <dl className="mt-4 flex flex-col gap-3 border-t border-(--shop-ink)/10 pt-4 text-sm">
            <Row
              label="Advance paid"
              value={`−${formatMoney(order.amount_paid, order.currency)}`}
            />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-medium">
                {isCod ? "Pay on delivery" : "Balance due"}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(balanceDue(order), order.currency)}
              </dd>
            </div>
          </dl>
        )}
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
 * of purchase. It once promised an emailed payment link that no code in this
 * repo has ever sent; the prepaid branch below is what finally makes that
 * promise into something the store actually does.
 *
 * `payment_status` is checked before the method because an order paid by any
 * route is finished, and the operator can still mark one paid by hand.
 */
function paymentNote(
  order: {
    payment_method: string;
    payment_status: string;
    total: number;
    amount_paid: number;
    currency: string;
  },
  cod: { advance: PaymentRequest | null; lapsedAdvance: boolean }
): string {
  const { payment_method: method, payment_status: status } = order;

  if (status === "paid") return "It's paid in full — nothing more to do.";
  if (status === "refunded") return "This order has been refunded.";

  if (method === "cod") {
    // The advance states, most specific first. A COD order with money against
    // it is the partial-COD case; one with a live request is being asked; one
    // whose request lapsed is told so plainly rather than left wondering why
    // the button went away.
    if (Number(order.amount_paid) > 0) {
      return `Your ${formatMoney(order.amount_paid, order.currency)} advance is in. Pay the remaining ${formatMoney(balanceDue(order), order.currency)} to the courier when it arrives.`;
    }
    if (cod.advance) {
      return "To confirm this cash-on-delivery order we're asking for a small advance below — the rest is paid to the courier when it arrives.";
    }
    if (cod.lapsedAdvance) {
      return "The advance request on this order has lapsed. Get in touch and we'll send you a fresh one.";
    }
    return "Pay the courier when it arrives — nothing has been charged now.";
  }
  // 'upi' is the legacy spelling of the same choice; both mean the shopper
  // opted to pay up front and has not yet. The block above this one is where
  // they actually do it, so the sentence only has to point at it.
  if (isPrepaidMethod(method)) {
    return "We're awaiting payment confirmation. If you've already paid, we'll update your order once it's confirmed.";
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
