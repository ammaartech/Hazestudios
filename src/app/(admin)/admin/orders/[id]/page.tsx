import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
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
import { paymentMethodLabel } from "@/lib/shop/payment-methods";
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
  OrderActionsMenu,
  RefundDialog,
} from "./order-actions";
import { OrderNotes, type OrderNote } from "./order-notes";
import { getQikinkStatus } from "@/lib/qikink/config";
import { getFulfillment } from "@/lib/qikink/fulfillment";
import { QikinkCard } from "./qikink-card";

export const metadata = { title: "Order" };
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
    { data: notesData },
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
    supabase
      .from("order_notes")
      .select("id, body, author_email, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!orderData) notFound();

  // Read after the order exists: both go through the service-role client, and
  // there is no point paying for them on a 404.
  const [qikinkStatus, qikinkFulfillment] = await Promise.all([
    getQikinkStatus(),
    getFulfillment(id),
  ]);

  const order = orderData as Order & { customers: Customer | null };
  const items = (itemsData ?? []) as OrderItem[];

  /**
   * One thumbnail per line, keyed by product.
   *
   * Fetched in a single query after the items rather than embedded in the
   * `order_items` select: the join would be per-line, and an order with the
   * same product twice would pull the same image rows twice. Position 0 is the
   * product's primary shot, which is the one the catalogue shows.
   *
   * Deliberately not variant-specific — `order_items` carries no image and the
   * variant's own shot is not modelled, so the product image is the honest
   * answer rather than a guess at which colourway shipped.
   */
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];
  const { data: imageRows } = productIds.length
    ? await supabase
        .from("product_images")
        .select("product_id, url, alt, position")
        .in("product_id", productIds)
        .order("position")
    : { data: [] as { product_id: string; url: string; alt: string | null }[] };

  const imageByProduct = new Map<string, { url: string; alt: string | null }>();
  for (const row of (imageRows ?? []) as { product_id: string; url: string; alt: string | null }[]) {
    if (!imageByProduct.has(row.product_id)) {
      imageByProduct.set(row.product_id, { url: row.url, alt: row.alt });
    }
  }
  const fulfillments = (fulfillmentsData ?? []) as Fulfillment[];
  const refunds = (refundsData ?? []) as Refund[];
  const notes = (notesData ?? []) as OrderNote[];
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
            {order.payment_status === "pending" && !order.cancelled_at && (
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
            {order.fulfillment_status !== "fulfilled" &&
              order.fulfillment_status !== "restocked" &&
              order.payment_status !== "voided" &&
              !order.cancelled_at && <FulfillDialog orderId={order.id} />}
            <OrderActionsMenu
              orderId={order.id}
              cancelled={Boolean(order.cancelled_at)}
            />
          </>
        )}
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {order.is_draft ? (
          <Badge variant="secondary">Draft</Badge>
        ) : (
          <>
            {/* First, and destructive-coloured: once an order is cancelled that
                fact outranks how it was paid or fulfilled. */}
            {order.cancelled_at && <Badge variant="destructive">Cancelled</Badge>}
            <PaymentBadge status={order.payment_status} />
            <FulfillmentBadge status={order.fulfillment_status} />
            {/* How the shopper chose to pay, which is not the same question as
                whether they have. Absent on everything placed before the
                checkout offered a choice. */}
            {paymentMethodLabel(order.payment_method) && (
              <Badge variant="outline">
                {paymentMethodLabel(order.payment_method)}
              </Badge>
            )}
          </>
        )}
        <span className="text-sm text-muted-foreground">
          Placed {formatDateTime(order.created_at)}
        </span>
      </div>

      {/* Narrower than the shell's max-w-6xl and centred within it.
          An order is read top-to-bottom like a document — line items, money,
          then the aside — and at full width the summary column drifts to the
          far edge of a large monitor, far from the items it describes. Capping
          the pair keeps them within one comfortable scan. */}
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {items.map((item) => {
                  const image = item.product_id ? imageByProduct.get(item.product_id) : null;
                  return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {/* Fixed 48px box whether or not an image exists, so the
                          titles stay on one vertical line down the list. A
                          product with no shot gets a neutral placeholder rather
                          than collapsing the column. */}
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted">
                        {image ? (
                          <Image
                            src={image.url}
                            alt={image.alt ?? item.title_snapshot}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-muted-foreground">
                            <Package className="size-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                      <p className="font-medium">
                        {item.product_id ? (
                          <Link
                            href={`/admin/products/${item.product_id}`}
                            className="transition-colors duration-150 hover:text-primary hover:underline"
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
                  );
                })}
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
                {Number(order.prepaid_discount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Prepaid discount (5%)
                    </span>
                    <span className="tabular-nums">
                      −{formatMoney(order.prepaid_discount)}
                    </span>
                  </div>
                )}
                {/* Present on every storefront order since 0014; admin-created
                    orders still default both to zero, so they stay hidden there
                    rather than adding two "—" rows to every draft. */}
                {Number(order.shipping_total) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="tabular-nums">
                      {formatMoney(order.shipping_total)}
                    </span>
                  </div>
                )}
                {Number(order.tax_total) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="tabular-nums">{formatMoney(order.tax_total)}</span>
                  </div>
                )}
                {/* The courier collects this alongside the goods — it is inside
                    the total Qikink is told to collect, not a separate charge
                    the operator has to remember. */}
                {Number(order.cod_fee) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">COD fee</span>
                    <span className="tabular-nums">{formatMoney(order.cod_fee)}</span>
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

          {/* Only once the integration is switched on — an unconfigured store
              should not carry a card for a supplier it does not use. */}
          {qikinkStatus.enabled && qikinkStatus.configured && (
            <QikinkCard
              orderId={order.id}
              fulfillment={qikinkFulfillment}
              isDraft={order.is_draft}
            />
          )}

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

          {/* Last in the main column: notes are written after reading the order
              above them, and they grow unbounded, so anything below would drift
              further down the page with every note added. */}
          <OrderNotes orderId={order.id} notes={notes} />
        </div>

        {/* `min-w-0` on the aside, and `break-words` on the values inside it.
            A long email or a single unbroken address line is wider than the
            300px track, and a grid item's default `min-width: auto` refuses to
            shrink below its content — so the column silently grew past the
            container and overflowed the page. */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {customer ? (
                <div className="space-y-1">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="break-words font-medium text-primary hover:underline"
                  >
                    {`${customer.first_name} ${customer.last_name}`.trim() ||
                      customer.email}
                  </Link>
                  {customer.email && (
                    <p className="break-words text-muted-foreground">{customer.email}</p>
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

          {/* Contact on the order, not on the customer. These are the values
              captured at purchase and are what the parcel and the receipt have
              to match, even after the customer record moves on. */}
          {(order.email || order.shipping_address?.address1) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {order.email && (
                  <div>
                    <p className="text-xs text-muted-foreground">Contact</p>
                    <p className="break-words">{order.email}</p>
                    {order.phone && <p className="break-words">{order.phone}</p>}
                  </div>
                )}

                {order.shipping_address?.address1 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Ship to</p>
                    <address className="not-italic leading-relaxed">
                      {[
                        order.shipping_address.first_name,
                        order.shipping_address.last_name,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      <br />
                      {order.shipping_address.address1}
                      {order.shipping_address.address2 && (
                        <>
                          <br />
                          {order.shipping_address.address2}
                        </>
                      )}
                      <br />
                      {[
                        order.shipping_address.city,
                        order.shipping_address.province,
                        order.shipping_address.postal_code,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      <br />
                      {order.shipping_address.country}
                    </address>
                  </div>
                )}

                {Object.keys(order.billing_address ?? {}).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Bill to</p>
                    <address className="not-italic leading-relaxed">
                      {order.billing_address.address1}
                      <br />
                      {[
                        order.billing_address.city,
                        order.billing_address.postal_code,
                        order.billing_address.country,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </address>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Where this order came from. Only rendered for orders that carry
              attribution — an admin-created order has none by definition, and a
              card of empty rows is worse than no card. */}
          {(order.source === "storefront" || order.marketing_opt_in) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Source</span>
                  <span className="capitalize">{order.source}</span>
                </div>

                {Object.entries(order.utm ?? {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <span className="text-muted-foreground capitalize">{key}</span>
                    <span className="truncate" title={value}>
                      {value}
                    </span>
                  </div>
                ))}

                {order.referrer && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Referrer</span>
                    <span className="truncate" title={order.referrer}>
                      {order.referrer.replace(/^https?:\/\/(www\.)?/, "")}
                    </span>
                  </div>
                )}

                {order.landing_path && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Landed on</span>
                    <span className="truncate" title={order.landing_path}>
                      {order.landing_path}
                    </span>
                  </div>
                )}

                <div className="flex justify-between gap-3 border-t pt-2">
                  <span className="text-muted-foreground">Email marketing</span>
                  {order.marketing_opt_in ? (
                    <Badge variant="secondary">Opted in</Badge>
                  ) : (
                    <span className="text-muted-foreground">Declined</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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
