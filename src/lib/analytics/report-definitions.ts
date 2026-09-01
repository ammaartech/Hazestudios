/**
 * The report catalog — names, categories and descriptions only.
 *
 * Deliberately separate from `reports.ts`, which holds the query runners: the
 * catalog UI is a client component, and importing the runners would drag the
 * server Supabase client into the browser bundle.
 *
 * Every entry here runs against real data. Shopify ships reports this store has
 * no source for (ad spend, shipping labels, POS staff) — rather than listing
 * them as dead rows, the catalog only contains what the schema can actually
 * answer, so nothing in it opens onto a permanently empty table.
 */

export const REPORT_CATEGORIES = [
  // "Orders" leads deliberately: the catalog's default sort is by category
  // index, so this is the pair that greets you on opening Reports.
  "Orders",
  "Acquisition",
  "Behavior",
  "Sales",
  "Customers",
  "Inventory",
  "Finances",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface ReportDefinition {
  slug: string;
  name: string;
  category: ReportCategory;
  description: string;
}

export const REPORTS: ReportDefinition[] = [
  // Orders — the plain count questions, answered over any window you pick.
  {
    slug: "total-orders",
    name: "Total orders",
    category: "Orders",
    description:
      "How many orders were placed between two dates, broken down by day.",
  },
  {
    slug: "orders-by-city",
    name: "Orders by city",
    category: "Orders",
    description:
      "Which cities those orders shipped to, ranked by order count.",
  },

  // Acquisition — storefront traffic, from the analytics tables.
  {
    slug: "sessions-over-time",
    name: "Sessions over time",
    category: "Acquisition",
    description: "Storefront sessions per day across the selected period.",
  },
  {
    slug: "sessions-by-location",
    name: "Sessions by location",
    category: "Acquisition",
    description: "Where your visitors are browsing from.",
  },
  {
    slug: "sessions-by-referrer",
    name: "Sessions by referrer",
    category: "Acquisition",
    description: "Which sites send traffic to your store.",
  },
  {
    slug: "sessions-by-device",
    name: "Sessions by device type",
    category: "Acquisition",
    description: "Desktop, mobile and tablet split.",
  },

  // Behavior — what visitors do once they arrive.
  {
    slug: "sessions-by-landing-page",
    name: "Sessions by landing page",
    category: "Behavior",
    description: "The first page of each session.",
  },
  {
    slug: "conversion-rate-over-time",
    name: "Conversion rate over time",
    category: "Behavior",
    description: "Paid orders as a share of sessions, per day.",
  },
  {
    slug: "products-viewed",
    name: "Top products by views",
    category: "Behavior",
    description: "Which products draw the most attention.",
  },
  {
    slug: "searches-by-query",
    name: "Searches by search query",
    category: "Behavior",
    description: "What shoppers type into storefront search.",
  },

  // Sales.
  {
    slug: "sales-over-time",
    name: "Sales over time",
    category: "Sales",
    description: "Orders and gross sales per day.",
  },
  {
    slug: "sales-by-product",
    name: "Sales by product",
    category: "Sales",
    description: "Units sold and revenue by product.",
  },
  {
    slug: "sales-by-customer",
    name: "Sales by customer",
    category: "Sales",
    description: "Order count and spend per customer.",
  },
  {
    slug: "average-order-value",
    name: "Average order value over time",
    category: "Sales",
    description: "Mean value of paid orders, per day.",
  },

  // Customers.
  {
    slug: "customers-over-time",
    name: "Customers over time",
    category: "Customers",
    description: "New customer records created per day.",
  },
  {
    slug: "top-customers",
    name: "Top customers by spend",
    category: "Customers",
    description: "Highest lifetime spend across all time.",
  },
  {
    slug: "new-vs-returning",
    name: "New vs returning visitors",
    category: "Customers",
    description: "First-time versus repeat sessions.",
  },

  // Inventory.
  {
    slug: "inventory-on-hand",
    name: "Inventory on hand",
    category: "Inventory",
    description: "Current stock level for every tracked product.",
  },
  {
    slug: "low-stock",
    name: "Low stock products",
    category: "Inventory",
    description: "Tracked products at or below ten units.",
  },

  // Finances.
  {
    slug: "payment-status",
    name: "Sales by payment status",
    category: "Finances",
    description: "Order count and value by payment state.",
  },
  {
    slug: "discount-usage",
    name: "Discount usage",
    category: "Finances",
    description: "Orders and value discounted per code.",
  },
];

export function findReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}
