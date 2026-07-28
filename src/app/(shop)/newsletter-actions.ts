"use server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Newsletter sign-up.
 *
 * `customers` grants nothing to `anon` on purpose — a public insert policy would
 * let anyone write rows into the CRM — so the write is privileged and every
 * constraint on it lives here rather than in a policy.
 *
 * The action is deliberately incurious about whether an address is already on
 * the list: it reports the same success either way. Telling an anonymous caller
 * "you are already subscribed" turns the form into an oracle for whether a given
 * person shops here.
 */

export type SubscribeResult = { ok: boolean; message: string };

// Deliberately permissive: the only thing worth rejecting at this stage is a
// value that plainly is not an address. Deliverability is the ESP's problem.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function subscribeToNewsletter(
  _prev: SubscribeResult | null,
  formData: FormData
): Promise<SubscribeResult> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!EMAIL.test(email) || email.length > 254) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return { ok: false, message: "Sign-up is unavailable right now." };
  }

  const { data: existing } = await supabase
    .from("customers")
    .select("id, accepts_marketing")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    // Only ever flips consent on. Nothing else about an existing customer is
    // touched — a sign-up form must not be able to rewrite a CRM record.
    if (!existing.accepts_marketing) {
      const { error } = await supabase
        .from("customers")
        .update({ accepts_marketing: true })
        .eq("id", existing.id);
      if (error) return { ok: false, message: "Something went wrong. Try again." };
    }
    return { ok: true, message: "You're on the list. Watch your inbox." };
  }

  const { error } = await supabase
    .from("customers")
    .insert({ email, accepts_marketing: true, tags: ["newsletter"] });

  if (error) {
    // A unique-violation here means the address was inserted between the read
    // above and this write, which is the outcome the caller wanted anyway.
    if (error.code === "23505") {
      return { ok: true, message: "You're on the list. Watch your inbox." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  }

  return { ok: true, message: "You're on the list. Watch your inbox." };
}
