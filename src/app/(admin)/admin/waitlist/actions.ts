"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isWaitlistStatus } from "@/lib/shop/waitlist";

/**
 * Triage from the list: mark someone invited, confirmed, or out.
 *
 * Runs on the request-scoped client, so the `is_staff()` update policy from
 * 0024_waitlist.sql is what actually authorises the write — this action holds
 * no service-role key and cannot escalate past whoever is signed in.
 */
export async function updateWaitlistStatus(id: string, status: string) {
  if (!isWaitlistStatus(status)) {
    return { error: "Unknown status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waitlist_entries")
    .update({ status })
    .eq("id", id);

  if (error) return { error: error.message };

  // The counts above the table are derived from the same rows.
  revalidatePath("/admin/waitlist");
  return { ok: true };
}
