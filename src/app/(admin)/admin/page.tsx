import Link from "next/link";
import { connection } from "next/server";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorldMap } from "@/components/admin/world-map";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { getLiveSnapshot, getSalesBreakdown } from "@/lib/analytics/queries";
import { HomeMetrics, type StripMetric } from "./home-metrics";
import { AskBar, type Suggestion } from "./ask-bar";

export const metadata = { title: "Home" };
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning!";
  if (hour < 18) return "Good afternoon!";
  return "Good evening!";
}

/** Percent change, or null when the previous window was empty (÷0 is not -100%). */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

const RANGE_DAYS = 30;

export default async function HomePage() {
  // "Today" and "good morning" are only meaningful relative to the moment of
  // the request, so this dashboard must not be prerendered. `connection()` says
  // that outright — without it, Cache Components rejects the `new Date()` below
  // as non-deterministic work attempted during the build.
  await connection();

  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (RANGE_DAYS - 1));
  from.setHours(0, 0, 0, 0);

  const [sales, live, counts] = await Promise.all([
    getSalesBreakdown(from, to, true),
    getLiveSnapshot(),
    (async () => {
      if (!configured) return { products: 0, unfulfilled: 0, customers: 0 };
      try {
        const supabase = await createClient();
        const [products, unfulfilled, customers] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("is_draft", false)
            .eq("fulfillment_status", "unfulfilled"),
          supabase.from("customers").select("id", { count: "exact", head: true }),
        ]);
        return {
          products: products.count ?? 0,
          unfulfilled: unfulfilled.count ?? 0,
          customers: customers.count ?? 0,
        };
      } catch {
        return { products: 0, unfulfilled: 0, customers: 0 };
      }
    })(),
  ]);

  const { totals, previous, series } = sales;

  const metrics: StripMetric[] = [
    {
      label: "Sessions",
      value: totals.sessions.toLocaleString(),
      delta: previous ? delta(totals.sessions, previous.sessions) : null,
      trend: series.map((p) => p.sessions),
    },
    {
      label: "Total sales",
      value: formatMoney(totals.totalSales, sales.currency),
      delta: previous ? delta(totals.totalSales, previous.totalSales) : null,
      trend: series.map((p) => p.sales),
    },
    {
      label: "Orders",
      value: totals.orders.toLocaleString(),
      delta: previous ? delta(totals.orders, previous.orders) : null,
      trend: series.map((p) => p.orders),
    },
    {
      label: "Conversion rate",
      value: `${totals.conversionRate.toFixed(1)}%`,
      delta: previous
        ? delta(totals.conversionRate, previous.conversionRate)
        : null,
      trend: series.map((p) => (p.sessions ? (p.orders / p.sessions) * 100 : 0)),
    },
  ];

  const rangeLabel = `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(from)} – ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(to)}`;

  // Only surface a chip when there is something to act on — an empty chip row
  // is worse than none.
  const suggestions: Suggestion[] = [
    counts.unfulfilled > 0 && {
      label: "Fulfill orders",
      href: "/admin/orders?fulfillment=unfulfilled",
      count: counts.unfulfilled,
    },
    counts.products === 0 && {
      label: "Add your first product",
      href: "/admin/products/new",
    },
    counts.products > 0 && {
      label: "View analytics",
      href: "/admin/analytics",
    },
    counts.customers > 0 && {
      label: "Browse customers",
      href: "/admin/customers",
      count: counts.customers,
    },
  ].filter(Boolean) as Suggestion[];

  const cards = [
    {
      title: "Set up your storefront",
      body: "Pick a theme, arrange sections and publish the shop customers see.",
      cta: "Customize",
      href: "/admin/online-store",
      tint: "from-violet-500/15 to-sky-500/10",
    },
    {
      title: "Watch traffic as it happens",
      body: "Live View maps every visitor on your store in real time, by location.",
      cta: "Open Live View",
      href: "/admin/analytics/live",
      tint: "from-emerald-500/15 to-teal-500/10",
    },
    {
      title: "Review your reports",
      body: "Sales, sessions and customer behaviour, broken down every way you need.",
      cta: "View reports",
      href: "/admin/analytics/reports",
      tint: "from-amber-500/15 to-orange-500/10",
    },
  ];

  return (
    <div data-full-bleed>
      <HomeMetrics
        metrics={metrics}
        rangeLabel={rangeLabel}
        initialLive={live}
      />

      <div className="relative overflow-hidden">
        {/* Decorative map wash behind the greeting, as on Shopify's Home. */}
        <div
          className="pointer-events-none absolute inset-x-0 -top-10 mx-auto hidden max-w-5xl select-none md:block"
          aria-hidden
        >
          <WorldMap variant="hero" className="h-auto w-full" />
        </div>

        {/* py-8 under `md`. The hero is the right idea and the wrong budget on
            a phone: 48px of padding, a 30px greeting and a 56px gap below it
            pushed the prompt bar and every card under it off the first
            screen. */}
        <div className="relative px-4 py-8 md:px-8 md:py-12 xl:px-12 lg:py-16">
          {!sales.configured && (
            <Alert className="mx-auto mb-10 max-w-2xl">
              <AlertCircle className="size-4" />
              <AlertTitle>Connect Supabase to get started</AlertTitle>
              <AlertDescription>
                Copy .env.local.example to .env.local with your Supabase project
                keys, then run npm run db:migrate. The dashboard fills in
                automatically.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col items-center text-center">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-balance md:text-4xl">
              {greeting()}
              <br />
              <span className="text-muted-foreground">
                Let&rsquo;s continue growing your business.
              </span>
            </h1>

            <div className="mt-6 flex w-full justify-center md:mt-8">
              <AskBar suggestions={suggestions} />
            </div>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:mt-14 md:grid-cols-3">
            {cards.map((card) => (
              <div
                key={card.title}
                className="flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow duration-150 hover:shadow-md"
              >
                <div
                  className={`mb-4 h-28 rounded-lg bg-linear-to-br ${card.tint}`}
                />
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {card.title}
                </h2>
                <p className="mt-1.5 flex-1 text-sm text-muted-foreground">
                  {card.body}
                </p>
                <Link
                  href={card.href}
                  className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:bg-muted"
                >
                  {card.cta}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
