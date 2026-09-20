import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { carrierBySlug } from "@/lib/delivery/carriers";
import { CarrierTabs } from "../carrier-tabs";
import { CarrierSetup } from "../carrier-setup";

const carrier = carrierBySlug("bluedart");

export const metadata = { title: "Delivery tracking · Bluedart" };

export default function BluedartTrackingPage() {
  // See the note in the Shree Maruti page: the registry entry is this page's
  // identity, so a missing one is a bug to surface rather than to render around.
  if (!carrier) notFound();

  return (
    <div>
      <PageHeader
        title="Delivery tracking — Bluedart"
        backHref="/admin/orders"
        backLabel="Orders"
      />
      <CarrierTabs current={carrier.slug} />
      <CarrierSetup carrier={carrier} />
    </div>
  );
}
