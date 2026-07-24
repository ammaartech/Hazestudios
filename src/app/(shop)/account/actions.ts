"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { claimCart } from "../cart/actions";
import { clearCartCookie } from "@/lib/shop/cart";

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Auth messages are deliberately vague about *which* half failed.
 * "No account with that email" tells an attacker which addresses are
 * registered; "email or password is incorrect" does not.
 */
function readableAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email or password is incorrect.";
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email address first — check your inbox for the link.";
  }
  if (m.includes("user already registered")) {
    return "An account already exists for that email. Try signing in instead.";
  }
  if (m.includes("password should be at least")) {
    return "Passwords need to be at least 8 characters.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
}

/** Only ever redirect within this site — an open redirect is a phishing vector. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

async function siteOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function signIn(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { ok: false, error: readableAuthError(error.message) };

  // Whatever they put in their bag as a guest follows them into the account,
  // merged with anything already there. Must run before the redirect, which
  // throws.
  await claimCart();

  revalidatePath("/account", "layout");
  redirect(next);
}

export async function signUp(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();

  if (!email || !password) {
    return { ok: false, error: "Enter your email and a password." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Passwords need to be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read back by link_customer_account() to name the customer record.
      data: { first_name: firstName, last_name: lastName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/account`,
    },
  });

  if (error) return { ok: false, error: readableAuthError(error.message) };

  redirect("/account/check-email");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Drop the cart cookie, not the cart. The rows still carry the customer_id,
  // so signing back in finds them again via claim_cart() — but the next person
  // to use this browser does not inherit somebody else's bag.
  await clearCartCookie();

  revalidatePath("/account", "layout");
  redirect("/");
}

export async function requestPasswordReset(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: "Enter your email address." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/account/password`,
  });

  // Reported as sent whether or not the address exists, so this cannot be used
  // to enumerate which emails have accounts.
  return { ok: true };
}

export async function updatePassword(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { ok: false, error: "Passwords need to be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: readableAuthError(error.message) };

  redirect("/account");
}

export async function updateProfile(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient();
  const { data: customerId } = await supabase.rpc("link_customer_account");

  if (!customerId) {
    return {
      ok: false,
      error: "Confirm your email address before updating your details.",
    };
  }

  // RLS (`customers_self_update`) is what actually restricts this to the
  // caller's own row; the id here just targets it.
  const { error } = await supabase
    .from("customers")
    .update({
      first_name: String(formData.get("first_name") ?? "").trim(),
      last_name: String(formData.get("last_name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      accepts_marketing: formData.get("accepts_marketing") === "on",
    })
    .eq("id", customerId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/account/profile");
  return { ok: true };
}
