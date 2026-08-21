import type { Metadata } from "next";
import { Suspense } from "react";
import { Sidebar, SidebarNav } from "@/components/admin/sidebar";
import { MobileNav, MobileNavBar } from "@/components/admin/mobile-nav";
import { Topbar } from "@/components/admin/topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";

// The root layout now identifies as the storefront, so the admin restates its own.
export const metadata: Metadata = {
  title: {
    default: "Fogstores Admin",
    template: "%s · Fogstores Admin",
  },
};

/**
 * The signed-in half of the topbar. Split out of the layout because it reads
 * `cookies()` (via the Supabase session) and Cache Components will not let
 * request-time data block a prerender — it has to sit behind its own Suspense
 * boundary so the chrome around it can still be static HTML.
 */
async function TopbarWithSession() {
  let storeName = "Fogstores";
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

  return <Topbar storeName={storeName} userEmail={userEmail} />;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Radix requires a Provider above any Tooltip. Mounting it once here rather
    // than per call site means a tooltip anywhere in the admin just works, and
    // hovering between two tooltips shares one delay instead of re-waiting.
    <TooltipProvider delayDuration={300}>
      {/*
        `admin` scopes the glass control layer (globals.css) and `font-admin`
        swaps Work Sans — the storefront's editorial face — for the native UI
        stack. Both are set here, once, so no admin page has to opt in.
      */}
      <div className="admin min-h-screen bg-background font-admin">
        {/* The fallback is the same bar with placeholder text, so the shell has
            the topbar's full height from the first paint and the page below it
            does not jump when the session resolves. */}
        <Suspense fallback={<Topbar storeName="Fogstores" userEmail="…" />}>
          <TopbarWithSession />
        </Suspense>
        {/* `usePathname` is request-time data, so the live sidebar streams and
            the shell carries the same nav with no active row highlighted. */}
        <Suspense fallback={<SidebarNav pathname="" />}>
          <Sidebar />
        </Suspense>
        {/* The phone's navigation. The sidebar is `hidden md:flex`, so without
            this the admin had no way to move between sections on a phone at
            all. Rendered outside <main> because it floats over it. */}
        <Suspense fallback={<MobileNavBar pathname="" />}>
          <MobileNav />
        </Suspense>

        {/* `pb-28` clears the floating island so the last row of a table, or a
            form's Save button, is never parked underneath it. */}
        <main className="pt-14 pb-28 md:pb-0 md:pl-60">
          {/*
            Most admin pages want the centred reading column. Home, Analytics and
            Live View are dashboards that need the full width, so they render a
            `data-full-bleed` root and this container stands down for them —
            cheaper than a parallel layout or threading a prop through every page.
          */}
          {/*
            The page gutter — `px-4 md:px-8 xl:px-12` — is the admin's shared
            horizontal rhythm, restated by every `data-full-bleed` page and by
            the analytics section bands. Changing it here means changing it
            there too, or the dashboard headers stop aligning with their bodies.

            The `xl` step exists because the gutter used to stop at 32px. On a
            full-bleed page that put the title and the primary action hard
            against both walls at *every* width above 1280px, and the capped
            pages collapsed to the same 32px as soon as the viewport dropped
            near 1424px — which is where a 1440px laptop sits, so the most
            common admin screen was also the one that looked most cramped.
          */}
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 xl:px-12 lg:py-8 has-data-full-bleed:max-w-none has-data-full-bleed:p-0">
            {/*
              One boundary for the whole admin, and deliberately so.

              Every admin page is a signed-in, per-user view of live operational
              data — there is nothing here worth prerendering, and pretending
              otherwise would mean threading Suspense through forty-odd pages to
              buy a static shell nobody benefits from. Declaring it once here
              says the true thing: the admin defers to request time.

              Routes with their own `loading.tsx` (products, orders, customers,
              the dashboard) keep their skeletons — those boundaries sit below
              this one and resolve first.
            */}
            <Suspense fallback={null}>{children}</Suspense>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
