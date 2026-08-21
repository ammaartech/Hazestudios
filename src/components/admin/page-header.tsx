import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The title block every admin page opens with.
 *
 * `children` are the page's actions. They are authored as a plain row of
 * `<Button>`s and they stay that on a desktop; on a phone the row becomes a
 * horizontal scroller (`.strip`, globals.css) so five actions cost one line
 * instead of three and nothing is ever pushed out of reach.
 *
 * `primary` is the one action that must never need scrolling to. A scroller
 * solves the crowding but it also means whatever sits last is off-screen at
 * rest, and on Products that was "Add product" — the entire point of the page,
 * hidden behind a swipe. Passing it here pins it outside the scroller, so the
 * secondary actions slide underneath it and the CTA stays where the thumb
 * expects it. Above `md` there is room for everything and it simply joins the
 * end of the row, which is where it already was.
 */
export function PageHeader({
  title,
  backHref,
  backLabel,
  primary,
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  primary?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 md:mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="mb-1.5 -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {backLabel ?? "Back"}
        </Link>
      )}

      {/*
        Two shapes, not one that bends.

        Under `md` the title owns its line and the actions get theirs, because
        a phone has room for exactly one of them: squeezing "Orders" and three
        buttons onto 390px is what produced the clipped title and the
        half-visible "Create order" this was reported as. Above `md` they share
        a line with the actions pushed right, which is the desktop admin's
        established shape and the one `check:admin` measures the gutter against.
      */}
      <div className="md:flex md:flex-wrap md:items-center md:justify-between md:gap-3">
        {/* 20px — Shopify's page-title size. Was 22px, which the wider Work Sans
            pushed further still; with the UI face the smaller step holds the
            same hierarchy against 13px body copy. */}
        <h1 className="text-[1.25rem] font-semibold leading-tight tracking-[-0.012em] text-balance text-foreground">
          {title}
        </h1>

        {(children || primary) && (
          <div className="mt-3 flex items-center gap-2 md:mt-0">
            {children && (
              <div
                className={cn(
                  "strip min-w-0 flex-1 gap-2 md:flex-none",
                  // The bleed has to match whatever gutter the page is sitting
                  // in, or the first button lands off the page's left rule. The
                  // value comes from the layout's `px-4 md:px-8 xl:px-12`; above
                  // `md` the strip stops bleeding at all, so only the phone
                  // figure is ever used — it is a variable rather than an inline
                  // value so a header in a tighter gutter can override it.
                  "[--strip-gutter:--spacing(4)]",
                  primary && "strip-flush-end"
                )}
              >
                {children}
              </div>
            )}
            {primary && <div className="shrink-0">{primary}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
