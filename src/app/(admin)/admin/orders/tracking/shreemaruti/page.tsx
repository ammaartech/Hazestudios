import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { carrierBySlug } from "@/lib/delivery/carriers";
import { CarrierTabs } from "../carrier-tabs";
import { CarrierSetup } from "../carrier-setup";

const carrier = carrierBySlug("shreemaruti");

export const metadata = { title: "Delivery tracking · Shree Maruti" };

export default function ShreeMarutiTrackingPage() {
  // Unreachable while the slug is in the registry; it is the registry that this
  // page's whole identity comes from, so failing loudly beats rendering a page
  // titled "undefined" if the entry is ever renamed.
  if (!carrier) notFound();

  return (
    <div>
      <PageHeader
        title="Delivery tracking — Shree Maruti"
        backHref="/admin/orders"
        backLabel="Orders"
      />
      <CarrierTabs current={carrier.slug} />
      <CarrierSetup carrier={carrier} />
    </div>
  );
}
