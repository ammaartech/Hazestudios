import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import {
  getAccountOrders,
  isOpenOrder,
  requireAccount,
} from "@/lib/shop/account";
import { AccountShell } from "./account-shell";
import {
  ConfirmEmailNotice,
  EmptyOrders,
  OrderCard,
} from "./order-parts";

export const metadata = { title: "Account" };
export default async function AccountPage() {
  const session = await requireAccount();

  const firstName = session.customer?.first_name?.trim();
  const greeting = firstName ? `Hi, ${firstName}` : "Your account";

  // No customer record means the address is still unconfirmed — the account
  // exists but has no shop identity yet, by design.
  if (!session.customer) {
    return (
      <AccountShell title={greeting} current="/account">
        <ConfirmEmailNotice email={session.email} />
      </AccountShell>
    );
  }

  const orders = await getAccountOrders(session.customer.id);
  const open = orders.filter(isOpenOrder);
  const spent = orders
    .filter((o) => o.payment_status === "paid" || o.payment_status === "partially_refunded")
    .reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <AccountShell
      title={greeting}
      description="Your orders, details and help — all in one place."
      current="/account"
    >
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "In progress", value: String(open.length) },
            { label: "Total orders", value: String(orders.length) },
            { label: "Total spent", value: formatMoney(spent) },
          ].map((stat) => (
            <div
              key={stat.label}
              className="glass glass-on-light glass-panel p-5"
            >
              <p className="meta text-(--shop-mute)">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-(--shop-ink)">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="meta text-(--shop-mute)">
              {open.length ? "In progress" : "Recent orders"}
            </h2>
            {orders.length > 0 && (
              <Link
                href="/account/orders"
                className="meta inline-flex items-center gap-1.5 text-(--shop-ink) underline-offset-4 hover:underline"
              >
                All orders
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>

          {orders.length === 0 ? (
            <EmptyOrders />
          ) : (
            <div className="grid gap-4">
              {(open.length ? open : orders).slice(0, 3).map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AccountShell>
  );
}
