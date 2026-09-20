import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, LifeBuoy } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { getAccountOrder, requireAccount } from "@/lib/shop/account";
import { getPaymentRequests } from "@/lib/cashfree/advance";
import { isCodMethod } from "@/lib/shop/payment-methods";
import { balanceDue, findOpenRequest } from "@/lib/shop/cod-advance";
import { createClient } from "@/lib/supabase/server";
import { AccountShell } from "../../account-shell";
import { StatusPill } from "../../order-parts";
import type { Fulfillment } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAccount(`/account/orders/${id}`);
  if (!session.customer) notFound();

  const order = await getAccountOrder(session.customer.id, id);
  // RLS already limits the query to this shopper's orders, so a miss is a 404
  // rather than a 403 — we do not confirm that someone else's order exists.
  if (!order) notFound();

  // Shipments, for tracking numbers.
  const supabase = await createClient();
  const { data: fulfillmentData } = await supabase
    .from("fulfillments")
    .select("*")
    .eq("order_id", order.id)
    .order("created_at");
  const fulfillments = (fulfillmentData ?? []) as Fulfillment[];

  // An advance the store has asked for on a COD order (0033). The payment
  // itself happens on the token page — it holds the Cashfree window and the
  // reconcile — so this page only has to point there.
  const isCod = isCodMethod(order.payment_method);
  const advance =
    isCod && order.payment_status === "pending" && order.checkout_token
      ? findOpenRequest(await getPaymentRequests(order.id))
      : null;
  const amountPaid = Number(order.amount_paid ?? 0);

  const itemTotal = order.items.reduce(
    (sum, i) => sum + Number(i.price_snapshot) * i.quantity,
    0
  );

  return (
    <AccountShell
      title={`Order #${order.order_number}`}
      current="/account/orders"
    >
      <Link
        href="/account/orders"
        className="meta -mt-4 mb-6 inline-flex items-center gap-1.5 text-(--shop-mute) transition-colors duration-300 hover:text-(--shop-ink)"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All orders
      </Link>

      <div className="space-y-6">
        <div className="glass glass-on-light glass-panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm text-(--shop-mute)">
              Placed {formatDate(order.created_at)}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-(--shop-ink)">
              {formatMoney(order.total, order.currency)}
            </p>
          </div>
          <StatusPill order={order} />
        </div>

        {advance && order.checkout_token && (
          <Link
            href={`/orders/${order.checkout_token}`}
            className="glass glass-panel glass-press glass-primary flex items-center justify-between gap-3 p-5 text-[15px] font-medium"
          >
            <span>
              Pay the {formatMoney(advance.amount, order.currency)} advance to confirm this order
              <span className="mt-0.5 block text-sm font-normal opacity-80">
                The remaining {formatMoney(Math.max(0, Number(order.total) - Number(advance.amount)), order.currency)} is paid to the courier · valid until {formatDate(advance.expires_at)}
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0" aria-hidden />
          </Link>
        )}

        {fulfillments.length > 0 && (
          <section className="glass glass-on-light glass-panel p-5">
            <h2 className="meta mb-3 text-(--shop-mute)">Shipments</h2>
            <ul className="space-y-3">
              {fulfillments.map((f) => (
                <li key={f.id} className="text-sm">
                  <span className="font-medium text-(--shop-ink)">
                    {f.carrier || "Shipment"}
                  </span>
                  {f.tracking_number && (
                    <span className="ml-2 font-mono text-(--shop-charcoal)">
                      {f.tracking_number}
                    </span>
                  )}
                  <span className="ml-2 text-(--shop-mute)">
                    · {f.status || "in transit"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="glass glass-on-light glass-panel overflow-hidden">
          <h2 className="meta border-b border-(--shop-hairline-soft) px-5 py-4 text-(--shop-mute)">
            Items
          </h2>
          <ul className="divide-y divide-(--shop-hairline-soft)">
            {order.items.map((item, i) => (
              <li key={item.id} className="flex items-start gap-4 p-5">
                <div className="relative size-16 shrink-0 overflow-hidden bg-(--shop-cloud)">
                  {order.thumbnails[i] ? (
                    <Image
                      src={order.thumbnails[i]}
                      alt=""
                      aria-hidden
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-(--shop-ink)">
                    {item.title_snapshot}
                  </p>
                  {item.variant_snapshot && (
                    <p className="mt-0.5 text-sm text-(--shop-mute)">
                      {item.variant_snapshot}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-(--shop-mute)">
                    Qty {item.quantity}
                  </p>
                </div>
                <p className="shrink-0 text-sm tabular-nums text-(--shop-ink)">
                  {formatMoney(
                    Number(item.price_snapshot) * item.quantity,
                    order.currency
                  )}
                </p>
              </li>
            ))}
          </ul>

          <dl className="space-y-2 border-t border-(--shop-hairline-soft) px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-(--shop-mute)">Subtotal</dt>
              <dd className="tabular-nums">
                {formatMoney(itemTotal, order.currency)}
              </dd>
            </div>
            {Number(order.discount_total) > 0 && (
              <div className="flex justify-between">
                <dt className="text-(--shop-mute)">
                  Discount{order.discount_code ? ` · ${order.discount_code}` : ""}
                </dt>
                <dd className="tabular-nums text-(--shop-success)">
                  −{formatMoney(Number(order.discount_total), order.currency)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-(--shop-hairline-soft) pt-2 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {formatMoney(order.total, order.currency)}
              </dd>
            </div>
            {amountPaid > 0 && (
              <>
                <div className="flex justify-between">
                  <dt className="text-(--shop-mute)">Advance paid</dt>
                  <dd className="tabular-nums text-(--shop-success)">
                    −{formatMoney(amountPaid, order.currency)}
                  </dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>{isCod ? "Pay on delivery" : "Balance due"}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(balanceDue(order), order.currency)}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <Link
          href={`/account/help?order=${order.order_number}`}
          className="glass glass-on-light glass-panel glass-press flex items-center gap-3 p-5 text-[15px] font-medium text-(--shop-ink)"
        >
          <LifeBuoy className="size-5 shrink-0" aria-hidden />
          Need help with this order?
        </Link>
      </div>
    </AccountShell>
  );
}
