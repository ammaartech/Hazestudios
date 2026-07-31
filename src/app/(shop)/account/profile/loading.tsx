import { AccountShell } from "../account-shell";
import { ProfileSkeleton } from "../skeletons";

export default function ProfileLoading() {
  return (
    <AccountShell
      title="Your details"
      description="Used to reach you about orders."
      current="/account/profile"
    >
      <ProfileSkeleton />
    </AccountShell>
  );
}
