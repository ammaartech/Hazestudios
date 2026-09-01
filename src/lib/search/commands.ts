import { field, type Field } from "./fuzzy";
import type { IndexedItem } from "./types";
import { mainNav, salesChannelNav } from "@/components/admin/nav";

/**
 * Every place in the admin you can go, as search results.
 *
 * A search box that only finds records is half a search box. "Where do I set up
 * a discount", "where did the abandoned checkouts go" and "what was that report
 * called" are the same gesture as looking up an order, and answering them from
 * the same dropdown is what turns the topbar into the way you drive the admin
 * rather than a lookup tool bolted onto it.
 *
 * Derived from `nav.ts` rather than listed again here, so a route added to the
 * sidebar becomes searchable without anyone remembering to update a second
 * list. Only destinations that exist but are *not* in the sidebar — settings
 * panes, individual reports — are enumerated below.
 */

interface CommandSpec {
  title: string;
  href: string;
  /** Where this sits, shown as the row's subtitle. */
  section: string;
  /**
   * Words that should find this page but do not appear in its title.
   *
   * This is the whole reason the list is hand-written rather than scraped: the
   * page is called "Abandoned checkouts" and people search for "cart". Nothing
   * derivable from the route knows that.
   */
  keywords?: string[];
}

const SETTINGS: CommandSpec[] = [
  { title: "Settings", href: "/admin/settings", section: "Navigate", keywords: ["preferences", "configuration", "admin settings"] },
  { title: "General", href: "/admin/settings/general", section: "Settings", keywords: ["store name", "address", "timezone", "currency"] },
  { title: "Domains", href: "/admin/settings/domains", section: "Settings", keywords: ["dns", "custom domain", "url"] },
  { title: "Payments", href: "/admin/settings/payments", section: "Settings", keywords: ["cashfree", "gateway", "upi", "razorpay", "checkout"] },
  { title: "Shipping and delivery", href: "/admin/settings/shipping", section: "Settings", keywords: ["rates", "courier", "delivery", "zones"] },
  { title: "Taxes and duties", href: "/admin/settings/taxes", section: "Settings", keywords: ["gst", "vat", "hsn"] },
  { title: "Locations", href: "/admin/settings/locations", section: "Settings", keywords: ["warehouse", "stock location"] },
  { title: "Notifications", href: "/admin/settings/notifications", section: "Settings", keywords: ["email templates"] },
  { title: "Users and permissions", href: "/admin/settings/users", section: "Settings", keywords: ["staff", "roles", "access", "team"] },
  { title: "Policies", href: "/admin/settings/policies", section: "Settings", keywords: ["refund policy", "privacy", "terms", "returns"] },
  { title: "Qikink", href: "/admin/settings/qikink", section: "Settings", keywords: ["print on demand", "fulfilment", "fulfillment", "pod", "integration"] },
  { title: "Checkout", href: "/admin/settings/checkout", section: "Settings", keywords: ["cart", "address fields"] },
  { title: "Brand", href: "/admin/settings/brand", section: "Settings", keywords: ["logo", "colours", "colors"] },
  { title: "Markets", href: "/admin/settings/markets", section: "Settings", keywords: ["countries", "international"] },
];

const ACTIONS: CommandSpec[] = [
  { title: "Create product", href: "/admin/products/new", section: "Products", keywords: ["new product", "add product"] },
  { title: "Create collection", href: "/admin/products/collections/new", section: "Products", keywords: ["new collection", "add collection"] },
  { title: "Create order", href: "/admin/orders/new", section: "Orders", keywords: ["new order", "draft order", "manual order"] },
  { title: "Create customer", href: "/admin/customers/new", section: "Customers", keywords: ["new customer", "add customer"] },
  { title: "Abandoned checkouts", href: "/admin/orders/abandoned", section: "Orders", keywords: ["cart", "recovery", "incomplete"] },
  { title: "Delivery tracking", href: "/admin/orders/tracking", section: "Orders", keywords: ["awb", "courier", "shipment", "qikink"] },
  { title: "Waitlist", href: "/admin/waitlist", section: "Customers", keywords: ["rsvp", "signups", "drop"] },
  { title: "Live View", href: "/admin/analytics/live", section: "Analytics", keywords: ["realtime", "real time", "visitors now"] },
  { title: "Reports", href: "/admin/analytics/reports", section: "Analytics", keywords: ["sales report", "export", "sql"] },
];

