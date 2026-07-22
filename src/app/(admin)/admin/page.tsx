import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentBadge, FulfillmentBadge } from "@/components/admin/status-badges";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Order } from "@/lib/types";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  let totalSales = 0;
  let ordersCount = 0;
  let productsCount = 0;
  let customersCount = 0;
  let recentOrders: Order[] = [];
  let connected = false;

  if (configured) {
    try {
      const supabase = await createClient();
      const [paidOrders, orders, products, customers, recent] =
        await Promise.all([
          supabase
            .from("orders")
            .select("total")
            .eq("is_draft", false)
            .in("payment_status", ["paid", "partially_refunded"]),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("is_draft", false),
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase.from("customers").select("id", { count: "exact", head: true }),
          supabase
            .from("orders")
            .select("*")
            .eq("is_draft", false)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

      totalSales = (paidOrders.data ?? []).reduce(
        (sum, o) => sum + Number(o.total),
        0
      );
      ordersCount = orders.count ?? 0;
      productsCount = products.count ?? 0;
      customersCount = customers.count ?? 0;
      recentOrders = (recent.data ?? []) as Order[];
      connected = !paidOrders.error;
    } catch {
      connected = false;
    }
  }

  const stats = [
    { label: "Total sales", value: formatMoney(totalSales) },
    { label: "Orders", value: String(ordersCount) },
    { label: "Products", value: String(productsCount) },
    { label: "Customers", value: String(customersCount) },
  ];

  return (
    <div>
      <PageHeader title="Home" />

      {!connected && (
        <Alert className="mb-5">
          <AlertCircle className="size-4" />
          <AlertTitle>Connect Supabase to get started</AlertTitle>
          <AlertDescription>
            Copy .env.local.example to .env.local with your Supabase project
            keys, then run the migration in supabase/migrations/0001_init.sql.
            The dashboard will light up automatically.
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Link
            href="/admin/orders"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors duration-150 hover:underline"
          >
            View all <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No orders yet.{" "}
              <Link href="/admin/orders/new" className="text-primary hover:underline">
                Create your first order
              </Link>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fulfillment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        #{o.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(o.created_at)}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(o.total, o.currency)}
                    </TableCell>
                    <TableCell>
                      <PaymentBadge status={o.payment_status} />
                    </TableCell>
                    <TableCell>
                      <FulfillmentBadge status={o.fulfillment_status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {connected && productsCount === 0 && (
        <Card className="mt-5">
          <CardContent className="flex items-center justify-between pt-0">
            <div>
              <p className="font-semibold">Add your first product</p>
              <p className="text-sm text-muted-foreground">
                Products power orders, inventory, and collections.
              </p>
            </div>
            <Link
              href="/admin/products/new"
              className="inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
            >
              Add product
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
