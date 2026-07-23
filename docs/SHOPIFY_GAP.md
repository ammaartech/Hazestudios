# Shopify capability gap analysis

Scope: nine Shopify help areas vs. the Hazestudios admin as of migration `0005_product_parity.sql`.
Sources are the Shopify help pages listed per section; several top-level pages are index stubs, so
sub-pages were followed where noted. Capabilities not present in the fetched text are not listed.

## Repo baseline (applies to every section)

Schema tables in `supabase/migrations/0001_init.sql`: `staff_roles`, `shop_settings`, `locations`,
`products`, `product_images`, `product_options`, `product_variants`, `collections`,
`product_collections`, `inventory_levels`, `customers`, `segments`, `orders`, `order_items`,
`fulfillments`, `refunds`, `discounts`, `gift_cards`, `files`.
`0003_storefront_public_read.sql` adds anon `select` policies; `0004_storefront_seed.sql` seeds data;
`0005_product_parity.sql` adds product/variant columns plus `save_product()`, `duplicate_product()`,
`product_facets()`.

Placeholder pages (render `<ComingSoon>` from `src/components/admin/coming-soon.tsx`, zero logic):
`admin/analytics/live`, `admin/social-channels`, `admin/content/metaobjects`, `admin/online-store`,
`admin/orders/abandoned`, `admin/marketing`, `admin/marketing/automations`,
`admin/customers/companies`, `admin/products/transfers`, `admin/products/purchase-orders`,
`admin/products/price-lists`, `admin/pos`, and every `admin/settings/[section]` entry
(payments, checkout, shipping, taxes, markets, domains, notifications, customer-events, languages,
custom-data, apps, billing) per `src/app/(admin)/admin/settings/[section]/page.tsx`.

**Standing defect, affects Products + Inventory:** `src/app/(admin)/admin/products/product-form.tsx:32`
still imports `saveProduct` from `src/app/(admin)/admin/products/actions.ts`, which is the pre-0005
non-atomic write (deletes and re-inserts all child rows, writes variant stock to the default location
only). `src/app/(admin)/admin/products/product-draft.tsx` builds the `save_product(jsonb)` payload but
has no importers — the 0005 RPC path is dead code. Nothing in `src/` calls `save_product`,
`duplicate_product`, or `product_facets`.

---

## 1. Inventory

Source: `help.shopify.com/en/manual/products/inventory` (index) →
`.../inventory/managing-inventory-quantities`, `.../managing-inventory-quantities/inventory-states`,
`.../inventory/transfers`.

**Shopify capabilities**
- Five named inventory states per location: **On hand** (= Committed + Unavailable + Available),
  **Available** (sellable; excludes committed, draft-order reservations, and Incoming),
  **Committed** (units on a placed but unfulfilled order; draft-order units are not committed),
  **Unavailable** (reserved for draft orders, set aside by apps, or held for damaged / quality control /
  safety stock), **Incoming** (en route from transfers or apps; sellable only on receipt).
- Inventory page at `admin.shopify.com/products/inventory`: viewing inventory, adjusting quantities,
  adjusting quantities **in bulk**.
- **Inventory adjustment history** per product and variant.
- **ABC inventory analysis**.
- Per-product/variant tracking toggle; low-stock alerts via apps / Shopify Flow.
- Inventory reports in the reports section; custom inventory-adjustment reports across locations.
- **Transfers**: create between store locations or from an external source; statuses **Ready to ship**,
  **In transit**, **Transferred**; origin and destination locations; tracking information; multiple
  shipments per transfer; receive **full or partial** inventory at the destination; barcode-scanner
  support; third-party-app-created transfers visible in admin.
- **Purchase orders** (linked from the inventory index as a distinct workflow).

**What exists here**
- Table `inventory_levels(product_id, variant_id, location_id, quantity)` — a *single* integer per row.
  No state decomposition, no history table.
- `src/app/(admin)/admin/products/inventory/page.tsx` — functional. Loads products where
  `track_inventory = true` and `status <> 'archived'`, joins variants + levels + locations.
- `src/app/(admin)/admin/products/inventory/inventory-grid.tsx` — functional. One editable number input
  per location per row, plus a computed Total column. Commits on blur via `adjustInventory` in
  `src/app/(admin)/admin/products/actions.ts:215` (a plain upsert on
  `product_id,variant_id,location_id`). No reason capture, no delta, no audit.
- Stock is decremented on order create / draft conversion and incremented on restock-refund by
  `adjustStock` in `src/app/(admin)/admin/orders/actions.ts:25` — **hard-coded to the default location**
  (`locations.is_default = true`), ignoring `orders.location_id`.
- `products.track_inventory` and `product_variants.track_inventory` / `continue_selling` exist
  (`0005_product_parity.sql`); `continue_selling` is never read anywhere in `src/`.
