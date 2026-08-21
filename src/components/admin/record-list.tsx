import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The phone shape of an admin list page.
 *
 * A seven-column orders table inside `overflow-x-auto` does not break the
 * layout on a 390px screen — it just becomes useless. The order number is
 * visible and everything that tells you *about* the order is off to the right,
 * so reading one row means swiping sideways and losing the row you were on.
 * Shopify's mobile admin does not scroll its tables either; it stacks each
 * record into a card, and that is what this is.
 *
 * Pages render both: `<RecordList>` under `md`, the real `<Table>` above it.
 * Duplicated markup, not duplicated data — the query, the sorting and the
 * pagination are shared, and only the presentation forks. Trying to serve both
 * from one markup tree means a table that pretends to be a list via CSS
 * `display` overrides, which loses the semantics a screen reader needs on the
 * desktop side.
 *
 * The whole card is one link, so the tap target is the row rather than the
 * ~19px of text inside it — the single most common reason a phone list feels
 * fiddly.
 */

export interface RecordListItem {
  id: string;
  href: string;
  /** Top line, bold — the thing you scan for. */
  title: React.ReactNode;
  /** Second line — a date, an email, a vendor. */
  subtitle?: React.ReactNode;
  /** Right-aligned top line, usually money. */
  amount?: React.ReactNode;
  /** Status pills, shown under the amount. */
  badges?: React.ReactNode;
  /** Optional leading visual, e.g. a product thumbnail. */
  media?: React.ReactNode;
}

export function RecordList({
  items,
  className,
}: {
  items: RecordListItem[];
  className?: string;
}) {
  return (
    <ul className={cn("-mx-2 divide-y md:hidden", className)}>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            // min-h-16 keeps every row comfortably past the 44px both mobile
            // platforms ask for, even when it holds a single short line.
            className="flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 active:bg-muted"
          >
            {item.media}

            {/*
              Stacked, not columnar.

              The first version put the title and subtitle in a left column and
              the amount and status pills in a right one, which reads fine in a
              mockup and fails on a real record: two status pills are about
              210px wide, so on a 390px screen the left column collapsed and
              "aarav awate · Aug 20" truncated to "aarav aw…". Giving each
              element a full-width line instead means the amount sits on the
              title's baseline where it is easy to compare down the column, the
              subtitle gets the whole row, and the pills wrap underneath
              whenever there are more than one.
            */}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] font-medium text-foreground">
                  {item.title}
                </span>
                {item.amount && (
                  <span className="shrink-0 text-[14px] font-medium tabular-nums text-foreground">
                    {item.amount}
                  </span>
                )}
              </span>

              {item.subtitle && (
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {item.subtitle}
                </span>
              )}

              {item.badges && (
                <span className="mt-1.5 flex flex-wrap items-center gap-1">
                  {item.badges}
                </span>
              )}
            </span>

            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Wraps a desktop `<Table>` so it disappears on phones.
 *
 * A component rather than `className="hidden md:block"` at each call site,
 * because `Table` renders its own scroll container and the class would land on
 * the `<table>` inside it — leaving the container, its border and its padding
 * visible above the card list.
 */
export function DesktopTable({ children }: { children: React.ReactNode }) {
  return <div className="hidden md:block">{children}</div>;
}
