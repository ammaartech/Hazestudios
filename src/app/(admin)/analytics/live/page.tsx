import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Live View" };

export default function Page() {
  return (
    <ComingSoon
      title="Live View"
      phase="Phase S (Storefront)"
      description="A real-time map of active visitors arrives once the storefront starts receiving traffic."
    />
  );
}
