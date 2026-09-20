/**
 * Delivery partners the admin tracks orders through.
 *
 * Tracking used to be one page, because there was one partner. There are three
 * now, and they do not share a data model: Qikink is a print-on-demand
 * fulfiller that owns the whole order, while Shree Maruti and Bluedart are
 * pure couriers that only ever know about a consignment. So each gets its own
 * route and its own reader rather than a single table with a "carrier" column
 * that means something different in every row.
 *
 * What they do share is this list — the nav, the tracking index and the
 * per-carrier pages all read it, so adding the fourth partner is one entry
 * plus a page, and nothing silently keeps showing three.
 *
 * `connected` is about the *integration existing in this codebase*, not about
 * whether credentials happen to be filled in. Qikink has a client, a sync and
 * a stage model (`src/lib/qikink`); the other two have credentials to collect
 * and nothing behind them yet. A page uses this to decide whether to render a
 * tracking table or the setup state — the live credential check is separate
 * and still happens per request.
 */

export interface Carrier {
  /** URL segment under /admin/orders/tracking. */
  slug: string;
  /** The partner's own name, as they spell it. */
  name: string;
  /**
   * Sidebar label. Deliberately not "Delivery tracking <name>": these render as
   * children of Orders, where the prefix is already implied, and three copies
   * of it overflow the 240px sidebar. The page's own <h1> carries the full name.
   */
  navLabel: string;
  href: string;
  /** Whether an integration exists behind the page. */
  connected: boolean;
  /** What the operator needs from the partner to switch it on. */
  credentials: string;
}

export const CARRIERS: Carrier[] = [
  {
    slug: "qikink",
    name: "Qikink",
    navLabel: "Tracking · Qikink",
    href: "/admin/orders/tracking/qikink",
    connected: true,
    credentials: "Client ID and client secret",
  },
  {
    slug: "shreemaruti",
    name: "Shree Maruti",
    navLabel: "Tracking · Shree Maruti",
    href: "/admin/orders/tracking/shreemaruti",
    connected: false,
    credentials: "API key and account code",
  },
  {
    slug: "bluedart",
    name: "Bluedart",
    navLabel: "Tracking · Bluedart",
    href: "/admin/orders/tracking/bluedart",
    connected: false,
    credentials: "Licence key, login ID and customer code",
  },
];

/** The carrier the bare /admin/orders/tracking URL lands on. */
export const DEFAULT_CARRIER = CARRIERS[0];

export function carrierBySlug(slug: string): Carrier | undefined {
  return CARRIERS.find((c) => c.slug === slug);
}
