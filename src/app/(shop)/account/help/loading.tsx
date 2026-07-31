import { AccountShell } from "../account-shell";
import { HelpSkeleton } from "../skeletons";

export default function HelpLoading() {
  return (
    <AccountShell
      title="Help"
      description="Answers to the questions we get most, and how to reach us."
      current="/account/help"
    >
      <HelpSkeleton />
    </AccountShell>
  );
}
