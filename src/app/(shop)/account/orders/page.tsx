import { getAccountOrders, requireAccount } from "@/lib/shop/account";
import { AccountShell } from "../account-shell";
import { ConfirmEmailNotice, OrderSections } from "../order-parts";

export const metadata = { title: "Orders" };
export default async function OrdersPage() {
  const session = await requireAccount("/account/orders");

  if (!session.customer) {
    return (
      <AccountShell title="Orders" current="/account/orders">
        <ConfirmEmailNotice email={session.email} />
      </AccountShell>
    );
  }

  const orders = await getAccountOrders(session.customer.id);

  return (
    <AccountShell
      title="Orders"
      description="Anything still on its way is listed first."
      current="/account/orders"
    >
      <OrderSections orders={orders} />
    </AccountShell>
  );
}