- `admin/products/transfers` and `admin/products/purchase-orders` are `<ComingSoon>` placeholders.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| On hand / Available / Committed / Unavailable / Incoming split | Missing | `inventory_levels`: rename `quantity`→`on_hand`, add `committed int`, `unavailable int`, `incoming int`, generated `available`; update `src/lib/types.ts` `InventoryLevel`, `inventory-grid.tsx` columns | L |
| Committed derived from unfulfilled orders | Missing | Trigger on `order_items`/`fulfillments` maintaining `inventory_levels.committed`; new migration | M |
| Draft-order reservation → Unavailable | Missing | Trigger keyed on `orders.is_draft`; `admin/orders/actions.ts` | M |
| Inventory adjustment history | Missing | New table `inventory_adjustments(id, product_id, variant_id, location_id, delta, reason, staff_user_id, created_at)`; write from `adjustInventory`; new page `admin/products/inventory/[id]/history` | M |
| Adjustment reasons (damaged, QC, safety stock, restock, correction) | Missing | `inventory_adjustments.reason` enum + select in `inventory-grid.tsx` | S |
| Bulk quantity edit | Missing | `inventory-grid.tsx` multi-select + bulk action bar; batched `adjustInventory` | M |
| Location-correct stock movement on orders | Partial (wrong) | `admin/orders/actions.ts:25` `adjustStock` — use `orders.location_id` with default fallback | S |
| `continue_selling` (oversell past zero) enforced | Partial (column only) | Read in `admin/orders/actions.ts` create path and in `src/lib/shop/queries.ts` availability | S |
| Low-stock threshold + alerts | Missing | `products`/`product_variants` add `low_stock_threshold int`; badge in `inventory-grid.tsx` | S |
| Transfers | Missing | Replace `admin/products/transfers/page.tsx`; new `transfers` + `transfer_items` + `transfer_shipments` tables with status enum `ready_to_ship\|in_transit\|transferred`, partial receive | L |
| Purchase orders | Missing | Replace `admin/products/purchase-orders/page.tsx`; new `purchase_orders` + `purchase_order_items` + `suppliers` | L |
| Incoming from transfers feeding inventory | Missing | Depends on transfers; trigger into `inventory_levels.incoming` | M |
| ABC analysis | Missing | `admin/analytics/reports` new report key over `order_items` + `inventory_levels` | M |
| Inventory CSV import/export | Missing | `admin/products/inventory` export button (mirror `analytics/reports/report-controls.tsx` `CsvExportButton`) + import action | M |

---

## 2. Fulfillment — setup

Source: `help.shopify.com/en/manual/fulfillment/setup` → `.../setup/locations`.

**Shopify capabilities**
- **Shipping rates**: flat rates, carrier-calculated real-time rates, free shipping over an order-value
  threshold.
- **Shipping profiles**: product-specific and location-specific rate rules (e.g. oversized items).
- **Packages**: define package dimensions and weights so carriers can cost shipments.
- **Locations**: configure storage/fulfillment locations; inventory tracked separately per location;
  maximum location count is plan-dependent; POS integration.
- **Order routing** rules — assign orders to a location by proximity and inventory availability.
- **Fulfillment services** — third-party handling; configure fulfillable inventory.
- **Delivery options**: local delivery, in-store pickup, third-party pickup-point networks.
- **Delivery timelines**: fulfillment timeframes, estimated delivery date at checkout, Shop Promise.
- **Notifications**: customer + staff notification templates (order confirmation, shipping updates,
  delivery alerts); **order status page** for post-purchase tracking.
- Shipping label purchase and printing; carbon-neutral shipping (Planet app).

**What exists here**
- Table `locations(id, name, address jsonb, is_default, created_at)` — no activation flag, no
  "fulfills online orders" flag, no priority.
- `src/app/(admin)/admin/settings/locations/page.tsx` + `location-dialog.tsx` — functional CRUD via
  `saveLocation` / `deleteLocation` in `src/app/(admin)/admin/settings/actions.ts:33,71`.
- `shop_settings.policies` jsonb holds a free-text `shipping` policy only
  (`admin/settings/policies/policies-form.tsx`).
- `products.requires_shipping`, `products.weight`, `products.weight_unit`, `hs_code`,
  `country_of_origin` and the variant equivalents exist (`0005_product_parity.sql`) but nothing
  consumes them.
- `admin/settings/shipping`, `admin/settings/checkout`, `admin/settings/taxes`,
  `admin/settings/notifications`, `admin/settings/markets` are all `<ComingSoon>`.
- No shipping-rate, shipping-zone, shipping-profile, package, or notification-template table exists.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Shipping zones + flat rates | Missing | `admin/settings/shipping/page.tsx` (replace placeholder); new `shipping_zones(name, countries text[])`, `shipping_rates(zone_id, name, price, min_order_subtotal, max_order_subtotal)` | M |
| Free shipping over threshold | Missing | `shipping_rates.min_order_subtotal` + price 0 | S |
| Carrier-calculated rates | Missing | `admin/settings/shipping`; external carrier API adapter under `src/lib/shipping/` | L |
| Shipping profiles (per-product / per-location rates) | Missing | `shipping_profiles`, `shipping_profile_products`, `shipping_profile_locations` | L |
| Package presets (dimensions, weight) | Missing | New `packages(name, length, width, height, unit, weight)`; `admin/settings/shipping` | S |
| Product weight/dimensions used in rating | Partial (columns only) | `products.weight`/`weight_unit` already exist; consume in rate calc | S |
| Location "fulfils online orders" toggle + deactivate | Missing | `locations` add `fulfills_online_orders boolean`, `active boolean`, `priority int`; `admin/settings/locations/location-dialog.tsx` | S |
| Order routing by priority / stock | Missing | `locations.priority`; routing helper in `src/lib/fulfillment/routing.ts`; set `orders.location_id` on create in `admin/orders/actions.ts` | M |
| Local delivery | Missing | `locations` add `local_delivery jsonb` (radius, postal codes, fee, minimum) | M |
| In-store pickup | Missing | `locations` add `pickup_enabled boolean`, `pickup_instructions text` | S |
| Fulfillment services / 3PL | Missing | `locations.type enum('own','fulfillment_service')` + service config | L |
| Processing time / estimated delivery date | Missing | `shop_settings` add `fulfillment_lead_days int`; `shipping_rates` add `min_transit_days`/`max_transit_days` | M |
| Notification templates (customer + staff) | Missing | `admin/settings/notifications/page.tsx` (replace placeholder); new `notification_templates(key, subject, body_html, enabled)` | M |
| Order status page | Missing | New `src/app/(shop)/orders/[token]/page.tsx`; `orders` add `status_page_token uuid` | M |
| Buy/print shipping labels | Missing | `admin/orders/[id]`; `fulfillments` add `label_url text`, `shipping_cost numeric` | L |

