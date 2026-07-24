import { AuthShell } from "../account-shell";
import { ResetForm } from "../auth-forms";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Reset password" };

export default function ResetPage() {
  return (
    <AuthShell
      title="Reset password"
      description="Enter the email on your account and we’ll send you a link to set a new password."
    >
      <ResetForm action={requestPasswordReset} />
    </AuthShell>
  );
}
