import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/admin/page-header";
import {
  OrdersBarChart,
  SalesAreaChart,
  TopProductsChart,
} from "@/components/admin/charts";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import type { Order, OrderItem } from "@/lib/types";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  const [{ data: ordersData }, { data: itemsData }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("is_draft", false)
      .gte("created_at", since.toISOString()),
    supabase
      .from("order_items")
      .select("*, orders!inner(is_draft, payment_status, created_at)")
      .eq("orders.is_draft", false)
      .gte("orders.created_at", since.toISOString()),
  ]);

  const orders = (ordersData ?? []) as Order[];
  const paidOrders = orders.filter(
    (o) => o.payment_status === "paid" || o.payment_status === "partially_refunded"
  );
  const totalSales = paidOrders.reduce((sum, o) => sum + Number(o.total), 0);
  const aov = paidOrders.length ? totalSales / paidOrders.length : 0;

  // Daily buckets for the last 30 days
  const days: { date: string; sales: number; orders: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    days.push({ date: formatDate(d).replace(", 2026", ""), sales: 0, orders: 0 });
  }
  for (const o of orders) {
    const idx = Math.floor(
      (new Date(o.created_at).getTime() - since.getTime()) / 86_400_000
    );
    if (idx >= 0 && idx < 30) {
      days[idx].orders += 1;
      if (
        o.payment_status === "paid" ||
        o.payment_status === "partially_refunded"
      ) {
        days[idx].sales += Number(o.total);
      }
    }
  }

  // Top products by revenue
  const items = (itemsData ?? []) as (OrderItem & {
    orders: { payment_status: string };
  })[];
  const revenueByProduct = new Map<string, number>();
  for (const item of items) {
    if (!["paid", "partially_refunded"].includes(item.orders.payment_status))
      continue;
    revenueByProduct.set(
      item.title_snapshot,
      (revenueByProduct.get(item.title_snapshot) ?? 0) +
        Number(item.price_snapshot) * item.quantity
    );
  }
  const topProducts = [...revenueByProduct.entries()]
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const stats = [
    { label: "Total sales (30d)", value: formatMoney(totalSales) },
    { label: "Orders (30d)", value: String(orders.length) },
    { label: "Average order value", value: formatMoney(aov) },
    {
      label: "Fulfilled rate",
      value: orders.length
        ? `${Math.round(
            (orders.filter((o) => o.fulfillment_status === "fulfilled").length /
              orders.length) *
              100
          )}%`
        : "—",
    },
  ];

  return (
    <div>
      <PageHeader title="Analytics">
        <Link
          href="/analytics/reports"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Reports <ArrowRight className="size-3.5" />
        </Link>
      </PageHeader>

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

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales over time</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesAreaChart
              data={days.map(({ date, sales }) => ({ date, sales }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders per day</CardTitle>
          </CardHeader>
          <CardContent>
            <OrdersBarChart
              data={days.map(({ date, orders: o }) => ({ date, orders: o }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">Top products by revenue (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No paid orders in the last 30 days yet.
            </p>
          ) : (
            <TopProductsChart data={topProducts} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
