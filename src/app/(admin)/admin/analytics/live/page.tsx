import { getLiveSnapshot } from "@/lib/analytics/queries";
import { LiveView } from "./live-view";

export const metadata = { title: "Live View" };
export default async function Page() {
  // Server-render the first snapshot so the page opens with real numbers; the
  // client takes over polling from there.
  const initial = await getLiveSnapshot();

  return <LiveView initial={initial} />;
}
