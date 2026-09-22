import { CourierTrackingPage } from "../courier-tracking";

export const metadata = { title: "Delivery tracking · Delhivery" };

/** See the Shree Maruti page: one shared component, four providers. */
export default function DelhiveryTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  return <CourierTrackingPage provider="delhivery" searchParams={searchParams} />;
}
