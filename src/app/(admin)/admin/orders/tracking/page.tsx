import Link from "next/link";
import { AlertTriangle, ExternalLink, PackageCheck, Truck, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { StageBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getQikinkStatus } from "@/lib/qikink/config";
import { stageLabel } from "@/lib/qikink/status";
import {
  getTrackedOrders,
  getTrackingCounts,
  type TrackingTab,
} from "@/lib/qikink/tracking";
import { Pagination } from "@/components/admin/pagination";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Delivery tracking" };

/**
 * Delivery tracking.
 *
 * Not a mirror of Qikink's order table — that already exists, in Qikink. This
 * page answers the question their dashboard does not: *which of these is going
 * wrong?* So it opens on "Needs attention" rather than "All", and every order
 * carries the reason it is being shown.
 *
 * Reads stored fulfillment rows only; it does not call Qikink. Pulling the
 * whole account takes ~13s (see the note in the component), which is not a
 * price to pay on every visit and every tab click — "Sync now" does that
 * explicitly and revalidates this route.
 *
 * Dynamic by construction: the rows are per-request and staff-scoped, so there
 * is nothing to cache. No route config says so — under Cache Components (see
 * next.config.ts) pages are dynamic unless they opt into `use cache`, and
 * `force-dynamic` is now a build error rather than a no-op.
 */

const PAGE_SIZE = 50;

const TABS: { label: string; value: string | undefined }[] = [
  { label: "Needs attention", value: undefined },
  { label: "In flight", value: "in_flight" },
  { label: "Not sent", value: "not_sent" },
  { label: "On hold", value: "on_hold" },
  { label: "In production", value: "in_production" },
  { label: "Picked up", value: "picked_up" },
  { label: "In transit", value: "in_transit" },
  { label: "Out for delivery", value: "out_for_delivery" },
  { label: "Delivered", value: "delivered" },
  { label: "Returned", value: "rto" },
  { label: "All", value: "all" },
];

/** The tab param is user input; anything unrecognised falls back to the default. */
const KNOWN = new Set(TABS.map((t) => t.value).filter(Boolean) as string[]);

function toTab(value: string | undefined): TrackingTab {
  if (!value || !KNOWN.has(value)) return "attention";
  return value as TrackingTab;
}

export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab, page: pageParam } = await searchParams;
  const supabase = await createClient();

  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  const qikink = await getQikinkStatus();

  // Deliberately NOT synced here.
  //
  // This page used to await `syncAllQikinkOrders()` before rendering anything,
  // on the reasoning that a table claiming to mirror Qikink should not show a
  // stale one. That was affordable when a sync was a single request. It is not
  // now: Qikink paginates ten orders to a page with about a second of latency
  // each, so a full refresh of this account measures ~13s even fetched six
  // pages at a time — 48s serially. Every visit paid that before the first row
  // appeared, and paid it again on every tab click.
  //
  // The stored rows are already the answer. They are written by the same sync,
  // they carry `synced_at`, and the header shows how old they are, so nothing
  // is being hidden — the page just stops pretending it must re-derive the
  // whole account to show what it already knows. Refreshing is now the explicit
  // job of "Sync now", which reports what changed and revalidates this route.
  const [result, counts] = await Promise.all([
    getTrackedOrders(supabase, { tab: toTab(tab), limit: PAGE_SIZE, page }),
    getTrackingCounts(supabase),
  ]);

  const visible = result.orders;
  const lastSyncedAt = visible.reduce<string | null>(
    (latest, o) => (o.syncedAt && (!latest || o.syncedAt > latest) ? o.syncedAt : latest),
    null
  );

  return (
    <div>
      <PageHeader title="Delivery tracking" backHref="/admin/orders" backLabel="Orders">
        <SyncButton lastSyncedAt={lastSyncedAt} />
      </PageHeader>

      {!qikink.configured || !qikink.enabled ? (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p className="text-amber-900">
              Qikink is not connected, so nothing here can update.{" "}
              <Link href="/admin/settings/qikink" className="font-medium underline">
                Connect it in Settings
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat
          icon={<AlertTriangle className="size-4 text-red-600" />}
          label="Needs attention"
          // Only known while the attention tab is the one being rendered — it
          // is the only view that evaluates the staleness rules. Other tabs
          // show a dash rather than a number that would be quietly wrong.
          value={toTab(tab) === "attention" ? result.total : null}
          hint={toTab(tab) === "attention" ? undefined : "open the tab to count"}
        />
        <Stat
          icon={<Truck className="size-4 text-blue-600" />}
          label="In flight"
          value={counts.inFlight}
          hint="Not yet delivered"
        />
        <Stat
          icon={<PackageCheck className="size-4 text-emerald-600" />}
          label="Delivered"
          value={counts.delivered}
          hint={`of ${counts.total} orders`}
        />
        <Stat
          icon={<Undo2 className="size-4 text-red-600" />}
          label="Returned"
          value={counts.rto}
          hint="RTO"
        />
      </div>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <FilterTabs
              basePath="/admin/orders/tracking"
              param="tab"
              current={tab}
              tabs={TABS}
            />
          </div>

          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {tab === undefined
                ? "Nothing needs attention — every order is moving as expected."
                : `No orders at “${labelFor(tab)}”.`}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${o.orderId}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        #{o.orderNumber}
                      </Link>
                      {o.alert && (
                        <p
                          className={
                            o.alert.level === "critical"
                              ? "mt-1 text-xs text-red-700"
                              : "mt-1 text-xs text-amber-700"
                          }
                        >
                          {o.alert.reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(o.createdAt)}
                    </TableCell>
                    <TableCell>{o.customerName}</TableCell>
                    <TableCell>
                      <StageBadge stage={o.stage} />
                      {/* Qikink's own wording, kept alongside our stage: when a
                          mapping is wrong this is the only thing that shows it. */}
                      {o.qikinkStatus && stageLabel(o.stage) !== o.qikinkStatus && (
                        <p className="mt-1 text-xs text-muted-foreground">{o.qikinkStatus}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {o.awb ? (
                        o.trackingUrl ? (
                          <a
                            href={o.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            {o.awb}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="tabular-nums">{o.awb}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.paymentMethod === "cod" ? "COD" : o.paymentMethod ? "Prepaid" : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(o.total, o.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}

function labelFor(tab: string): string {
  return TABS.find((t) => t.value === tab)?.label ?? tab;
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  /** null renders a dash — a count we cannot compute in this view. */
  value: number | null;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {value ?? "—"}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
