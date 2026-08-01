"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AuthResult } from "./actions";

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="meta text-(--shop-mute)">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        className="glass glass-on-light mt-2 h-12 w-full rounded-2xl px-4 text-[15px] text-(--shop-ink) outline-none transition-shadow duration-300 placeholder:text-(--shop-stone) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--shop-ink)"
      />
      {hint && <span className="mt-1.5 block text-xs text-(--shop-mute)">{hint}</span>}
    </label>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  // useFormStatus reads the enclosing form, so the button disables itself
  // during submission without the parent tracking pending state.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="glass glass-primary glass-pill glass-press min-h-13 w-full cursor-pointer px-8 text-[15px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "One moment…" : children}
    </button>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-2xl bg-(--shop-sale)/8 px-4 py-3 text-sm text-(--shop-sale)"
    >
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Google                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * OAuth runs from the browser: Supabase needs to redirect the top-level window
 * to Google, which a server action cannot do.
 */
export function GoogleButton({ next = "/account" }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      // Almost always "provider is not enabled" until Google is configured in
      // the Supabase dashboard — say so plainly rather than failing silently.
      setError(
        error.message.toLowerCase().includes("not enabled")
          ? "Google sign-in isn’t enabled for this store yet."
          : error.message
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="glass glass-on-light glass-quiet glass-pill glass-press flex min-h-13 w-full cursor-pointer items-center justify-center gap-3 px-8 text-[15px] font-medium text-(--shop-ink) disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg className="size-5" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
        </svg>
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>
      <ErrorNote message={error} />
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-4">
      <span className="h-px flex-1 bg-(--shop-hairline-soft)" />
      <span className="meta text-(--shop-stone)">or</span>
      <span className="h-px flex-1 bg-(--shop-hairline-soft)" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

type Action = (
  prev: AuthResult | null,
  formData: FormData
) => Promise<AuthResult>;

export function SignInForm({
  action,
  next,
  notice,
}: {
  action: Action;
  next: string;
  notice: string | null;
}) {
  const [state, formAction] = useActionState(action, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <div className="space-y-6">
      {notice && (
        <p className="rounded-2xl bg-(--shop-cloud) px-4 py-3 text-sm text-(--shop-charcoal)">
          {notice}
        </p>
      )}

      <GoogleButton next={next} />
      <Divider />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <ErrorNote message={error} />
        <Submit>Sign in</Submit>
      </form>

      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link
          href="/account/reset"
          className="text-(--shop-mute) underline-offset-4 hover:text-(--shop-ink) hover:underline"
        >
          Forgot your password?
        </Link>
        <Link
          href={`/account/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-(--shop-ink) underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}

export function SignUpForm({ action, next }: { action: Action; next: string }) {
  const [state, formAction] = useActionState(action, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <div className="space-y-6">
      <GoogleButton next={next} />
      <Divider />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="first_name" autoComplete="given-name" />
          <Field label="Last name" name="last_name" autoComplete="family-name" />
        </div>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters."
        />
        <ErrorNote message={error} />
        <Submit>Create account</Submit>
      </form>

      <p className="text-sm text-(--shop-mute)">
        Already have an account?{" "}
        <Link
          href={`/account/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-(--shop-ink) underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);

  if (state?.ok) {
    return (
      <p className="rounded-2xl bg-(--shop-success)/8 px-4 py-3 text-sm text-(--shop-success)">
        If an account exists for that address, a reset link is on its way.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <ErrorNote message={state && !state.ok ? state.error : null} />
      <Submit>Send reset link</Submit>
    </form>
  );
}

export function NewPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters."
      />
      <ErrorNote message={state && !state.ok ? state.error : null} />
      <Submit>Save password</Submit>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export function ProfileForm({
  action,
  customer,
}: {
  action: Action;
  customer: {
    first_name: string;
    last_name: string;
    phone: string | null;
    accepts_marketing: boolean;
  };
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="first_name" defaultValue={customer.first_name} autoComplete="given-name" />
        <Field label="Last name" name="last_name" defaultValue={customer.last_name} autoComplete="family-name" />
      </div>
      <Field label="Phone" name="phone" type="tel" defaultValue={customer.phone ?? ""} autoComplete="tel" />

      <label className="flex cursor-pointer items-start gap-3 text-sm text-(--shop-charcoal)">
        <input
          type="checkbox"
          name="accepts_marketing"
          defaultChecked={customer.accepts_marketing}
          className="mt-0.5 size-4 accent-(--shop-ink)"
        />
        Email me about new drops and restocks.
      </label>

      <div className="flex items-center gap-4">
        <div className="w-40">
          <Submit>Save changes</Submit>
        </div>
        {state?.ok && (
          <span
            className={cn("text-sm text-(--shop-success)")}
            role="status"
          >
            Saved.
          </span>
        )}
      </div>
      <ErrorNote message={state && !state.ok ? state.error : null} />
    </form>
  );
}
