# Hazestudios

A Shopify-style ecommerce admin dashboard built with **Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui + Supabase**.

## Setup

1. **Create a Supabase project** (free tier is fine): https://supabase.com/dashboard
2. **Run the migration**: open the Supabase SQL editor and paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), then run it.
   This creates all tables, RLS policies, storage buckets (`product-images`, `files`, `brand`),
   the default location, and a trigger that makes the **first signup the store Owner**.
3. **Configure env vars**: copy `.env.local.example` to `.env.local` and fill in your
   project URL and keys from *Settings → API* in Supabase.
4. **(Recommended)** In Supabase *Authentication → Providers → Email*, disable
   "Confirm email" for local development so you can sign in immediately after signup.
5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

6. Open http://localhost:3000 → you'll be redirected to `/login`.
   Click **"First time here? Create the owner account"** to create your admin login.

## What's functional

- **Products** — full Shopify-style form: title, rich-text description with raw-HTML `<>` toggle,
  drag-drop multi-image upload with reorder, pricing (price/compare-at/cost with margin),
  SKU/barcode, multi-location inventory, variants builder (up to 3 options, auto-generated
  combinations), tags, product type, vendor, collections, SEO fields, draft/active/archived status
- **Collections** — manual and smart (rule-based: tag/title/vendor/type/price conditions)
- **Inventory** — stock grid per location with inline adjustments
- **Gift cards** — issue, disable, track balances
- **Orders** — list with All/Unfulfilled/Unpaid/Open/Closed tabs and payment/fulfillment badges,
  manual order creation with line items and discount codes, draft orders with convert-to-order,
  mark as paid, fulfillment with tracking numbers, partial/full refunds with optional restock
- **Customers** — profiles with addresses/tags/notes, order history, auto-maintained
  total-spent/order-count, and saved segments (filter builder)
- **Discounts** — percentage / fixed / free-shipping codes with usage limits and date windows
- **Content → Files** — media library on Supabase Storage (upload, search, copy URL, delete)
- **Analytics** — 30-day dashboard (sales, orders, AOV, fulfillment rate, charts, top products)
  and **Reports** (sales by day/product/customer, payment status, discount usage) with date
  filters and CSV export
- **Settings** — store details, users & roles (owner/admin/staff), locations, brand
  (logo/colors/slogan), policy pages

Everything else in the sidebar (abandoned checkouts, purchase orders, transfers, price lists,
B2B companies, metaobjects, live view, marketing, POS, online store, etc.) has a styled
placeholder page tagged with its roadmap phase.

## Roadmap

- **Phase S — Storefront (next)**: customer-facing site on the same database, cart, Stripe
  checkout. Unlocks abandoned checkouts, live view, and payment/shipping/tax/checkout settings.
- **Phase 2**: purchase orders, transfers.
- **Phase 3**: marketing campaigns & automations, notification templates, metaobjects,
  custom data, B2B companies, price lists, markets, languages.
- **Phase 4**: POS, social channels, domains, apps.

## Architecture notes

- All reads happen in **server components**; all writes go through **server actions**
  (`src/app/(admin)/*/actions.ts`) using the Supabase server client.
- Auth is Supabase email/password; `src/middleware.ts` guards every route and refreshes sessions.
- RLS restricts every table to authenticated staff. Storage buckets are public-read,
  authenticated-write.
- `order_items` stores title/price **snapshots**, so editing a product never rewrites order history.
- Domain types live in `src/lib/types.ts`; smart-collection and segment rule evaluation in
  `src/lib/smart-collections.ts` / `src/lib/segments.ts`.
