import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { REPORTS } from "@/lib/analytics/report-definitions";
import { ReportCatalog } from "./report-catalog";
import { AskAi } from "./ask-ai";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  let storeName = "Hazestudios";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("shop_settings")
        .select("store_name")
        .single();
      if (data?.store_name) storeName = data.store_name;
    } catch {
      // Fall back to the default name — the catalog does not depend on it.
    }
  }

  return (
    <div data-full-bleed>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-8">
        <div className="flex items-center gap-2.5">
          <FileText className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        </div>
        <Link
          href="/admin/analytics"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:bg-muted"
        >
          Back to Analytics
        </Link>
      </div>

      <div className="px-4 py-5 md:px-8">
        <AskAi />
        <ReportCatalog reports={REPORTS} createdBy={storeName} />
      </div>
    </div>
  );
}
