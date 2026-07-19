import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { SearchInput } from "@/components/admin/search-input";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type OrderRow = Order & {
  customers: Pick<Customer, "first_name" | "last_name" | "email"> | null;
  order_items: { quantity: number }[];
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { tab, q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select("*, customers(first_name, last_name, email), order_items(quantity)")
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  if (tab === "unfulfilled") query = query.eq("fulfillment_status", "unfulfilled");
  if (tab === "unpaid") query = query.eq("payment_status", "pending");
  if (tab === "open") query = query.is("closed_at", null);
  if (tab === "closed") query = query.not("closed_at", "is", null);
  if (q && /^\d+$/.test(q)) query = query.eq("order_number", parseInt(q));

  const { data } = await query;
  const orders = (data ?? []) as OrderRow[];

  return (
    <div>
      <PageHeader title="Orders">
        <Button variant="outline" asChild>
          <Link href="/orders/drafts">Drafts</Link>
        </Button>
        <Button asChild>
          <Link href="/orders/new">Create order</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <FilterTabs
              basePath="/orders"
              param="tab"
              current={tab}
              tabs={[
                { label: "All", value: undefined },
                { label: "Unfulfilled", value: "unfulfilled" },
                { label: "Unpaid", value: "unpaid" },
                { label: "Open", value: "open" },
                { label: "Closed", value: "closed" },
              ]}
            />
            <SearchInput placeholder="Search order number" />
          </div>

          {orders.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No orders found.{" "}
              <Link href="/orders/new" className="text-primary hover:underline">
                Create an order
              </Link>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment status</TableHead>
                  <TableHead>Fulfillment status</TableHead>
                  <TableHead>Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const customerName = o.customers
                    ? `${o.customers.first_name} ${o.customers.last_name}`.trim() ||
                      o.customers.email
                    : "No customer";
                  const itemCount = o.order_items.reduce(
                    (sum, i) => sum + i.quantity,
                    0
                  );
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link
                          href={`/orders/${o.id}`}
                          className="font-semibold text-foreground hover:underline"
                        >
                          #{o.order_number}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDateTime(o.created_at)}</TableCell>
                      <TableCell>{customerName}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(o.total, o.currency)}
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={o.payment_status} />
                      </TableCell>
                      <TableCell>
                        <FulfillmentBadge status={o.fulfillment_status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
