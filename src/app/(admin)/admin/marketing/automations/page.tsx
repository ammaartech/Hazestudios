import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Automations" };

export default function Page() {
  return (
    <ComingSoon
      title="Automations"
      phase="Phase 3"
      description="Trigger automated customer emails like welcome series or birthday discounts."
    />
  );
}
