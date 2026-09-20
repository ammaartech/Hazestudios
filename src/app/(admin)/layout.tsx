import type { Metadata } from "next";
import { AdminContentFrame } from "@/components/admin/content-frame";
import "./admin-ui.css";
import { Suspense } from "react";
import { Sidebar, SidebarNav } from "@/components/admin/sidebar";
import { MobileNav, MobileNavBar } from "@/components/admin/mobile-nav";
import { Topbar } from "@/components/admin/topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getShopSettings } from "@/lib/admin/reference";
import { getStaffSession } from "@/lib/auth/staff";

// The root layout now identifies as the storefront, so the admin restates its own.
export const metadata: Metadata = {
  title: {
    default: "Fogstores Admin",
    template: "%s · Fogstores Admin",
  },
};

/**
 * The signed-in half of the topbar. Split out of the layout because it reads
 * the session cookie and Cache Components will not let request-time data block
 * a prerender — it has to sit behind its own Suspense boundary so the chrome
 * around it can still be static HTML.
 *
 * Neither read is a trip to Tokyo any more: the store name comes from the
 * shared reference cache and the email from the locally verified token.
 */
async function TopbarWithSession() {
  let storeName = "Fogstores";
  let userEmail = "Not signed in";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const [settings, session] = await Promise.all([
        getShopSettings(),
        getStaffSession(),
      ]);
      if (settings?.store_name) storeName = settings.store_name;
      if (session.email) userEmail = session.email;
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
          <Suspense fallback={null}>
            <AdminContentFrame>
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
            </AdminContentFrame>
          </Suspense>
        </main>
      </div>
    </TooltipProvider>
  );
}
