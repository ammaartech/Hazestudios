import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Price display. A markdown is signalled with the sale colour plus a struck
 * original — colour alone never carries the meaning, so it stays legible for
 * colour-blind shoppers and in high-contrast modes.
 */
export function Price({
  amount,
  compareAt,
  currency = "USD",
  className,
}: {
  amount: number;
  compareAt?: number | null;
  currency?: string;
  className?: string;
}) {
  const onSale = compareAt != null && compareAt > amount;

  return (
    <span className={cn("inline-flex items-baseline gap-2 tabular-nums", className)}>
      <span className={cn(onSale && "text-[var(--shop-sale)]")}>
        {formatMoney(amount, currency)}
      </span>
      {onSale && (
        <>
          <span className="text-[var(--shop-mute)] line-through">
            {formatMoney(compareAt, currency)}
          </span>
          <span className="sr-only">
            Reduced from {formatMoney(compareAt, currency)}
          </span>
        </>
      )}
    </span>
  );
}
