import { requireAccount } from "@/lib/shop/account";
import { AuthShell } from "../account-shell";
import { NewPasswordForm } from "../auth-forms";
import { updatePassword } from "../actions";

export const metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  // Reached via the emailed reset link, which has already established a session
  // by the time the callback route redirects here.
  await requireAccount("/account/password");

  return (
    <AuthShell title="New password" description="Choose a new password for your account.">
      <NewPasswordForm action={updatePassword} />
    </AuthShell>
  );
}
