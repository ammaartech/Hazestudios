import { CourierTrackingPage } from "../courier-tracking";

export const metadata = { title: "Delivery tracking · DTDC" };

/** See the Shree Maruti page: one shared component, four providers. */
export default function DtdcTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  return <CourierTrackingPage provider="dtdc" searchParams={searchParams} />;
}
