import { cn } from "@/lib/utils";
import type {
  DiscountStatus,
  FulfillmentStatus,
  PaymentStatus,
  ProductStatus,
} from "@/lib/types";

function Dot({ className }: { className?: string }) {
  return <span className={cn("size-1.5 rounded-full", className)} />;
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { label: string; pill: string; dot: string }> = {
    pending: { label: "Payment pending", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
    paid: { label: "Paid", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    partially_refunded: { label: "Partially refunded", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    refunded: { label: "Refunded", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = map[status];
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  const map: Record<FulfillmentStatus, { label: string; pill: string; dot: string }> = {
    unfulfilled: { label: "Unfulfilled", pill: "bg-yellow-100 text-yellow-900", dot: "bg-yellow-500" },
    partial: { label: "Partially fulfilled", pill: "bg-orange-100 text-orange-900", dot: "bg-orange-500" },
    fulfilled: { label: "Fulfilled", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = map[status];
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const map: Record<ProductStatus, { label: string; pill: string; dot: string }> = {
    active: { label: "Active", pill: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500" },
    draft: { label: "Draft", pill: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
    archived: { label: "Archived", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = map[status];
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function DiscountStatusBadge({ status }: { status: DiscountStatus }) {
  const map: Record<DiscountStatus, { label: string; pill: string; dot: string }> = {
    active: { label: "Active", pill: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500" },
    scheduled: { label: "Scheduled", pill: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
    expired: { label: "Expired", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    disabled: { label: "Disabled", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = map[status];
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}
