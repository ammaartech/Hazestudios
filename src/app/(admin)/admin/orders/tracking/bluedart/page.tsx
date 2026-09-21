import { CourierTrackingPage } from "../courier-tracking";

export const metadata = { title: "Delivery tracking · Blue Dart" };

/** See the Shree Maruti page: one shared component, two providers. */
export default function BlueDartTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  return <CourierTrackingPage provider="bluedart" searchParams={searchParams} />;
}
