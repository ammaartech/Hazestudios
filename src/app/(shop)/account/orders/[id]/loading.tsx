import { AccountShell } from "../../account-shell";
import { OrderDetailSkeleton, TitleSkeleton } from "../../skeletons";

export default function OrderDetailLoading() {
  return (
    <AccountShell title={<TitleSkeleton />} current="/account/orders">
      <OrderDetailSkeleton />
    </AccountShell>
  );
}
