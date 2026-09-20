"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Staff sign-out, as a Server Action.
 *
 * The topbar used to do this in the browser, which meant every admin page
 * shipped the whole browser Supabase SDK — auth, realtime and storage, 218 KB
 * before compression — to power one menu item. The server client already
 * holds the session cookies, so it can end the session and clear them, and
 * the redirect lands on the login page with no client library involved.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