/** Kept in sync with `report-definitions.ts` by slug, not by import: that module
 *  pulls in the analytics query layer, and this one ships to the browser. */
const REPORTS: { title: string; slug: string }[] = [
  { title: "Total orders", slug: "total-orders" },
  { title: "Orders by city", slug: "orders-by-city" },
  { title: "Sales over time", slug: "sales-over-time" },
  { title: "Sales by product", slug: "sales-by-product" },
  { title: "Sales by customer", slug: "sales-by-customer" },
  { title: "Average order value", slug: "average-order-value" },
  { title: "Top customers", slug: "top-customers" },
  { title: "New vs returning", slug: "new-vs-returning" },
  { title: "Customers over time", slug: "customers-over-time" },
  { title: "Conversion rate over time", slug: "conversion-rate-over-time" },
  { title: "Sessions over time", slug: "sessions-over-time" },
  { title: "Sessions by device", slug: "sessions-by-device" },
  { title: "Sessions by location", slug: "sessions-by-location" },
  { title: "Sessions by referrer", slug: "sessions-by-referrer" },
  { title: "Sessions by landing page", slug: "sessions-by-landing-page" },
  { title: "Products viewed", slug: "products-viewed" },
  { title: "Searches by query", slug: "searches-by-query" },
  { title: "Inventory on hand", slug: "inventory-on-hand" },
  { title: "Low stock", slug: "low-stock" },
  { title: "Discount usage", slug: "discount-usage" },
  { title: "Payment status", slug: "payment-status" },
];

const W_TITLE = 1;
/** Keywords are real intent, but they are not what the row says, so they match
 *  a little below the visible title to keep the ordering explicable. */
const W_KEYWORD = 0.7;

function toItem(spec: CommandSpec): IndexedItem {
  const fields: Field[] = [];
  const title = field(spec.title, W_TITLE, { primary: true });
  if (title) fields.push(title);
  for (const kw of spec.keywords ?? []) {
    const f = field(kw, W_KEYWORD, { label: "Keyword" });
    if (f) fields.push(f);
  }

  return {
    kind: "page",
    id: spec.href,
    href: spec.href,
    title: spec.title,
    subtitle: spec.section,
    fields,
    // Pages lose to records deliberately. Someone typing "hoodie" wants the
    // product; someone typing "shipping" gets the settings page because no
    // product competes for it. A negative boost expresses that without ever
    // hiding a page outright.
    boost: -25,
  };
}

/**
 * Built once at module load rather than per keystroke — the list is static, and
 * preparing its fields means folding and scanning ~90 short strings.
 */
export const COMMAND_INDEX: IndexedItem[] = (() => {
  const specs: CommandSpec[] = [];

  for (const item of [...mainNav, ...salesChannelNav]) {
    specs.push({ title: item.label, href: item.href, section: "Navigate" });
    for (const child of item.children ?? []) {
      specs.push({
        title: child.label,
        href: child.href,
        section: item.label,
      });
    }
  }

  specs.push(...ACTIONS, ...SETTINGS);

  for (const report of REPORTS) {
    specs.push({
      title: report.title,
      href: `/admin/analytics/reports/${report.slug}`,
      section: "Reports",
    });
  }

  // `nav.ts` and ACTIONS overlap on a few routes (Waitlist, Live View, Reports).
  // The later spec wins, because it is the one carrying keywords.
  const byHref = new Map<string, CommandSpec>();
  for (const spec of specs) byHref.set(spec.href, spec);

  return [...byHref.values()].map(toItem);
})();
