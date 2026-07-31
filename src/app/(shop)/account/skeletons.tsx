import { cn } from "@/lib/utils";

/**
 * Loading-state placeholders, shaped like the real account content.
 *
 * These back route-level `loading.tsx` files, which Next mounts instantly —
 * inside the same `AccountShell`/`AccountNav` the real page uses — while the
 * signed-in session and Supabase query it depends on are still in flight.
 * Because the shell and nav are identical on both sides, only the content
 * area swaps: no reflow, no chrome flash, just bars resolving into text.
 */

function Bar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-full bg-(--shop-hairline-soft)", className)}
    />
  );
}

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("glass glass-on-light glass-panel p-5", className)}>
      {children}
    </div>
  );
}

export function TitleSkeleton() {
  return <Bar className="h-9 w-48 md:h-12 md:w-64" />;
}

function OrderCardSkeleton() {
  return (
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-4 w-32" />
          <Bar className="h-3 w-44" />
        </div>
        <Bar className="h-6 w-20 rounded-full" />
      </div>
      <div className="flex gap-2">
        <Bar className="size-14 rounded-none" />
        <Bar className="size-14 rounded-none" />
      </div>
    </Panel>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Panel key={i} className="space-y-3">
            <Bar className="h-2.5 w-20" />
            <Bar className="h-7 w-14" />
          </Panel>
        ))}
      </div>
      <div className="space-y-4">
        <Bar className="h-2.5 w-28" />
        <OrderCardSkeleton />
        <OrderCardSkeleton />
      </div>
    </div>
  );
}

export function OrdersSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <OrderCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Bar className="-mt-4 mb-2 h-3 w-24" />
      <Panel className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Bar className="h-3 w-28" />
          <Bar className="h-5 w-20" />
        </div>
        <Bar className="h-6 w-24 rounded-full" />
      </Panel>
      <Panel className="space-y-0 divide-y divide-(--shop-hairline-soft) p-0">
        <div className="p-5">
          <Bar className="h-2.5 w-16" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 p-5">
            <Bar className="size-16 shrink-0 rounded-none" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-40" />
              <Bar className="h-3 w-24" />
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Panel className="space-y-2">
        <Bar className="h-2.5 w-14" />
        <Bar className="h-4 w-48" />
      </Panel>
      <Panel className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Bar className="h-2.5 w-20" />
            <Bar className="h-10 w-full rounded-none" />
          </div>
        ))}
      </Panel>
    </div>
  );
}

export function HelpSkeleton() {
  return (
    <div className="space-y-10">
      <Panel className="flex gap-3">
        <Bar className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Bar className="h-4 w-32" />
          <Bar className="h-3 w-48" />
        </div>
      </Panel>
      {Array.from({ length: 2 }).map((_, sectionIdx) => (
        <div key={sectionIdx} className="space-y-3">
          <Bar className="h-2.5 w-24" />
          <Panel className="divide-y divide-(--shop-hairline-soft) p-0">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-5">
                <Bar className="h-4 w-52" />
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </div>
  );
}
