import { redirect } from "next/navigation";
import { DEFAULT_CARRIER } from "@/lib/delivery/carriers";

/**
 * Tracking has no page of its own — it is a set of per-carrier pages.
 *
 * Kept as a redirect rather than deleted because this was the tracking URL for
 * the whole of the Qikink-only period: it is in bookmarks, in the sidebar's
 * history, and in `revalidatePath` calls that predate the split. Landing them
 * on the default carrier is better than a 404 for a page that did exist.
 */
export default function TrackingIndex() {
  redirect(DEFAULT_CARRIER.href);
}
