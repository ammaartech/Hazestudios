"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { subscribeToNewsletter } from "@/app/(shop)/newsletter-actions";
import { cn } from "@/lib/utils";

function SubmitButton({ done }: { done: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || done}
      aria-label="Subscribe"
      className="glass-press absolute inset-y-1.5 right-1.5 grid w-11 cursor-pointer place-items-center rounded-full text-white/70 transition-colors duration-300 hover:bg-white/10 hover:text-white disabled:cursor-default"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : done ? (
        <Check className="size-4 text-white" aria-hidden />
      ) : (
        <ArrowRight className="size-4" aria-hidden />
      )}
    </button>
  );
}

/**
 * Footer newsletter sign-up.
 *
 * The result is announced in a live region rather than only shown, and the
 * input keeps `aria-invalid` in step with it, so a rejected address is
 * communicated to a screen reader the same way the red text communicates it to
 * everyone else.
 */
export function NewsletterForm() {
  const [state, action] = useActionState(subscribeToNewsletter, null);
  const done = state?.ok === true;

  return (
    <div>
      <form action={action} className="relative max-w-sm">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Your email"
          defaultValue={done ? "" : undefined}
          aria-invalid={state?.ok === false || undefined}
          aria-describedby={state ? "newsletter-status" : undefined}
          className={cn(
            "h-14 w-full rounded-full border bg-transparent pl-6 pr-14 text-sm text-white",
            "placeholder:text-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            state?.ok === false ? "border-[#ff8a85]" : "border-white/30"
          )}
        />
        <SubmitButton done={done} />
      </form>

      {state && (
        <p
          id="newsletter-status"
          role="status"
          className={cn(
            "mt-3 text-sm",
            state.ok ? "text-white/70" : "text-[#ff8a85]"
          )}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
