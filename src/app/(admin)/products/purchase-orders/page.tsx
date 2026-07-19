import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Purchase orders" };

export default function Page() {
  return (
    <ComingSoon
      title="Purchase orders"
      phase="Phase 2"
      description="Order stock from suppliers and track incoming inventory shipments across locations."
    />
  );
}
