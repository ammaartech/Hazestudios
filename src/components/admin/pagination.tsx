"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Server-side pager driven by a `page` search param.
 *
 * The admin's other lists page in the client after loading every row, which
 * cannot work past PostgREST's 1,000-row ceiling — a 3,952-row table silently
 * renders its first 1,000 and calls it the whole list. Paging through the URL
 * keeps the query bounded and the position shareable.
 */
export function Pagination({
  page,
  pageSize,
  total,
  className,
}: {
  /** Zero-based. */
  page: number;
  pageSize: number;
  total: number;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (total <= pageSize) return null;

  function href(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    // Page 1 is the bare URL — a `?page=0` in the address bar is noise.
    if (next <= 0) params.delete("page");
    else params.set("page", String(next));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-t pt-3",
        className
      )}
    >
      {/* Split rather than a single `asChild={…}` button: `disabled` forwarded
          through Slot would land on an anchor, which React rejects. */}
      <Step
        direction="prev"
        href={page > 0 ? href(page - 1) : null}
        label="Previous page"
      />

      <span className="text-xs tabular-nums text-muted-foreground">
        {first}–{last} of {total.toLocaleString()}
      </span>

      <Step
        direction="next"
        href={page < lastPage ? href(page + 1) : null}
        label="Next page"
      />
    </div>
  );
}

/** A pager arrow: a link when there is somewhere to go, a dead button when not. */
function Step({
  direction,
  href,
  label,
}: {
  direction: "prev" | "next";
  href: string | null;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  if (!href) {
    return (
      <Button variant="outline" size="icon-sm" disabled aria-label={label}>
        <Icon className="size-4" />
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon-sm" asChild aria-label={label}>
      <Link href={href} scroll={false}>
        <Icon className="size-4" />
      </Link>
    </Button>
  );
}