---

## 3. Fulfillment — managing orders

Source: `help.shopify.com/en/manual/fulfillment/managing-orders` →
`help.shopify.com/en/manual/orders/order-status`.

**Shopify capabilities**
- **Order status**: `Open`, `Archived`, `Canceled`.
- **Payment status**: `Pending`, `Authorized`, `Due`, `Expiring`, `Expired`, `Paid`, `Refunded`,
  `Partially refunded`, `Partially paid`, `Voided`, `Unpaid`.
- **Fulfillment status**: `Unfulfilled`, `In progress`, `On hold`, `Scheduled`, `Partially fulfilled`,
  `Fulfilled`, `Fulfillment not required`.
- **Return status**: `Return requested`, `Return in progress`, `Returned`, `Inspection complete`.
- Actions: capture payment (manual or automatic); **edit an order** (add/remove products, change
  quantities, update shipping fees, apply discounts); full and **partial refunds**; **cancel** an order;
  create **returns with exchange items**; print **packing slips and invoices**.
- Search orders by order number, customer name, or product; filter by fulfillment status, payment
  method, or date range.
- Create orders on behalf of customers (phone/in-person/email); **draft orders** — add products, apply
  discounts, send an invoice with a checkout link.
- Address validation; **return rules and self-serve returns**; high-risk order review via fraud
  analysis; **export orders**; order forecasting/analytics; Shopify Flow automation.

