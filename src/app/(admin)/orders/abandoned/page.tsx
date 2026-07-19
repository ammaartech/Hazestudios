import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata = { title: "Abandoned checkouts" };

export default function Page() {
  return (
    <ComingSoon
      title="Abandoned checkouts"
      phase="Phase S (Storefront)"
      description="Incomplete checkouts and automated recovery emails arrive once the customer-facing storefront and checkout are live."
    />
  );
}
