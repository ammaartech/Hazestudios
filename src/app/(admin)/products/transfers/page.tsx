import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Transfers" };

export default function Page() {
  return (
    <ComingSoon
      title="Transfers"
      phase="Phase 2"
      description="Move inventory between store locations and track transfer status."
    />
  );
}
