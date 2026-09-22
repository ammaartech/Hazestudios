import { CourierTrackingPage } from "../courier-tracking";

export const metadata = { title: "Delivery tracking · Shree Maruti" };

/**
 * Dynamic by construction, like the Qikink page: the rows are per-request and
 * staff-scoped, so there is nothing to cache. The page itself lives in
 * `../courier-tracking.tsx`, shared with the other couriers — they differ
 * in how they are *called*, not in how their parcels are listed.
 */
export default function ShreeMarutiTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  return <CourierTrackingPage provider="shreemaruti" searchParams={searchParams} />;
}