**What exists here**
- Enums in `0001_init.sql`: `payment_status` = `pending | paid | partially_refunded | refunded` (4 of
  Shopify's 11); `fulfillment_status` = `unfulfilled | partial | fulfilled` (3 of 7). Mirrored in
  `src/lib/types.ts:3-4`. No order-status enum, no return-status enum.
- `orders` columns: `order_number`, `customer_id`, `is_draft`, `payment_status`, `fulfillment_status`,
  `subtotal`, `discount_total`, `discount_code`, `total`, `currency`, `note`, `location_id`,
  `created_at`, `closed_at`. **No** shipping address, billing address, email, phone, shipping cost, tax,
  cancelled_at, cancel_reason, or risk fields.
- `src/app/(admin)/admin/orders/page.tsx` — functional. Tabs All / unfulfilled / unpaid / open / closed
  (open/closed keyed on `closed_at`, standing in for archive). Search only matches a numeric
  `order_number` — name and product search are absent.
- `src/app/(admin)/admin/orders/[id]/page.tsx` — functional read view: items, totals, fulfillments,
  refunds, customer card, note.
- `src/app/(admin)/admin/orders/actions.ts` — `createOrder`, `convertDraftToOrder`, `markOrderPaid`,
  `fulfillOrder`, `refundOrder`, `deleteOrder`. Refund updates `payment_status` to `refunded` /
  `partially_refunded` and can restock.
- `src/app/(admin)/admin/orders/new/order-builder.tsx` + `drafts/page.tsx` — functional draft-order
  creation with discount-code validation against `discounts`.
- `admin/orders/abandoned` is a `<ComingSoon>` placeholder.
- No timeline/event log, no `order_edits`, no `returns` table, no invoice/packing-slip output,
  no export.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Cancel order (vs. hard delete) | Missing | `orders` add `cancelled_at timestamptz`, `cancel_reason text`; replace `deleteOrder` in `admin/orders/actions.ts:252` with `cancelOrder` (restock + refund) | S |
| Archive order as an explicit state | Partial | `closed_at` is overloaded; add `orders.archived_at`; tab in `admin/orders/page.tsx` | S |
| Full payment-status set (authorized, partially_paid, voided, unpaid, expired) | Partial | Extend `payment_status` enum in a new migration; `src/lib/types.ts:3`; `src/components/admin/status-badges.tsx` | M |
| Authorize then capture | Missing | `orders` add `authorized_at`, `captured_at`; `markOrderPaid` → `capturePayment` | M |
| Partially paid / balance due | Missing | New `payments(order_id, amount, kind, gateway, created_at)`; derive `payment_status` | M |
| Edit an order (line items, quantities, shipping, discounts) | Missing | New `admin/orders/[id]/edit/page.tsx` + `editOrder` action; `order_items` needs stock reconciliation | L |
| Returns + exchanges | Missing | New `returns(order_id, status, reason)`, `return_items`; `return_status` enum; `admin/orders/[id]` panel | L |
| Return rules / self-serve returns | Missing | `shop_settings` add `return_rules jsonb`; storefront route | M |
| Shipping + billing address on order | Missing | `orders` add `shipping_address jsonb`, `billing_address jsonb`, `email text`, `phone text`; render in `admin/orders/[id]/page.tsx` | S |
| Tax and shipping totals on order | Missing | `orders` add `tax_total numeric`, `shipping_total numeric`; totals block in `admin/orders/[id]/page.tsx` | S |
| Packing slips / invoices | Missing | New `admin/orders/[id]/packing-slip/page.tsx` (print stylesheet) | M |
| Order timeline / event log | Missing | New `order_events(order_id, kind, message, staff_user_id, created_at)`; write from every action in `admin/orders/actions.ts` | M |
| Search by customer name or product | Partial | `admin/orders/page.tsx:45` — only numeric order_number; add RPC or joined `ilike` | S |
| Filter by date range / payment method | Missing | `admin/orders/page.tsx` searchParams + `FilterTabs`/date control | S |
| Export orders CSV | Missing | `admin/orders/page.tsx`; reuse `CsvExportButton` from `admin/analytics/reports/report-controls.tsx` | S |
| Send draft-order invoice with checkout link | Missing | `orders` add `invoice_sent_at`, `checkout_token`; action in `admin/orders/actions.ts` | M |
| Fraud / risk analysis | Missing | `orders` add `risk_level text`, `risk_signals jsonb` | L |
| Address validation | Missing | `admin/orders/new/order-builder.tsx`; external address API | M |

---

## 4. Fulfillment — fulfilling orders

Source: `help.shopify.com/en/manual/fulfillment/fulfilling-orders` (index; sub-pages returned no
additional detail).

**Shopify capabilities**
- Fulfil orders yourself (pick, pack, ship), or via a fulfillment service / app / Amazon multi-channel.
- Custom fulfillment via email integration.
- **Fulfil orders individually**; **batch fulfillment** across multiple orders; **bulk** order
  fulfillment.
- **Mixed fulfillment** — different fulfillment methods for different items in the same order.
- Fulfil local-delivery orders; fulfil subscription orders.
- Mark an order **on hold**.
- Buy and print **shipping labels** from the admin, individually or in bulk; schedule pickups; create
  **manifests**; track shipments; supported carriers with discounted rates; supported label printers.
- Print pick/pack documents (packing slips) and manifests.
- Manage shipping disruptions.

**What exists here**
- Table `fulfillments(id, order_id, tracking_number, carrier, status, created_at)`. `status` is a bare
  `text` defaulting to `'fulfilled'`. **No line-item linkage** — a fulfillment cannot reference which
  `order_items` it covers, so partial fulfillment is structurally impossible.
- `fulfillOrder(orderId, trackingNumber, carrier)` in `src/app/(admin)/admin/orders/actions.ts:170` —
  inserts one fulfillment row, then sets the whole order to `fulfillment_status = 'fulfilled'` and
  stamps `closed_at`. There is no code path that ever writes `'partial'`, despite the enum value.
- `src/app/(admin)/admin/orders/[id]/order-actions.tsx` `FulfillDialog` — functional, two fields
  (carrier, tracking number). No tracking URL, no "notify customer", no item selection, no location.
- `src/app/(admin)/admin/orders/[id]/page.tsx:187-210` lists fulfillments read-only.
- No hold, no cancel-fulfillment, no bulk action, no labels, no manifests.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Partial fulfillment (per line item) | Missing | New `fulfillment_items(fulfillment_id, order_item_id, quantity)`; rewrite `fulfillOrder` in `admin/orders/actions.ts:170` to derive `unfulfilled\|partial\|fulfilled`; item picker in `order-actions.tsx` | M |
| Fulfil from a specific location | Missing | `fulfillments` add `location_id uuid references locations`; select in `FulfillDialog` | S |
| Fulfillment hold + hold reason | Missing | Extend `fulfillment_status` enum with `on_hold`; `orders` add `hold_reason text`, `hold_note text`; button in `admin/orders/[id]/order-actions.tsx` | S |
| `in_progress`, `scheduled`, `not_required` statuses | Missing | Extend `fulfillment_status` enum; `src/lib/types.ts:4`; `src/components/admin/status-badges.tsx` | S |
| Cancel a fulfillment | Missing | `fulfillments.status` → enum with `cancelled`; action in `admin/orders/actions.ts` | S |
| Tracking URL + carrier picker | Partial | `fulfillments` add `tracking_url text`; carrier enum/list in `order-actions.tsx` (currently free text) | S |
| Notify customer on fulfillment | Missing | `fulfillments` add `notify_customer boolean`, `notified_at`; email sender in `src/lib/email/` | M |
| Bulk / batch fulfil from the orders list | Missing | Row selection in `admin/orders/page.tsx` + `bulkFulfill` action | M |
| Packing slip / pick list printing | Missing | New `admin/orders/[id]/packing-slip/page.tsx`; bulk variant for selected orders | M |
| Buy + print shipping labels, manifests, pickups | Missing | `fulfillments` add `label_url`, `manifest_id`; carrier integration under `src/lib/shipping/` | L |
| Third-party fulfillment services | Missing | `locations.type` + `fulfillment_services` table; webhook receiver route | L |
| Mixed fulfillment in one order | Missing | Falls out of `fulfillment_items` + `fulfillments.location_id` | M |

---

## 5. Marketing

Source: `help.shopify.com/en/manual/promoting-marketing/create-marketing` →
`.../create-marketing/marketing-automations`.

**Shopify capabilities**
- **Campaigns** — group activities (email, social posts, paid ads) under one campaign with a shared
  goal, and track results per campaign.
- **Email and SMS campaigns and automations** (Shopify Messaging); subscriber list management and
  segmentation; automations fire on customer actions and send only to marketing-subscribed customers.
- **Abandoned checkout recovery** automation (exempt from Messaging email limits).
- Named automation triggers documented: **abandoned cart/checkout**, **newsletter signup**.
- **Campaign Autopilot** — recommended tactics, auto-created automations labelled in Messaging.
- **Sign-up forms** — popup and inline (Shopify Forms) collecting contact info with consent.
- **Customer segments** used as campaign audiences.
- **Paid ads**: Shop app ads, Shop website ads, Shopify Product Network, Shop Campaigns (third-party
  platforms), Facebook and Instagram ads via Meta.
- **Social sharing** — post blog posts, products, and collections to social accounts; cross-posting.
- **Attribution**: shareable links, QR codes, UTM auto-match rules; results tracking across channels.
- **Launchpad** (Plus) — schedule product drops, sales events, inventory restocks.

**What exists here**
- `src/app/(admin)/admin/marketing/page.tsx` and `admin/marketing/automations/page.tsx` — both
  `<ComingSoon>`. Nav entries exist in `src/components/admin/nav.ts:79-84`.
- `admin/orders/abandoned` — `<ComingSoon>`. No abandoned-checkout table exists.
- `admin/social-channels/page.tsx` — `<ComingSoon>`.
- The only adjacent real feature is discounts: `admin/discounts/page.tsx`, `discount-dialog.tsx`,
  `actions.ts` (`saveDiscount`, `toggleDiscount`, `deleteDiscount`) over table `discounts`
  (`code`, `type`, `value`, `min_purchase`, `usage_limit`, `used_count`, `once_per_customer`,
  `starts_at`, `ends_at`, `status`).
- `customers.accepts_marketing boolean` exists and is editable in
  `admin/customers/customer-form.tsx`; nothing consumes it.
- `segments` table + `admin/customers/segments` are functional (see §9) and would be the audience source.
- No campaign, activity, automation, form, subscriber, or UTM table. No email-sending code anywhere in
  `src/`.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Email sending infrastructure | Missing | New `src/lib/email/` (provider client + templates); env keys | M |
| Marketing campaigns (group activities, track results) | Missing | Replace `admin/marketing/page.tsx`; new `campaigns(name, goal, status, starts_at, ends_at)`, `campaign_activities(campaign_id, channel, status, sent_at)` | L |
| Email campaign composer + send to segment | Missing | New `admin/marketing/campaigns/[id]/page.tsx`; `campaign_activities` + `segments.filters` via `src/lib/segments.ts` | L |
| Marketing automations (abandoned checkout, newsletter signup) | Missing | Replace `admin/marketing/automations/page.tsx`; new `automations(trigger, template, status)`, `automation_runs` | L |
| Abandoned checkout capture | Missing | Blocked on checkout. New `checkouts(id, email, line_items jsonb, abandoned_at, recovered_order_id)`; replace `admin/orders/abandoned/page.tsx` | L |
| Marketing consent state (email/SMS) | Partial | `customers.accepts_marketing` is a single boolean — split into `email_marketing_consent jsonb`, `sms_marketing_consent jsonb` with opt-in timestamps; `admin/customers/customer-form.tsx` | S |
| Sign-up forms (popup / inline) | Missing | New `forms(name, type, fields jsonb, active)`, `form_submissions`; storefront component under `src/components/shop/` | M |
| UTM parameter capture + attribution | Missing | `orders` add `utm jsonb`, `referring_site text`, `landing_page text`; capture in storefront; report in `admin/analytics/reports` | M |
| Shareable links + QR codes | Missing | New `marketing_links(slug, target_url, utm jsonb, clicks int)`; redirect route `src/app/go/[slug]/route.ts` | S |
| Social posting / cross-posting | Missing | Replace `admin/social-channels/page.tsx`; per-network OAuth tokens table | L |
| Paid ads (Meta / Google) | Missing | `admin/marketing`; external ad-platform integration | L |
| Scheduled sale/drop events | Missing | `discounts.starts_at`/`ends_at` already exist; add `products.published_at` scheduling job (column exists, unused) | M |

---

## 6. SEO

Source: `help.shopify.com/en/manual/promoting-marketing/seo` → `.../seo/adding-keywords`.

**Shopify capabilities**
- **Page title** (title tag) — editable on products, collections, pages, blog posts, and the homepage;
  up to 70 characters, 60 recommended.
- **Meta description** — editable on the same surfaces; 160 characters recommended.
- **Image alt text** — product images, collection featured images, blog post featured images.
- **H1 header** — derived automatically from the page title field.
- Page body content guidance — 250 words minimum, 500+ for informational pages/blog posts.
- **Keywords** research and placement workflow.
- **Editing `robots.txt.liquid`** to control crawling.
- **Site structure** optimisation for search engines.
- **Finding and submitting your sitemap**.
- **Hiding a page from search engines**.
- Optimising the store for AI; crawling your store.

**What exists here**
- `products.seo_title`, `products.seo_description` (`0001_init.sql`), surfaced in
  `admin/products/product-form.tsx` and typed in `src/lib/types.ts:35-36`.
- `products.handle` — added in `0005_product_parity.sql` with `slugify()` /
  `unique_product_handle()` and a unique index. **Not exposed in any form**; `product-draft.tsx:45`
  models it but is orphaned.
- `product_images.alt` — editable through `src/components/admin/media-uploader.tsx`.
- `collections.handle` — set from the title via `handleize()` in
  `admin/products/collections/actions.ts:24`; not editable, and `collections` has **no** `seo_title` /
  `seo_description` columns.
- Storefront pages `src/app/(shop)/products/[id]/page.tsx` and
  `src/app/(shop)/collections/[handle]/page.tsx` exist; products are routed by **id, not handle**.
- No `sitemap.ts`, no `robots.ts`, no `generateMetadata` using `seo_title`/`seo_description`, no
  JSON-LD, no canonical handling, no redirects table — nothing matching those names appears anywhere
  under `src/`.
- `admin/online-store` (pages, blog posts, navigation) is a `<ComingSoon>` placeholder, so there are no
  CMS pages or blog posts to optimise.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| SEO fields rendered into storefront `<head>` | Missing | `generateMetadata` in `src/app/(shop)/products/[id]/page.tsx` and `collections/[handle]/page.tsx`, reading `products.seo_title`/`seo_description` | S |
| Editable URL handle on products | Partial (column only) | `products.handle` exists; add the input to `admin/products/product-form.tsx` and switch it to the `save_product` payload in `product-draft.tsx` | S |
| Product storefront routing by handle | Partial | Move `src/app/(shop)/products/[id]/` → `[handle]/`; update `src/lib/shop/queries.ts` | S |
| Character counters / limits (70 / 160) + Google preview | Missing | `admin/products/product-form.tsx` SEO card | S |
| Collection SEO title + description | Missing | `collections` add `seo_title text`, `seo_description text`; `admin/products/collections/collection-form.tsx` | S |
| Editable collection handle | Missing | `admin/products/collections/actions.ts:24` currently forces `handleize(title)` | S |
| sitemap.xml | Missing | New `src/app/sitemap.ts` over active products + collections | S |
| robots.txt | Missing | New `src/app/robots.ts`; `shop_settings` add `robots_txt text` for overrides | S |
| Hide a page/product from search engines | Missing | `products`/`collections` add `noindex boolean`; honour in `generateMetadata` | S |
| URL redirects | Missing | New `url_redirects(from_path, to_path)` + handling in `src/proxy.ts`; admin page under `admin/online-store` | M |
| Structured data (JSON-LD Product/Offer) | Missing | `src/app/(shop)/products/[handle]/page.tsx` | S |
| Canonical URLs | Missing | `generateMetadata` `alternates.canonical` in both shop routes | S |
| Image alt text on collection images | Missing | `collections.image_url` has no alt column | S |
| Blog / CMS pages to optimise | Missing | Blocked on `admin/online-store`; new `pages`, `blogs`, `blog_posts` tables | L |

---

## 7. Online sales channels

Source: `help.shopify.com/en/manual/online-sales-channels` → `.../manage-sales-channels`.

**Shopify capabilities**
- Channels: **Facebook**, **Instagram**, **TikTok**, **Google**, **Amazon** (Marketplace Connect),
  **Temu**, **Shop**, **Shopify agentic storefronts**, **Shopify Collective**, **Buy Button**,
  **WordPress**, plus third-party channels from the App Store.
- **Add or remove sales channels**.
- **Customise product availability per channel**.
- **Adjust pricing per channel** and configure **currency per channel** (Sales channels and Markets).

**What exists here**
- No channel concept in the schema at all. `products.status` is the only visibility control
  (`draft | active | archived`) and `products.published_at` (added in `0005_product_parity.sql`) is
  never read.
- The sidebar shows three channels — `src/components/admin/nav.ts:88-92` — and all three targets are
  placeholders: `admin/online-store/page.tsx`, `admin/pos/page.tsx`,
  `admin/social-channels/page.tsx` are `<ComingSoon>`.
- `admin/settings/apps` ("Apps and sales channels") and `admin/settings/markets` are `<ComingSoon>`.
- The storefront is a single hard-wired surface: `src/app/(shop)/page.tsx`,
  `products/[id]/page.tsx`, `collections/[handle]/page.tsx`, served from
  `src/lib/shop/queries.ts`. Public visibility is enforced solely by
  `0003_storefront_public_read.sql`, which grants `anon` select on `products` where
  `status = 'active'`.
- `admin/products/price-lists` — `<ComingSoon>`; no per-channel or per-market price table.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Channel entity | Missing | New `sales_channels(id, handle, name, active)` seeded with `online_store`, `pos` | S |
| Per-product channel publishing | Missing | New `product_publications(product_id, channel_id, published_at)`; publishing card in `admin/products/product-form.tsx`; filter `src/lib/shop/queries.ts` on the online-store channel | M |
| Scheduled publishing | Partial (column only) | `products.published_at` exists and is unused; honour it in `src/lib/shop/queries.ts` and `0003` RLS policy | S |
| Bulk publish / unpublish | Missing | Row selection + bulk action bar in `admin/products/page.tsx` | M |
| Online Store admin (themes, pages, menus) | Missing | Replace `admin/online-store/page.tsx`; new `pages`, `navigation_menus` tables | L |
| Point of Sale | Missing | Replace `admin/pos/page.tsx`; `locations` + `orders.location_id` are the hooks that already exist | L |
| Social channels (Facebook/Instagram/TikTok) | Missing | Replace `admin/social-channels/page.tsx`; per-channel OAuth + product feed sync | L |
| Google / Amazon / marketplace feeds | Missing | New `src/app/feeds/[channel]/route.ts` product feed generator | M |
| Buy Button / embeddable | Missing | New `src/app/embed/[handle]/route.ts` | M |
| Per-channel pricing | Missing | Replace `admin/products/price-lists/page.tsx`; new `price_lists(channel_id, currency)`, `price_list_prices(price_list_id, variant_id, price)` | L |
| Per-channel currency / markets | Missing | `admin/settings/markets` (placeholder); new `markets`, `market_currencies` | L |

---

## 8. Reports and analytics

Source: `help.shopify.com/en/manual/reports-and-analytics` →
`.../shopify-reports/report-types`, `.../report-types/default-reports`.

**Shopify capabilities**
- Analytics and reports covering sales and customers in detail; availability is **plan-gated**.
- Default report **categories**: Acquisition, Behavior, Customers, Finance, Fraud, Inventory,
  Marketing, Order, Profit, Retail sales, Sales.
- Reports render as **graphs and tables**, capped at **1,000 rows**.
- **Export** reports.
- **ShopifyQL editor** for custom queries; **customising and managing reports** (saved custom reports).
- **Google Analytics** integration.
- (Named individual reports are behind per-category sub-pages that were not enumerable from the fetched
  pages, so they are not asserted here.)

**What exists here**
- `src/app/(admin)/admin/analytics/page.tsx` — functional dashboard, fixed 30-day window: KPI cards
  (Total sales, Orders, Average order value, Fulfilled rate), Sales-over-time area chart, Orders-per-day
  bar chart, Top-products-by-revenue bar chart, via `src/components/admin/charts.tsx`. Paid revenue is
  `payment_status in ('paid','partially_refunded')`. Refunds are **not** subtracted.
- `src/app/(admin)/admin/analytics/reports/page.tsx` — functional. Five reports: `sales_by_day`,
  `by_product`, `by_customer`, `payment_status`, `discounts`. Free date range via `DateRangeFilter` and
  CSV export via `CsvExportButton`, both in `analytics/reports/report-controls.tsx`.
- `src/app/(admin)/admin/page.tsx` — home dashboard.
- `src/app/(admin)/admin/analytics/live/page.tsx` — `<ComingSoon>`.
- All reporting is computed in the request handler over `orders` + `order_items`. There is no
  `report_definitions` table, no saved reports, no scheduling, no comparison period.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Date-range selector on the dashboard | Missing | `admin/analytics/page.tsx` — hard-coded 30 days at line 24; reuse `DateRangeFilter` | S |
| Period-over-period comparison | Missing | `admin/analytics/page.tsx` + `admin/analytics/reports/page.tsx` | M |
| Refunds netted out of sales metrics | Partial (wrong) | `admin/analytics/page.tsx:45` and `reports/page.tsx:60` count gross; subtract `refunds.amount` | S |
| Inventory reports (on-hand value, sell-through, ABC) | Missing | `admin/analytics/reports/page.tsx` new report keys over `inventory_levels` + `products.cost_per_item` | M |
| Profit / margin reports | Missing | `order_items` add `cost_snapshot numeric` (populate from `cost_per_item` at order time); new report key | M |
| Finance summary (gross, discounts, returns, net, tax, shipping) | Missing | Blocked on `orders.tax_total`/`shipping_total`; new report key | M |
| Acquisition / behaviour / sessions | Missing | Blocked on storefront analytics. New `store_sessions(id, path, referrer, utm jsonb, created_at)` + pixel route | L |
| Marketing / attribution reports | Missing | Blocked on `orders.utm`; new report key | M |
| Customer cohort / retention / first-vs-returning | Missing | New report keys over `orders` + `customers.orders_count` | M |
| Live view | Missing | Replace `admin/analytics/live/page.tsx`; Supabase realtime on `orders` + `store_sessions` | M |
| Saved / custom reports | Missing | New `saved_reports(name, definition jsonb, created_by)`; `admin/analytics/reports` | M |
| Report row cap + pagination | Missing | `admin/analytics/reports/page.tsx` builds unbounded arrays in memory | S |
| Scheduled report email | Missing | Blocked on email infra; `saved_reports` add `schedule text` | M |
| Third-party analytics (GA4 / pixels) | Missing | `admin/settings/customer-events` (placeholder); `shop_settings` add `pixels jsonb`; inject in `src/app/(shop)/layout.tsx` | S |

---

## 9. Customers

Source: `help.shopify.com/en/manual/customers` → `.../customers/manage-customers`.

**Shopify capabilities**
- Profile fields: first name, last name, email, phone, **language**, customer notes, **multiple
  addresses**, **VAT number**, **tax collection settings**, **tax exemptions**, **marketing consent
  (email, SMS, WhatsApp)**, tags, saved **payment methods**, **timeline / order history**,
  subscription info, **store credit account**, gift cards.
- Actions: add a customer manually; edit contact info; manage addresses (edit, add, **set as default**);
  add/remove tags; add notes.
- Communication: send a direct email to the customer; review sent emails; **resend automatic
  notification emails**.
- Marketing: edit marketing settings per channel; build **customer segments** for bulk messaging.
- Advanced: **merge duplicate profiles**; **erase a customer's personal data** (data erasure request);
  delete individual or **bulk** profiles; edit subscription payment info; **bulk edit** profiles;
  manage tax settings (VAT, exemptions, collection preferences).
- Also documented: search for customer profiles, **import/export customer lists**, import Mailchimp
  contacts, resolve CSV errors, store credit, customer accounts (self-serve address book + order
  status), privacy/GDPR.

**What exists here**
- Table `customers(first_name, last_name, email unique, phone, notes, tags text[], default_address
  jsonb, accepts_marketing boolean, total_spent, orders_count, created_at)`. `total_spent` and
  `orders_count` are maintained by the `refresh_customer_stats()` trigger on `orders`
  (`0001_init.sql:278-297`).
- `src/app/(admin)/admin/customers/page.tsx` — functional list with search.
- `src/app/(admin)/admin/customers/[id]/page.tsx` — functional: amount-spent / orders KPI cards,
  order history table with payment + fulfillment badges, embedded `CustomerForm`.
- `src/app/(admin)/admin/customers/customer-form.tsx` + `new/page.tsx` — functional create/edit:
  first name, last name, email, phone, notes, tags, `accepts_marketing`, and a single
  `default_address`.
- `src/app/(admin)/admin/customers/actions.ts` — `saveCustomer`, `deleteCustomer`, `saveSegment`,
  `deleteSegment`.
- `src/app/(admin)/admin/customers/segments/` (`page.tsx`, `segment-builder.tsx`,
  `segment-delete.tsx`) + `src/lib/segments.ts` — functional. Filter fields limited to
  `total_spent | orders_count | country | accepts_marketing | tag` with operators
  `equals | greater_than | less_than | contains` (`src/lib/types.ts:129-133`).
- `gift_cards.customer_id` links gift cards to customers (`admin/products/gift-cards`).
- `admin/customers/companies` — `<ComingSoon>` (B2B).
- No `customer_addresses` table (one embedded `default_address` only), no timeline, no merge, no
  import/export, no tax fields, no store credit, no customer-account login on the storefront.

**Gap**

| Capability | Status | Where it would live | Effort |
|---|---|---|---|
| Multiple addresses + set default | Partial | `customers.default_address` is a single jsonb; new `customer_addresses(customer_id, ..., is_default)`; `admin/customers/customer-form.tsx` | M |
| Language field | Missing | `customers` add `locale text`; `customer-form.tsx` | S |
| Per-channel marketing consent (email / SMS) | Partial | Split `customers.accepts_marketing` into `email_marketing_consent jsonb`, `sms_marketing_consent jsonb` with opt-in timestamp and source | S |
| Tax exemption / VAT number / tax collection | Missing | `customers` add `tax_exempt boolean`, `tax_exemptions text[]`, `vat_number text` | S |
| Customer timeline (orders, emails, notes, edits) | Missing | New `customer_events(customer_id, kind, message, staff_user_id, created_at)`; panel in `admin/customers/[id]/page.tsx` | M |
| Merge duplicate profiles | Missing | New `merge_customers(keep_id, merge_id)` SQL function repointing `orders.customer_id` + `gift_cards.customer_id`; action in `admin/customers/actions.ts` | M |
| Bulk edit / bulk delete | Missing | Row selection in `admin/customers/page.tsx` + bulk actions | M |
| CSV import / export | Missing | `admin/customers/page.tsx`; export reuses `CsvExportButton`; import needs a parser + error report | M |
| GDPR data erasure / data request | Missing | New `data_requests(customer_id, kind, status)`; anonymisation function; `admin/customers/[id]` | M |
| Store credit account | Missing | New `store_credit_accounts(customer_id, balance, currency)`, `store_credit_transactions` | M |
| Saved payment methods | Missing | Blocked on payments; `customer_payment_methods` | L |
| Send email to customer / resend notification | Missing | Blocked on email infra; button in `admin/customers/[id]/page.tsx` | M |
| Customer accounts on the storefront | Missing | New `src/app/(shop)/account/**` using Supabase auth; RLS policies for `anon`→`authenticated` customer scope | L |
| Richer segment fields (product purchased, last order date, location, RFM) | Partial | `src/lib/types.ts:129` `SegmentFilter` + `src/lib/segments.ts` + `segments/segment-builder.tsx` | M |
| Companies / B2B | Missing | Replace `admin/customers/companies/page.tsx`; new `companies`, `company_locations`, `company_contacts` | L |
| Subscriptions | Missing | New `subscription_contracts`, `selling_plans` | L |

---

## Build order

Fifteen highest-value items across all areas, ordered by merchant value ÷ effort.
"(schema)" marks items blocked behind a migration.

1. Wire `product-form.tsx` to `save_product()` via the orphaned `product-draft.tsx` — 0005 already
   shipped the atomic RPC, handle, category, weight, HS code and `continue_selling`; the UI still uses
   the destructive pre-0005 `saveProduct`. Highest value per unit of effort in the repo. (no schema)
2. Fix `adjustStock` in `admin/orders/actions.ts:25` to use `orders.location_id` instead of always the
   default location — multi-location stock is silently wrong today. (no schema)
3. Add `generateMetadata` (title, description, canonical) + `src/app/sitemap.ts` + `src/app/robots.ts`
   to the storefront; the `seo_title`/`seo_description` columns are populated and currently render
   nowhere. (no schema)
4. Route storefront products by `handle` instead of `id` and expose the handle field in the product
   form. (no schema; column exists)
5. Cancel-order action replacing `deleteOrder` (restock + refund + `cancelled_at`, `cancel_reason`) —
   destroying order rows is currently the only way to void one. (schema)
6. Order shipping/billing address, email, phone, `tax_total`, `shipping_total` on `orders` and rendered
   in `admin/orders/[id]` — an order today has no address at all. (schema)
7. Partial fulfillment: `fulfillment_items` + `fulfillments.location_id`, and make `fulfillOrder`
   derive `unfulfilled | partial | fulfilled`; the `partial` enum value is currently unreachable.
   (schema)
8. Fulfillment `on_hold` status + hold reason. (schema)
9. Inventory adjustment history with reasons — `inventory_adjustments` written from `adjustInventory`;
   unlocks accountability and the inventory reports. (schema)
10. `sales_channels` + `product_publications` + honour `products.published_at` in
    `src/lib/shop/queries.ts` and the `0003` anon policy — makes publishing real and unblocks scheduled
    drops. (schema)
11. Net refunds out of `admin/analytics/page.tsx` and `analytics/reports/page.tsx`, and add a date-range
    selector to the dashboard — the sales figures are overstated today. (no schema)
12. Order timeline (`order_events`) written from every action in `admin/orders/actions.ts`. (schema)
13. Committed / Available / On-hand split on `inventory_levels`, with a trigger deriving `committed`
    from unfulfilled `order_items`. Largest single inventory-fidelity win. (schema)
14. Email infrastructure under `src/lib/email/` — the shared blocker for order notifications,
    fulfillment notices, draft-order invoices, abandoned-checkout recovery, and all of Marketing.
    (no schema)
15. Shipping zones + flat rates in `admin/settings/shipping` — first non-placeholder settings page and
    the prerequisite for a working checkout. (schema)
