import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading shapes.
 *
 * Every admin page is `force-dynamic`, so a click used to hang on a blank
 * screen until Supabase answered. These render instantly as the Suspense
 * fallback and are shaped like the content that replaces them, so the page
 * doesn't visibly re-flow on arrival.
 */

function HeaderSkeleton({ withActions = true }: { withActions?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Skeleton className="h-7 w-48" />
      {withActions && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <HeaderSkeleton />
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <div className="flex items-center gap-4 border-b border-border bg-muted/50 px-4 py-2.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
          >
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Mirrors the product editor's two-column split. */
export function EditorSkeleton() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <PanelSkeleton lines={2} />
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full rounded-lg" />
            </CardContent>
          </Card>
          <PanelSkeleton lines={2} />
          <PanelSkeleton lines={2} />
        </div>
        <div className="space-y-5">
          <PanelSkeleton lines={1} />
          <PanelSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}

/** Fallback for admin routes without a bespoke shape. */
export function PageSkeleton() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="grid gap-5 md:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
