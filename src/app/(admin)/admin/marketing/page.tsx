import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Marketing" };

export default function Page() {
  return (
    <ComingSoon
      title="Marketing"
      phase="Phase 3"
      description="Build and track email campaigns, Facebook ads, and Google ads."
    />
  );
}
