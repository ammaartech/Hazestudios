import Image from "next/image";
import Link from "next/link";
import { Package, ChevronLeft, ChevronUp, ChevronDown, Truck, Tag, MapPin, ReceiptText, Globe, MousePointerClick } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DetailEditor, CustomerMenu, RequestFulfillment, Metafields } from "./detail-controls";
import "./order-detail.css";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import { isCodMethod, paymentMethodLabel } from "@/lib/shop/payment-methods";
import { getCodSettings } from "@/lib/shop/cod";
import type {
  Customer,
  Fulfillment,
  Order,
  OrderItem,
  PaymentRequest,
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
import { CodAdvanceCard } from "./cod-advance-card";
import { ShipNowDialog } from "./ship-now-dialog";
import { ShipmentCard } from "./shipment-card";
import { getCourierAvailability } from "@/lib/couriers/config";
import { draftForOrder, getShipmentsForOrder, liveShipment } from "@/lib/couriers/shipments";

export const metadata = { title: "Order" };

/** What `admin_order_detail` returns — the order page in one JSON document. */
interface OrderDetailPayload {
  order: Order & { customers: Customer | null; metafields?: Record<string, string> };
  items: (OrderItem & { image: { url: string; alt: string | null } | null })[];
  fulfillments: Fulfillment[];
  refunds: Refund[];
  notes: OrderNote[];
  /* Added by 0033. */
  payment_requests: PaymentRequest[];
  previous_id: string | null;
  next_id: string | null;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // One round trip. This page used to make four sequential waves of requests
  // to Tokyo — the order and its children, then the line images, then the
  // previous/next neighbours — which was over half a second of waiting on
  // network alone. `admin_order_detail` (0032) composes all of it in Postgres
  // under the caller's own RLS. Qikink's status lives behind the service role
  // and is read alongside rather than after.
  //
  // The courier reads ride in the same wave. `draftForOrder` re-reads the
  // order and its lines through the service role rather than waiting for the
  // RPC's copy: a second wave of requests to Tokyo costs more than one
  // redundant read inside the first.
  const [{ data: detail }, qikinkStatus, qikinkFulfillment, codSettings, headerList, couriers, shipments, shipDraft] =
    await Promise.all([
      supabase.rpc("admin_order_detail", { p_id: id }),
      getQikinkStatus(),
      getFulfillment(id),
      getCodSettings(),
      headers(),
      getCourierAvailability(),
      getShipmentsForOrder(id),
      draftForOrder(id),
    ]);

  const payload = detail as OrderDetailPayload | null;
  if (!payload?.order) notFound();

  const order = payload.order;
  const items = payload.items;
  const imageByProduct = new Map<string, { url: string; alt: string | null }>();
  for (const item of items) {
    if (item.product_id && item.image && !imageByProduct.has(item.product_id)) {
      imageByProduct.set(item.product_id, item.image);
    }
  }
  const fulfillments = payload.fulfillments;
  const refunds = payload.refunds;
  const notes = payload.notes;
  const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const customer = order.customers;
  const previous = payload.previous_id ? { id: payload.previous_id } : null;
  const next = payload.next_id ? { id: payload.next_id } : null;
  const canFulfill = !order.is_draft && !order.cancelled_at && order.payment_status !== "voided" && !["fulfilled", "restocked"].includes(order.fulfillment_status);
  const configured = qikinkStatus.enabled && qikinkStatus.configured;
  // "Ship now" is for parcels the store packs itself. An order Qikink already
  // has is theirs to ship, and an order a courier already has is booked.
  const qikinkHasIt = qikinkFulfillment?.status === "sent";
  const canShip = canFulfill && !qikinkHasIt && !liveShipment(shipments) && Boolean(shipDraft);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const email = order.email || customer?.email || "";
  const phone = order.phone || customer?.phone || "";
  const shipping = order.shipping_address ?? {};
  const billing = Object.keys(order.billing_address ?? {}).length ? order.billing_address : shipping;
  const fulfillmentLabel = order.fulfillment_status === "partial" ? "Partially fulfilled" : order.fulfillment_status.replace(/^./, c => c.toUpperCase());
  const paymentLabel = order.payment_status.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
  const money = (amount: number | string) => formatMoney(Number(amount), order.currency);
  const amountPaid = Number(order.amount_paid ?? 0);
  const isCod = isCodMethod(order.payment_method);
  // The shopper's own order page, absolute, for the advance share link. The
  // origin comes from the request (or NEXT_PUBLIC_SITE_URL behind a proxy) for
  // the same reason the Payments settings page resolves its webhook URL here.
  const payLink = order.checkout_token ? `${siteOrigin(headerList)}/orders/${order.checkout_token}` : null;

  return (
    <div data-full-bleed className="order-detail">
      <header className="order-heading">
        <div className="min-w-0">
          <div className="order-title-row">
            <Link href={order.is_draft ? "/admin/orders/drafts" : "/admin/orders"} aria-label="Back to orders" className="order-back"><Package size={16} /><ChevronLeft size={12} /></Link>
            <h1>{order.is_draft ? "Draft #D" : "#"}{order.order_number}</h1>
            {order.cancelled_at && <Badge variant="destructive">Cancelled</Badge>}
            {order.is_draft ? <Badge variant="secondary">Draft</Badge> : <><PaymentBadge status={order.payment_status} /><FulfillmentBadge status={order.fulfillment_status} /></>}
          </div>
          <p className="order-date">{formatDateTime(order.created_at)} from {order.source === "storefront" ? "Online Store" : "Admin"}</p>
        </div>
        <div className="order-toolbar">
          {order.is_draft ? <><DeleteOrderButton orderId={id} /><ConvertDraftButton orderId={id} /></> : <>
            {["paid", "partially_refunded"].includes(order.payment_status) && refunded < Number(order.total) && <RefundDialog orderId={id} maxAmount={Number(order.total) - refunded} />}
            <DetailEditor orderId={id} field="contact" value={{ email, phone }} label="Edit" />
            <OrderActionsMenu orderId={id} cancelled={Boolean(order.cancelled_at)} />
          </>}
          <div className="flex gap-1">
            {previous ? <Button size="sm" variant="ghost" asChild><Link href={`/admin/orders/${previous.id}`} aria-label="Previous order"><ChevronUp size={16} /></Link></Button> : <Button size="sm" variant="ghost" disabled aria-label="Previous order"><ChevronUp size={16} /></Button>}
            {next ? <Button size="sm" variant="ghost" asChild><Link href={`/admin/orders/${next.id}`} aria-label="Next order"><ChevronDown size={16} /></Link></Button> : <Button size="sm" variant="ghost" disabled aria-label="Next order"><ChevronDown size={16} /></Button>}
          </div>
        </div>
      </header>
      <div className="order-columns">
        <div className="order-main">
          <section className="order-card fulfillment-card">
            <div className="section-heading">
              <h2 className="flex items-center gap-2"><span className={`section-icon ${order.fulfillment_status === "unfulfilled" ? "unfulfilled" : ""}`}><Package size={16} /></span>{fulfillmentLabel}</h2>
              {canFulfill && <div className="fulfillment-actions"><FulfillDialog orderId={id} /><RequestFulfillment orderId={id} configured={configured} disabled={qikinkHasIt} />{canShip && shipDraft && <ShipNowDialog orderId={id} draft={shipDraft} availability={couriers} />}</div>}
            </div>
            <div className="shipping-summary">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><Truck size={16} />Standard Shipping</span>{configured && <Link className="location-badge" href="/admin/settings/qikink"><MapPin size={13} />Qikink_Fulfillment</Link>}</div>
              <details><summary className="shipping-profile cursor-pointer"><Tag size={15} />General profile</summary><p className="order-muted mt-2">Standard shipping · {money(order.shipping_total ?? 0)} charged on this order. {configured ? "Print-on-demand orders are fulfilled by Qikink; anything else ships by courier from Ship now." : "Fulfillment is managed by your store — book a courier from Ship now."}</p></details>
            </div>
            <div className="order-lines">
              {items.map(item => { const image = item.product_id ? imageByProduct.get(item.product_id) : undefined; return <div className="order-line" key={item.id}>
                <div className="line-product"><div className="line-image">{image ? <Image src={image.url} alt={image.alt || item.title_snapshot} fill sizes="40px" className="object-contain" /> : <Package size={20} />}</div><div className="min-w-0">
                  {item.product_id ? <Link href={`/admin/products/${item.product_id}`} className="product-title">{item.title_snapshot}</Link> : <span className="product-title">{item.title_snapshot}</span>}
                  {item.variant_snapshot && <p><span className="variant-label">{item.variant_snapshot}</span></p>}
                  {item.variant_id && <p className="line-id">{item.variant_id}</p>}
                </div></div>
                <div className="line-price">{money(item.price_snapshot)} <span>×</span> <span className="quantity-label">{item.quantity}</span></div><div className="line-total">{money(Number(item.price_snapshot) * item.quantity)}</div>
              </div>; })}
              {!items.length && <p className="p-3 order-muted">No items in this order.</p>}
            </div>
          </section>
          {shipments.length > 0 && <ShipmentCard shipments={shipments} currency={order.currency} />}
          {isCod && !order.is_draft && (
            <CodAdvanceCard
              orderId={id}
              order={{
                order_number: order.order_number,
                total: Number(order.total),
                amount_paid: amountPaid,
                currency: order.currency,
                phone,
                first_name: shipping.first_name ?? customer?.first_name ?? "",
                payment_status: order.payment_status,
                cancelled_at: order.cancelled_at,
                held_at: order.held_at ?? null,
                released_at: order.released_at ?? null,
              }}
              requests={payload.payment_requests ?? []}
              qikinkSent={qikinkFulfillment?.status === "sent"}
              qikinkSentAt={qikinkFulfillment?.sent_at ?? null}
              settings={codSettings}
              payLink={payLink}
            />
          )}
          <section className="order-card payment-card">
            <div className="section-heading"><h2 className="flex items-center gap-2"><span className="section-icon"><ReceiptText size={16} /></span>{paymentLabel}</h2>{["pending", "partially_paid"].includes(order.payment_status) && !order.cancelled_at && <MarkPaidButton orderId={id} />}</div>
            <div className="payment-summary">
              <dl className="payment-rows">
                <div><dt>Subtotal</dt><dd>{itemCount} {itemCount === 1 ? "item" : "items"}</dd><dd>{money(order.subtotal)}</dd></div>
                <div><dt>Shipping</dt><dd>Standard Shipping</dd><dd>{money(order.shipping_total ?? 0)}</dd></div>
                <div><dt>Taxes</dt><dd><details><summary>Tax details</summary><p className="order-muted">Tax recorded on this order: {money(order.tax_total ?? 0)}</p></details></dd><dd>{money(order.tax_total ?? 0)}</dd></div>
                {Number(order.discount_total) > 0 && <div><dt>Discount</dt><dd>{order.discount_code}</dd><dd>−{money(order.discount_total)}</dd></div>}
                {Number(order.prepaid_discount) > 0 && <div><dt>Prepaid discount</dt><dd /><dd>−{money(order.prepaid_discount)}</dd></div>}
                {Number(order.cod_fee) > 0 && <div><dt>COD fee</dt><dd /><dd>{money(order.cod_fee)}</dd></div>}
                <div className="font-semibold"><dt>Total</dt><dd /><dd>{money(order.total)}</dd></div>
                {amountPaid > 0 && <div><dt>Advance paid</dt><dd className="order-muted">Online</dd><dd>−{money(amountPaid)}</dd></div>}
                {amountPaid > 0 && <div className="font-semibold"><dt>{isCod ? "Due on delivery" : "Balance due"}</dt><dd /><dd>{money(Math.max(0, Number(order.total) - amountPaid))}</dd></div>}
              </dl>
              <div className="payment-bottom"><span>{["paid", "partially_refunded", "refunded"].includes(order.payment_status) ? "Paid" : paymentLabel}</span><span>{["paid", "partially_refunded", "refunded"].includes(order.payment_status) ? money(order.total) : paymentMethodLabel(order.payment_method)}</span></div>
              {refunded > 0 && <div className="payment-bottom"><span>Refunded</span><span>−{money(refunded)}</span></div>}
            </div>
          </section>
          <Metafields orderId={id} values={order.metafields ?? {}} />
          {fulfillments.length > 0 && <Card><CardHeader><CardTitle>Fulfillments</CardTitle></CardHeader><CardContent className="space-y-3">{fulfillments.map(f => <div key={f.id}><p>{f.carrier || "Shipment"} {f.tracking_url ? <a className="order-link" href={f.tracking_url} target="_blank" rel="noreferrer noopener">{f.tracking_number}</a> : f.tracking_number}</p><p className="order-muted">{formatDateTime(f.created_at)}</p></div>)}</CardContent></Card>}
          {refunds.length > 0 && <Card><CardHeader><CardTitle>Refunds</CardTitle></CardHeader><CardContent className="space-y-3">{refunds.map(r => <div key={r.id}><p>{money(r.amount)} {r.reason} {r.restock && <Badge variant="secondary">Restocked</Badge>}</p><p className="order-muted">{formatDateTime(r.created_at)}</p></div>)}</CardContent></Card>}
          <OrderNotes orderId={id} notes={notes} />
          <div className="order-created"><span />{formatDateTime(order.created_at)} — Order created.</div>
          {configured && qikinkFulfillment && <QikinkCard orderId={id} fulfillment={qikinkFulfillment} isDraft={order.is_draft} />}
        </div>
        <aside className="order-aside">
          <section className="order-card customer-note"><div className="section-heading"><h2>Notes</h2><DetailEditor orderId={id} field="note" value={order.note || ""} label="Edit notes" icon /></div><p className="order-muted whitespace-pre-wrap">{order.note || "No notes from customer"}</p></section>
          <section className="order-card customer-card">
            <div className="section-heading"><h2>Customer</h2><CustomerMenu customerId={customer?.id} /></div>
            {customer ? <><Link className="order-link" href={`/admin/customers/${customer.id}`}>{`${customer.first_name} ${customer.last_name}`.trim() || customer.email}</Link><p className="mt-1"><Link className="order-link" href={`/admin/customers/${customer.id}`}>{customer.orders_count} {customer.orders_count === 1 ? "order" : "orders"}</Link></p></> : <p className="order-muted">Guest customer</p>}
            <div className="customer-section"><div className="section-heading"><h3>Contact information</h3><DetailEditor orderId={id} field="contact" value={{ email, phone }} label="Edit contact information" icon /></div>{email ? <a className="order-link break-all" href={`mailto:${email}`}>{email}</a> : <p className="order-muted">No email address</p>}<p className="order-muted mt-1">{phone || "No phone number"}</p></div>
            <div className="customer-section"><div className="section-heading"><h3>Shipping address</h3><DetailEditor orderId={id} field="shipping_address" value={shipping} label="Edit shipping address" icon /></div><OrderAddress address={shipping} phone={order.phone} />{shipping.address1 && <a className="order-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([shipping.address1, shipping.address2, shipping.city, shipping.province, shipping.postal_code, shipping.country].filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer">View map</a>}</div>
            <div className="customer-section"><div className="section-heading"><h3>Billing address</h3><DetailEditor orderId={id} field="billing_address" value={billing} label="Edit billing address" icon /></div><OrderAddress address={billing} phone={order.phone} /></div>
          </section>
          <section className="order-card conversion-card"><h2>Conversion summary</h2>
            {customer && <p className="conversion-row"><Package size={16} />{customer.orders_count === 1 ? "This is their 1st order" : `${customer.orders_count} customer orders`}</p>}
            <p className="conversion-row"><Globe size={16} />{order.source === "storefront" ? "Online Store" : "Admin-created order"}</p>
            <p className="conversion-row"><MousePointerClick size={16} />{order.referrer ? "Referred visit" : "Unknown referral source"}</p>
            <details className="conversion-details"><summary className="order-link">View conversion details</summary><dl className="space-y-2 mt-3">{Object.entries(order.utm ?? {}).map(([key,value]) => <div key={key}><dt className="order-muted capitalize">{key.replaceAll("_", " ")}</dt><dd className="break-all">{value}</dd></div>)}<div><dt className="order-muted">Referrer</dt><dd className="break-all">{order.referrer || "Not recorded"}</dd></div><div><dt className="order-muted">Landing page</dt><dd className="break-all">{order.landing_path || "Not recorded"}</dd></div><div><dt className="order-muted">Email marketing</dt><dd>{order.marketing_opt_in ? "Opted in" : "Not opted in"}</dd></div></dl></details>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The public origin of this deployment, for links handed to customers. */
function siteOrigin(headerList: Awaited<ReturnType<typeof headers>>): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

function OrderAddress({ address, phone }: { address: Record<string, string>; phone?: string }) {
  if (!address.address1) return <p className="order-muted">No address provided</p>;
  return <address className="not-italic leading-[20px]">{[address.first_name, address.last_name].filter(Boolean).join(" ")}<br />{address.address1}{address.address2 && <><br />{address.address2}</>}<br />{[address.postal_code, address.city, address.province].filter(Boolean).join(" ")}<br />{address.country}{(address.phone || phone) && <><br />{address.phone || phone}</>}</address>;
}
