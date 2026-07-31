import { AccountShell } from "../account-shell";
import { OrdersSkeleton } from "../skeletons";

export default function OrdersLoading() {
  return (
    <AccountShell
      title="Orders"
      description="Anything still on its way is listed first."
      current="/account/orders"
    >
      <OrdersSkeleton />
    </AccountShell>
  );
}
