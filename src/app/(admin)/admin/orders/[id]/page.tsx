import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import type {
  Customer,
  Fulfillment,
  Order,
  OrderItem,
  Refund,
} from "@/lib/types";
import {
  ConvertDraftButton,
  DeleteOrderButton,
  FulfillDialog,
  MarkPaidButton,
  RefundDialog,
} from "./order-actions";

export const metadata = { title: "Order" };
export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: orderData },
    { data: itemsData },
    { data: fulfillmentsData },
    { data: refundsData },
  ] = await Promise.all([
    supabase.from("orders").select("*, customers(*)").eq("id", id).single(),
    supabase.from("order_items").select("*").eq("order_id", id),
    supabase
      .from("fulfillments")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("refunds")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!orderData) notFound();
  const order = orderData as Order & { customers: Customer | null };
  const items = (itemsData ?? []) as OrderItem[];
  const fulfillments = (fulfillmentsData ?? []) as Fulfillment[];
  const refunds = (refundsData ?? []) as Refund[];
  const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const customer = order.customers;

  return (
    <div>
      <PageHeader
        title={`${order.is_draft ? "Draft " : ""}#${order.is_draft ? "D" : ""}${order.order_number}`}
        backHref={order.is_draft ? "/admin/orders/drafts" : "/admin/orders"}
        backLabel={order.is_draft ? "Drafts" : "Orders"}
      >
        {order.is_draft ? (
          <>
            <DeleteOrderButton orderId={order.id} />
            <ConvertDraftButton orderId={order.id} />
          </>
        ) : (
          <>
            {order.payment_status === "pending" && (
              <MarkPaidButton orderId={order.id} />
            )}
            {(order.payment_status === "paid" ||
              order.payment_status === "partially_refunded") &&
              refunded < Number(order.total) && (
                <RefundDialog
                  orderId={order.id}
                  maxAmount={Number(order.total) - refunded}
                />
              )}
            {order.fulfillment_status !== "fulfilled" && (
              <FulfillDialog orderId={order.id} />
            )}
          </>
        )}
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {order.is_draft ? (
          <Badge variant="secondary">Draft</Badge>
        ) : (
          <>
            <PaymentBadge status={order.payment_status} />
            <FulfillmentBadge status={order.fulfillment_status} />
          </>
        )}
        <span className="text-sm text-muted-foreground">
          Placed {formatDateTime(order.created_at)}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">
                        {item.product_id ? (
                          <Link
                            href={`/products/${item.product_id}`}
                            className="hover:underline"
                          >
                            {item.title_snapshot}
                          </Link>
                        ) : (
                          item.title_snapshot
                        )}
                      </p>
                      {item.variant_snapshot && (
                        <p className="text-xs text-muted-foreground">
                          {item.variant_snapshot}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      <p>
                        {formatMoney(item.price_snapshot)} × {item.quantity}
                      </p>
                      <p className="font-medium">
                        {formatMoney(Number(item.price_snapshot) * item.quantity)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-1.5 border-t pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatMoney(order.subtotal)}</span>
                </div>
                {Number(order.discount_total) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Discount{order.discount_code ? ` (${order.discount_code})` : ""}
                    </span>
                    <span className="tabular-nums">
                      −{formatMoney(order.discount_total)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(order.total)}</span>
                </div>
                {refunded > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Refunded</span>
                    <span className="tabular-nums">−{formatMoney(refunded)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {fulfillments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fulfillments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fulfillments.map((f) => (
                  <div key={f.id} className="flex justify-between">
                    <span>
                      {f.carrier || "Shipment"}
                      {f.tracking_number && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {f.tracking_number}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(f.created_at)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {refunds.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Refunds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {refunds.map((r) => (
                  <div key={r.id} className="flex justify-between">
                    <span>
                      {formatMoney(r.amount)}
                      {r.reason && (
                        <span className="ml-2 text-muted-foreground">
                          {r.reason}
                        </span>
                      )}
                      {r.restock && (
                        <Badge variant="secondary" className="ml-2">
                          Restocked
                        </Badge>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(r.created_at)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {customer ? (
                <div className="space-y-1">
                  <Link
                    href={`/customers/${customer.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {`${customer.first_name} ${customer.last_name}`.trim() ||
                      customer.email}
                  </Link>
                  {customer.email && (
                    <p className="text-muted-foreground">{customer.email}</p>
                  )}
                  {customer.phone && (
                    <p className="text-muted-foreground">{customer.phone}</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">No customer attached.</p>
              )}
            </CardContent>
          </Card>

          {order.note && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Note</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {order.note}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
