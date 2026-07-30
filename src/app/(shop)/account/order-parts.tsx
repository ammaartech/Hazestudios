import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Package } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { isOpenOrder, type AccountOrder } from "@/lib/shop/account";
import type { Order } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Plain-language order status.
 *
 * Shoppers do not think in `fulfillment_status`. They think "where is it?", so
 * the label answers that question and the raw enum stays in the admin.
 */
export function orderStatusLabel(order: Order): {
  label: string;
  tone: "open" | "done" | "warn";
} {
  if (order.payment_status === "refunded") {
    return { label: "Refunded", tone: "warn" };
  }
  if (order.payment_status === "partially_refunded") {
    return { label: "Partially refunded", tone: "warn" };
  }
  // Voided/restocked are terminal: nothing shipped and nothing is owed. To the
  // shopper that reads as "Cancelled", never as "Preparing".
  if (order.payment_status === "voided" || order.fulfillment_status === "restocked") {
    return { label: "Cancelled", tone: "warn" };
  }
  if (order.fulfillment_status === "fulfilled") {
    return { label: "Delivered", tone: "done" };
  }
  if (order.fulfillment_status === "partial") {
    return { label: "Partly shipped", tone: "open" };
  }
  if (order.payment_status === "pending" || order.payment_status === "partially_paid") {
    return { label: "Payment pending", tone: "warn" };
  }
  return { label: "Preparing", tone: "open" };
}

export function StatusPill({ order }: { order: Order }) {
  const { label, tone } = orderStatusLabel(order);
  return (
    <span
      className={cn(
        "meta glass glass-pill inline-flex items-center px-3 py-1.5",
        tone === "open" && "glass-on-light text-(--shop-ink)",
        tone === "done" && "glass-on-light text-(--shop-success)",
        tone === "warn" && "glass-on-light text-(--shop-sale)"
      )}
    >
      {label}
    </span>
  );
}

export function OrderCard({ order }: { order: AccountOrder }) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="group glass glass-on-light glass-panel glass-press block p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-(--shop-ink)">
            Order #{order.order_number}
          </p>
          <p className="mt-0.5 text-sm text-(--shop-mute)">
            {formatDate(order.created_at)} · {itemCount} item
            {itemCount === 1 ? "" : "s"} · {formatMoney(order.total, order.currency)}
          </p>
        </div>
        <StatusPill order={order} />
      </div>

      {order.thumbnails.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          {order.thumbnails.slice(0, 4).map((url, i) => (
            <div
              key={`${url}-${i}`}
              className="relative size-14 shrink-0 overflow-hidden bg-(--shop-cloud)"
            >
              <Image
                src={url}
                alt=""
                aria-hidden
                fill
                sizes="56px"
                className="object-cover"
              />
            </div>
          ))}
          {order.thumbnails.length > 4 && (
            <span className="text-sm text-(--shop-mute)">
              +{order.thumbnails.length - 4}
            </span>
          )}
        </div>
      )}

      <span className="meta mt-4 inline-flex items-center gap-1.5 text-(--shop-mute) transition-colors duration-300 group-hover:text-(--shop-ink)">
        View order
        <ArrowRight
          className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1"
          aria-hidden
        />
      </span>
    </Link>
  );
}

export function OrderSections({ orders }: { orders: AccountOrder[] }) {
  const open = orders.filter(isOpenOrder);
  const past = orders.filter((o) => !isOpenOrder(o));

  if (!orders.length) return <EmptyOrders />;

  return (
    <div className="space-y-10">
      {open.length > 0 && (
        <section>
          <h2 className="meta mb-4 text-(--shop-mute)">
            In progress ({open.length})
          </h2>
          <div className="grid gap-4">
            {open.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="meta mb-4 text-(--shop-mute)">
            Past orders ({past.length})
          </h2>
          <div className="grid gap-4">
            {past.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function EmptyOrders() {
  return (
    <div className="glass glass-on-light glass-panel px-6 py-14 text-center">
      <Package className="mx-auto size-7 text-(--shop-stone)" aria-hidden />
      <p className="mt-4 text-[15px] font-medium text-(--shop-ink)">
        No orders yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-(--shop-mute)">
        When you place an order it will appear here, with tracking and receipts.
      </p>
      <Link
        href="/"
        className="glass glass-ink glass-pill glass-press mt-6 inline-flex min-h-12 cursor-pointer items-center px-7 text-sm font-medium"
      >
        Start shopping
      </Link>
    </div>
  );
}

/** Shown when the session exists but the email has not been confirmed yet. */
export function ConfirmEmailNotice({ email }: { email: string | null }) {
  return (
    <div className="glass glass-on-light glass-panel p-6">
      <p className="text-[15px] font-medium text-(--shop-ink)">
        Confirm your email to finish setting up
      </p>
      <p className="mt-2 text-sm leading-relaxed text-(--shop-mute)">
        We sent a link to {email ?? "your email address"}. Until it’s confirmed
        we can’t connect your orders to this account — that check is what stops
        someone else claiming your order history.
      </p>
    </div>
  );
}
