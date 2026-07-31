import { AccountShell } from "./account-shell";
import { OverviewSkeleton, TitleSkeleton } from "./skeletons";

export default function AccountLoading() {
  return (
    <AccountShell title={<TitleSkeleton />} current="/account">
      <OverviewSkeleton />
    </AccountShell>
  );
}
