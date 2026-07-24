import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthShell } from "../account-shell";

export const metadata = { title: "Confirm your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell title="Check your inbox">
      <div className="glass glass-on-light glass-panel space-y-4 p-6">
        <MailCheck className="size-7 text-(--shop-ink)" aria-hidden />
        <p className="text-[15px] leading-relaxed text-(--shop-charcoal)">
          We’ve sent you a confirmation link. Open it and your account is ready.
        </p>
        <p className="text-sm leading-relaxed text-(--shop-mute)">
          Confirming also connects any orders you’ve already placed with this
          email address, so your history shows up straight away.
        </p>
      </div>

      <Link
        href="/account/login"
        className="glass glass-ink glass-pill glass-press mt-6 flex min-h-13 cursor-pointer items-center justify-center px-8 text-[15px] font-medium"
      >
        Back to sign in
      </Link>
    </AuthShell>
  );
}
