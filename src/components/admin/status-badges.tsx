import { cn } from "@/lib/utils";
import type {
  DiscountStatus,
  FulfillmentStatus,
  PaymentStatus,
  ProductStatus,
} from "@/lib/types";
import type { QikinkStage } from "@/lib/qikink/status";

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

type Variant = { label: string; pill: string; dot: string };

/**
 * The status enums are additive — migrations have grown them before (0017 added
 * `voided`, `partially_paid`, `restocked`) and will again. A value this file has
 * not learned yet renders as a neutral pill instead of throwing and taking the
 * whole orders table down with it.
 */
function resolve<T extends string>(map: Record<T, Variant>, status: T): Variant {
  return (
    map[status] ?? {
      label: status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      pill: "bg-neutral-200 text-neutral-800",
      dot: "bg-neutral-500",
    }
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, Variant> = {
    pending: { label: "Payment pending", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
    partially_paid: { label: "Partially paid", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
    paid: { label: "Paid", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    partially_refunded: { label: "Partially refunded", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    refunded: { label: "Refunded", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    voided: { label: "Voided", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = resolve(map, status);
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  const map: Record<FulfillmentStatus, Variant> = {
    unfulfilled: { label: "Unfulfilled", pill: "bg-yellow-100 text-yellow-900", dot: "bg-yellow-500" },
    partial: { label: "Partially fulfilled", pill: "bg-orange-100 text-orange-900", dot: "bg-orange-500" },
    fulfilled: { label: "Fulfilled", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    restocked: { label: "Restocked", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = resolve(map, status);
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const map: Record<ProductStatus, Variant> = {
    active: { label: "Active", pill: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500" },
    draft: { label: "Draft", pill: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
    archived: { label: "Archived", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = resolve(map, status);
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

export function DiscountStatusBadge({ status }: { status: DiscountStatus }) {
  const map: Record<DiscountStatus, Variant> = {
    active: { label: "Active", pill: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500" },
    scheduled: { label: "Scheduled", pill: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
    expired: { label: "Expired", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    disabled: { label: "Disabled", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
  };
  const s = resolve(map, status);
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}

/**
 * Delivery stage from Qikink. Follows the same `resolve` fallback as the rest:
 * a stage this file has not learned yet renders neutral rather than throwing.
 *
 * The colour runs cool→warm along the journey and red at the ends that need
 * action, so a column of these is scannable without reading a single label.
 */
export function StageBadge({ stage }: { stage: QikinkStage }) {
  const map: Record<QikinkStage, Variant> = {
    not_sent: { label: "Not sent", pill: "bg-red-100 text-red-900", dot: "bg-red-500" },
    created: { label: "Created", pill: "bg-neutral-200 text-neutral-800", dot: "bg-neutral-500" },
    // Amber, not neutral: Qikink has the order but is not printing it, and it
    // stays that way until someone clears the hold in their dashboard.
    on_hold: { label: "On hold", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
    in_production: { label: "In production", pill: "bg-violet-100 text-violet-900", dot: "bg-violet-500" },
    picked_up: { label: "Picked up", pill: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
    in_transit: { label: "In transit", pill: "bg-blue-100 text-blue-900", dot: "bg-blue-500" },
    out_for_delivery: { label: "Out for delivery", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
    delivered: { label: "Delivered", pill: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500" },
    rto: { label: "Returned (RTO)", pill: "bg-red-100 text-red-900", dot: "bg-red-500" },
    cancelled: { label: "Cancelled", pill: "bg-red-100 text-red-900", dot: "bg-red-500" },
    unknown: { label: "Unknown", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  };
  const s = resolve(map, stage);
  return (
    <Pill className={s.pill}>
      <Dot className={s.dot} />
      {s.label}
    </Pill>
  );
}
