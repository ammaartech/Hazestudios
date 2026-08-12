import Link from "next/link";
import { LogOut } from "lucide-react";
import { PREVIEW_LOCK } from "@/lib/shop/preview-lock";
import { signOut } from "./actions";
import { AccountNav } from "./account-nav";

/**
 * Chrome for the signed-in account area.
 *
 * The nav is an equal-width, four-up segmented control on phones — every
 * destination visible at once, nothing to scroll to discover — and a sidebar
 * from `md` up. A horizontal scroller used to stand in for the phone layout,
 * but four icon-and-label pills never fit a phone width without clipping the
 * last one, which reads as broken rather than "scroll for more." Sign out is
 * not a destination, so it sits below the grid rather than competing with it
 * for a fifth column.
 */
export function AccountShell({
  title,
  description,
  current,
  children,
}: {
  title: React.ReactNode;
  description?: string;
  current: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-8 md:px-8 md:pt-14">
      <header className="mb-6 md:mb-8">
        <h1 className="display text-[clamp(1.75rem,6vw,3.5rem)]">{title}</h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-(--shop-mute) md:mt-3 md:text-[15px]">
            {description}
          </p>
        )}
      </header>

      <div className="grid gap-6 md:grid-cols-[200px_1fr] md:gap-12">
        <nav aria-label="Account" className="md:sticky md:top-24 md:self-start">
          <AccountNav current={current} />

          <form
            action={signOut}
            className="mt-3 border-t border-(--shop-hairline-soft) pt-3 md:mt-4 md:pt-4"
          >
            <button
              type="submit"
              className="glass-press flex min-h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-full px-4 text-sm font-medium text-(--shop-mute) transition-colors duration-300 hover:text-(--shop-ink) md:justify-start"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </nav>

        <div className="min-w-0 pb-8">{children}</div>
      </div>
    </div>
  );
}

/**
 * Why the account screen is in the way.
 *
 * TEMPORARY, and paired with the gate in `@/lib/supabase/proxy.ts`. Rendered on
 * every signed-out auth screen rather than only on the redirect that carries
 * `?notice=preview`, because someone can reach `/account/register` directly
 * from a link and deserves the same explanation.
 *
 * It names the way out as well as the reason: most people arriving here right
 * now came for the event, and the waitlist is the page they actually wanted.
 */
function TestPhaseNotice() {
  return (
    <aside className="mb-8 rounded-2xl border border-(--shop-hairline-soft) bg-(--shop-cloud) p-4 md:p-5">
      <p className="meta text-[11px] text-(--shop-mute)">Testing phase</p>
      <p className="mt-2 text-sm leading-relaxed text-(--shop-ink)">
        The store isn’t open yet — we’re still building it, so browsing needs an
        account for now.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-(--shop-mute)">
        Here for Summer Sands?{" "}
        <Link
          href="/waitlist"
          className="font-medium text-(--shop-ink) underline underline-offset-4"
        >
          The waitlist is open to everyone
        </Link>{" "}
        — no account needed.
      </p>
    </aside>
  );
}

/** Centred column for the signed-out auth screens. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 md:py-24">
      <h1 className="display text-[clamp(2rem,7vw,3rem)]">{title}</h1>
      {description && (
        <p className="mb-8 mt-3 text-[15px] leading-relaxed text-(--shop-mute)">
          {description}
        </p>
      )}
      {PREVIEW_LOCK && <TestPhaseNotice />}
      <div className={description || PREVIEW_LOCK ? "" : "mt-8"}>{children}</div>
    </div>
  );
}
