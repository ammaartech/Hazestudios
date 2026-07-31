import { LogOut } from "lucide-react";
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
      <div className={description ? "" : "mt-8"}>{children}</div>
    </div>
  );
}
