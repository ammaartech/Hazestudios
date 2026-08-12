import { redirect } from "next/navigation";
import { getAccountSession } from "@/lib/shop/account";
import { AuthShell } from "../account-shell";
import { SignInForm } from "../auth-forms";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };
const NOTICES: Record<string, string> = {
  "staff-only":
    "That account is a customer account, so it can’t open the admin. You’re signed in here instead.",
  // Set by the testing-phase gate in `@/lib/supabase/proxy.ts`. The standing
  // explanation is in `AuthShell`; this line is only for the person who was
  // bounced here from somewhere specific, and says what happens next.
  preview: "Sign in to keep looking around — we’ll take you back where you were.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next, error, notice } = await searchParams;

  // Already signed in — no reason to show a login form.
  const session = await getAccountSession();
  if (session) redirect(next && next.startsWith("/") ? next : "/account");

  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";

  return (
    <AuthShell
      title="Sign in"
      description="Track orders, save your details, and check out faster."
    >
      <SignInForm
        action={signIn}
        next={target}
        notice={error ?? (notice ? NOTICES[notice] ?? null : null)}
      />
    </AuthShell>
  );
}
