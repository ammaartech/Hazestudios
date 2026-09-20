"use client";

import { useState } from "react";
import Link from "next/link";
import { RowLink } from "@/components/admin/row-link";
import { ArrowDown, ChevronDown, ChevronsUpDown, Package, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { SearchInput } from "@/components/admin/search-input";
import { DesktopTable, RecordList } from "@/components/admin/record-list";
import { PaymentBadge, FulfillmentBadge, HoldBadge } from "@/components/admin/status-badges";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";

export type OrderRow = Pick<Order, "id" | "order_number" | "created_at" | "total" | "currency" | "payment_status" | "fulfillment_status" | "cancelled_at" | "held_at" | "released_at"> & {
  customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
  order_items: { quantity: number }[];
  fulfillments: { tracking_number: string; status: string }[];
};
const views = [{ label: "All", value: "" }, { label: "Needs review", value: "review" }, { label: "Unfulfilled", value: "unfulfilled" }, { label: "Unpaid", value: "unpaid" }, { label: "Open", value: "open" }, { label: "Closed", value: "closed" }];
const onHold = (o: OrderRow) => Boolean(o.held_at) && !o.released_at && !o.cancelled_at;
const name = (o: OrderRow) => o.customers ? `${o.customers.first_name} ${o.customers.last_name}`.trim() || o.customers.email || "Customer" : "No customer";
const quantity = (o: OrderRow) => o.order_items.reduce((sum, i) => sum + i.quantity, 0);

export function OrderList({ orders, total, page, pageSize, tab }: { orders: OrderRow[]; total: number; page: number; pageSize: number; tab?: string }) {
  const [selection, setSelection] = useState<string[]>([]);
  const selected = selection.filter(id => orders.some(o => o.id === id));
  const activeView = views.find(v => v.value === (tab || "")) ?? views[0];
  function exportOrders() {
    const rows = selected.length ? orders.filter(o => selected.includes(o.id)) : orders;
    // Spreadsheet formula prefixes are escaped before CSV quoting.
    const cell = (value: unknown) => { const s = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`; };
    const csv = [["Order", "Items", "Total", "Currency", "Fulfillment", "Payment", "Date", "Customer"], ...rows.map(o => [o.order_number, quantity(o), o.total, o.currency, o.fulfillment_status, o.payment_status, o.created_at, name(o)])].map(row => row.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click(); URL.revokeObjectURL(url);
  }
  return <div className="orders-index">
    <PageHeader title="Orders" primary={<Button asChild><Link href="/admin/orders/new">Create order</Link></Button>}>
      <Button variant="outline" onClick={exportOrders} disabled={!orders.length} title={selected.length ? "Export selected orders" : "Export the current page of orders"}>Export</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">More actions<ChevronDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href="/admin/orders/tracking/qikink">Delivery tracking</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/admin/orders/drafts">View drafts</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={exportOrders} disabled={!orders.length}><Download size={14} />Export {selected.length ? "selected orders" : "current page"}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </PageHeader>
    <section className="admin-list-panel" aria-label="Orders">
      <div className="orders-filterbar">
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" aria-label="Order view">{activeView.label}<ChevronsUpDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{views.map(v => <DropdownMenuItem key={v.label} asChild><Link href={v.value ? `/admin/orders?tab=${v.value}` : "/admin/orders"} aria-current={activeView.value === v.value ? "page" : undefined}>{v.label}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
        <SearchInput placeholder="Search order number" className="orders-search" />
        {selected.length > 0 && <div className="orders-selection"><span>{selected.length} selected</span><Button variant="outline" onClick={exportOrders}>Export selected</Button><Button variant="ghost" onClick={() => setSelection([])}>Clear</Button></div>}
      </div>
      {orders.length === 0 ? <div className="orders-empty"><Package size={24} /><h2>No orders found</h2><p>Try another order number or choose a different view.</p><Button variant="outline" asChild><Link href="/admin/orders">View all orders</Link></Button></div> : <>
        <RecordList className="orders-mobile" items={orders.map(o => ({ id:o.id, href:`/admin/orders/${o.id}`, title:`#${o.order_number}`, subtitle:`${name(o)} · ${formatDateTime(o.created_at)}`, amount:formatMoney(o.total,o.currency), badges:<><PaymentBadge status={o.payment_status} /><FulfillmentBadge status={o.fulfillment_status} />{onHold(o) && <HoldBadge />}</> }))} />
        <DesktopTable><Table className="orders-table">
          <colgroup><col className="col-select" /><col className="col-order" /><col className="col-items" /><col className="col-total" /><col className="col-fulfillment" /><col className="col-payment" /><col className="col-date" /><col /><col className="col-delivery" /><col className="col-method" /></colgroup>
          <TableHeader><TableRow>
            <TableHead><Checkbox aria-label="Select all orders on this page" checked={selected.length === orders.length ? true : selected.length ? "indeterminate" : false} onCheckedChange={v => setSelection(v === true ? orders.map(o => o.id) : [])} /></TableHead>
            <TableHead>Order</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Fulfillment status</TableHead><TableHead>Payment status</TableHead><TableHead><span className="inline-flex items-center gap-1">Date<ArrowDown size={13} aria-label="Newest first" /></span></TableHead><TableHead>Customer</TableHead><TableHead>Delivery status</TableHead><TableHead>Delivery method</TableHead>
          </TableRow></TableHeader>
          <TableBody>{orders.map(o => <TableRow key={o.id} data-state={selected.includes(o.id) ? "selected" : undefined} className={o.cancelled_at ? "order-cancelled" : undefined}>
            <TableCell><Checkbox aria-label={`Select order ${o.order_number}`} checked={selected.includes(o.id)} onCheckedChange={v => setSelection(v === true ? [...selected,o.id] : selected.filter(id => id !== o.id))} /></TableCell>
            <TableCell><RowLink href={`/admin/orders/${o.id}`}>#{o.order_number}</RowLink></TableCell><TableCell>{quantity(o)} {quantity(o) === 1 ? "item" : "items"}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(o.total,o.currency)}</TableCell><TableCell><FulfillmentBadge status={o.fulfillment_status} /></TableCell><TableCell><span className="inline-flex flex-wrap gap-1"><PaymentBadge status={o.payment_status} />{onHold(o) && <HoldBadge />}</span></TableCell><TableCell>{formatDateTime(o.created_at)}</TableCell><TableCell title={name(o)}>{name(o)}</TableCell>
            <TableCell>{o.fulfillments.some(f => f.status === "delivered") ? <span className="delivery-label">Delivered</span> : o.fulfillments.some(f => f.tracking_number) ? <span className="delivery-label">Tracking added</span> : <span className="sr-only">Not recorded</span>}</TableCell><TableCell>Standard Shipping</TableCell>
          </TableRow>)}</TableBody>
        </Table></DesktopTable>
      </>}
      <Pagination page={page} pageSize={pageSize} total={total} />
      <p className="sr-only" aria-live="polite">{selected.length} orders selected. Export downloads {selected.length ? "selected orders" : "the current page"}.</p>
    </section>
  </div>;
}
