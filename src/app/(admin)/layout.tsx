import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { createClient } from "@/lib/supabase/server";

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
    <div className="min-h-screen bg-background">
      <Topbar storeName={storeName} userEmail={userEmail} />
      <Sidebar />
      <main className="pt-14 md:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</div>
      </main>
    </div>
  );
}
