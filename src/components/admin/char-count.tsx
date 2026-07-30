import { cn } from "@/lib/utils";

/**
 * Live character budget for a text field: muted while there is room, plain once
 * the last tenth is in play, destructive past the limit.
 *
 * Two near-identical copies of this already live under admin/products (one
 * exported from `sections/fields`, one private to `collections/collection-
 * sections`). This is the shared home for new callers; those two are left as
 * they are so their pages keep rendering exactly as before.
 */
export function CharCount({
  value,
  max,
  className,
}: {
  value: string;
  max: number;
  className?: string;
}) {
  const over = value.length > max;
  const near = !over && value.length > max * 0.9;
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        over
          ? "font-medium text-destructive"
          : near
            ? "text-foreground"
            : "text-muted-foreground",
        className
      )}
    >
      {value.length}/{max}
    </span>
  );
}
