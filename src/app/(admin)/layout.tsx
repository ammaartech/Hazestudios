import type { Metadata } from "next";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";

// The root layout now identifies as the storefront, so the admin restates its own.
export const metadata: Metadata = {
  title: {
    default: "Hazestudios Admin",
    template: "%s · Hazestudios Admin",
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let storeName = "Hazestudios";
  let userEmail = "Not signed in";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const supabase = await createClient();
      const [{ data: settings }, { data: userData }] = await Promise.all([
        supabase.from("shop_settings").select("store_name").single(),
        supabase.auth.getUser(),
      ]);
      if (settings?.store_name) storeName = settings.store_name;
      if (userData.user?.email) userEmail = userData.user.email;
    } catch {
      // Supabase not reachable yet — render the shell anyway.
    }
  }

  return (
    // Radix requires a Provider above any Tooltip. Mounting it once here rather
    // than per call site means a tooltip anywhere in the admin just works, and
    // hovering between two tooltips shares one delay instead of re-waiting.
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-background">
        <Topbar storeName={storeName} userEmail={userEmail} />
        <Sidebar />
        <main className="pt-14 md:pl-60">
          {/*
            Most admin pages want the centred reading column. Home, Analytics and
            Live View are dashboards that need the full width, so they render a
            `data-full-bleed` root and this container stands down for them —
            cheaper than a parallel layout or threading a prop through every page.
          */}
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 lg:py-8 has-data-full-bleed:max-w-none has-data-full-bleed:p-0">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
