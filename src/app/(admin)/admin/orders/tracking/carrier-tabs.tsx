import Link from "next/link";
import { CARRIERS } from "@/lib/delivery/carriers";
import { cn } from "@/lib/utils";

/**
 * Switches between the per-carrier tracking pages.
 *
 * Underlined tabs, not the segmented tray `FilterTabs` uses, and the difference
 * is load-bearing rather than decorative. The Qikink page already carries a
 * tray of eleven stage filters inside its card; stacking a second tray directly
 * above it would put two identical controls on one screen that mean different
 * things — one picks the dataset, the other filters within it. Underlines sit a
 * level up and read that way.
 *
 * A carrier with no integration behind it says so here rather than only after
 * you click, so the tab row doubles as the status board for all three.
 */
export function CarrierTabs({ current }: { current: string }) {
  return (
    <div className="mb-5 border-b border-border">
      {/* Scrolls rather than wraps on a phone — three carrier names do not fit
          390px, and a wrapped tab row detaches from the rule underneath it. */}
      <div className="strip -mb-px gap-1 [--strip-gutter:--spacing(4)]">
        {CARRIERS.map((carrier) => {
          const active = carrier.slug === current;
          return (
            <Link
              key={carrier.slug}
              href={carrier.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // Fixed height, not vertical padding. `.strip` centres its
                // items rather than stretching them, so a padded tab is only as
                // tall as its contents — and the "Setup" badge made those tabs
                // 1px taller than the plain ones, which put their underlines a
                // pixel below the rule the others sat on.
                "inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors duration-150",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {carrier.name}
              {!carrier.connected && (
                // Text, not a bare colour: the dot alone would be unreadable to
                // anyone who cannot separate it from the "connected" state.
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Setup
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
