import Link from "next/link";
import { AlertTriangle, ExternalLink, PackageCheck, Truck, Undo2 } from "lucide-react";
import { RowLink } from "@/components/admin/row-link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { DesktopTable, RecordList } from "@/components/admin/record-list";
import { FilterTabs } from "@/components/admin/filter-tabs";
import { Pagination } from "@/components/admin/pagination";
import { ShipmentStageBadge } from "@/components/admin/status-badges";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getCourierStatus } from "@/lib/couriers/config";
import { COURIERS, serviceLabel, type CourierProvider } from "@/lib/couriers/providers";
import { getTrackingCounts, listTrackedShipments, type ShipmentTab } from "@/lib/couriers/shipments";
import { carrierBySlug } from "@/lib/delivery/carriers";
import { CarrierSetup } from "./carrier-setup";
import { CarrierTabs } from "./carrier-tabs";
import { CourierSyncButton } from "./courier-sync-button";

/**
 * Delivery tracking for a courier the store books itself.
 *
 * One component for both couriers, because their shipments share a table and a
 * stage model (`src/lib/couriers`); the two route files only pick the
 * provider. Same posture as the Qikink page: it opens on "Needs attention",
 * every row carries the reason it is shown, and it reads stored rows only —
 * "Sync now" is what calls the courier, one request per parcel in flight.
 */

const PAGE_SIZE = 50;

const TABS: { label: string; value: string | undefined }[] = [
  { label: "Needs attention", value: undefined },
  { label: "In flight", value: "in_flight" },
  { label: "Booked", value: "booked" },
  { label: "Picked up", value: "picked_up" },
  { label: "In transit", value: "in_transit" },
  { label: "Out for delivery", value: "out_for_delivery" },
  { label: "Delivered", value: "delivered" },
  { label: "Undelivered", value: "undelivered" },
  { label: "Returned", value: "rto" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Failed", value: "failed" },
  { label: "All", value: "all" },
];

const KNOWN = new Set(TABS.map((t) => t.value).filter(Boolean) as string[]);

function toTab(value: string | undefined): ShipmentTab {
  if (!value || !KNOWN.has(value)) return "attention";
  return value as ShipmentTab;
}

export async function CourierTrackingPage({
  provider,
  searchParams,
}: {
  provider: CourierProvider;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab, page: pageParam } = await searchParams;
  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);
  const meta = COURIERS[provider];
  const carrier = carrierBySlug(provider);
  const basePath = `/admin/orders/tracking/${provider}`;

  const [status, result, counts] = await Promise.all([
    getCourierStatus(provider),
    listTrackedShipments(provider, { tab: toTab(tab), page, pageSize: PAGE_SIZE }),
    getTrackingCounts(provider),
  ]);

  const connected = status.configured && status.enabled;
  const visible = result.shipments;
  const lastSyncedAt = visible.reduce<string | null>(
    (latest, s) => (s.synced_at && (!latest || s.synced_at > latest) ? s.synced_at : latest),
    null
  );

  return (
    <div>
      <PageHeader
        title={`Delivery tracking — ${meta.name}`}
        backHref="/admin/orders"
        backLabel="Orders"
        primary={<CourierSyncButton provider={provider} lastSyncedAt={lastSyncedAt} disabled={!connected} />}
      />
      <CarrierTabs current={provider} />

      {!connected && counts.total === 0 && carrier ? (
        <CarrierSetup carrier={carrier} />
      ) : (
        <>
          {!connected && (
            <Card className="mb-4 border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 py-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="text-amber-900">
                  {meta.name} is not connected, so nothing here can update.{" "}
                  <Link href={meta.settingsHref} className="font-medium underline">
                    Connect it in Settings
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat
              icon={<AlertTriangle className="size-4 text-red-600" />}
              label="Needs attention"
              value={toTab(tab) === "attention" ? result.total : null}
              hint={toTab(tab) === "attention" ? undefined : "open the tab to count"}
            />
            <Stat icon={<Truck className="size-4 text-blue-600" />} label="In flight" value={counts.inFlight} hint="Booked, not yet delivered" />
            <Stat icon={<PackageCheck className="size-4 text-emerald-600" />} label="Delivered" value={counts.delivered} hint={`of ${counts.total} booked`} />
            <Stat icon={<Undo2 className="size-4 text-red-600" />} label="Returned" value={counts.rto} hint="RTO" />
          </div>

          <Card>
            <CardContent className="pt-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <FilterTabs basePath={basePath} param="tab" current={tab} tabs={TABS} />
              </div>

              {visible.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {tab === undefined
                    ? counts.total === 0
                      ? `No parcels booked with ${meta.name} yet. Book one from an order's Ship now button.`
                      : "Nothing needs attention — every parcel is moving as expected."
                    : `No shipments at “${TABS.find((t) => t.value === tab)?.label ?? tab}”.`}
                </p>
              ) : (
                <>
                  <RecordList
                    items={visible.map((s) => ({
                      id: s.id,
                      href: `/admin/orders/${s.order_id}`,
                      title: `#${s.orderNumber}`,
                      subtitle: `${s.customerName}${s.awb ? ` · ${s.awb}` : ""}`,
                      amount: formatMoney(s.orderTotal, s.currency),
                      badges: (
                        <>
                          <ShipmentStageBadge stage={s.status === "booked" ? s.stage : s.status === "cancelled" ? "cancelled" : "not_booked"} />
                          {s.alert && (
                            <span className={s.alert.level === "critical" ? "text-[12px] text-red-700" : "text-[12px] text-amber-700"}>
                              {s.alert.reason}
                            </span>
                          )}
                        </>
                      ),
                    }))}
                  />
                  <DesktopTable>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead>Booked</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>{meta.awbLabel}</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Payment</TableHead>
                          <TableHead>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <RowLink href={`/admin/orders/${s.order_id}`} className="font-semibold text-foreground hover:underline">
                                #{s.orderNumber}
                              </RowLink>
                              {s.alert && (
                                <p className={s.alert.level === "critical" ? "mt-1 text-xs text-red-700" : "mt-1 text-xs text-amber-700"}>
                                  {s.alert.reason}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDateTime(s.booked_at ?? s.created_at)}
                            </TableCell>
                            <TableCell>{s.customerName}</TableCell>
                            <TableCell>
                              <ShipmentStageBadge stage={s.status === "booked" ? s.stage : s.status === "cancelled" ? "cancelled" : "not_booked"} />
                              {s.provider_status && <p className="mt-1 text-xs text-muted-foreground">{s.provider_status}</p>}
                            </TableCell>
                            <TableCell>
                              {s.awb ? (
                                s.tracking_url ? (
                                  <a
                                    href={s.tracking_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                                  >
                                    {s.awb}
                                    <ExternalLink className="size-3" />
                                  </a>
                                ) : (
                                  <span className="tabular-nums">{s.awb}</span>
                                )
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{serviceLabel(provider, s.service)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {s.payment_mode === "cod" ? `COD ${formatMoney(s.collectable_amount, s.currency)}` : "Prepaid"}
                            </TableCell>
                            <TableCell className="tabular-nums">{formatMoney(s.orderTotal, s.currency)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </DesktopTable>
                </>
              )}

              <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number | null; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value ?? "—"}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
