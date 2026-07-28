# Handoff — 2026-07-28

Paste the block below into a fresh agent session to resume.

---

## Context

I'm working on **Hazestudios** (`c:\Users\Ammaar\Desktop\Hazestudios`) — a Shopify-clone
storefront + admin built with Next.js 16 (App Router, Turbopack) + Supabase + Tailwind v4 +
shadcn/ui. Admin lives at `/admin`, storefront owns `/`. Migrations run via
`npm run db:status | db:migrate` (NOT the Supabase SQL editor). Read `AGENTS.md` first —
this Next.js version has breaking changes, so check `node_modules/next/dist/docs/` before
writing code.

Two pieces of work landed in the last session. Both build clean (`tsc`, `eslint`, `next build`).

### 1. Storefront home page + chrome — DONE

Rebuilt `/` as a replica of my Shopify draft theme ("Palo Alto 2026"), specifically the
`/pages/men` page — *not* the store root, which is a different homepage. Kept the existing
liquid-glass material language; replaced everything else.

- Content/artwork config: `src/lib/shop/home-content.ts`, images in `public/haze/*.webp`
- Sections: `src/components/shop/home-sections.tsx`, `tab-carousel.tsx`,
  `product-rail.tsx`, `rail-card.tsx`, `announcement-bar.tsx`
- Rewrote `header.tsx` (mega-menu) and `footer.tsx` (dark, newsletter)
- New CSS primitives in `globals.css`: `.rail` (scroll-snap carousel), `.marquee`
- Added `/search` (the header magnifier had nowhere to point)
- Products come from Supabase collections; sections whose collection is missing are skipped

**Known open items:**
- The mega-menu renders flat — none of the authored collection handles in `home-content.ts`
  exist in Supabase yet (DB has only `ss26-drop-01`, `knitwear`, `archive`, `outerwear`).
  Creating collections with those handles lights it up; no code change needed.
- Prices render as USD (`$68.00`), because `shop_settings.currency = 'USD'` and `Price`
  defaults to it. Shopify shows ₹. Decide whether the storefront should read currency
  from settings.

### 2. Qikink print-on-demand integration — DONE, BLOCKED ON LIVE CREDENTIALS

Qikink is my POD supplier. Migration `0016_qikink.sql` applied.

- `src/lib/qikink/` — `client.ts` (API + token cache), `config.ts`, `map.ts` (order →
  payload), `fulfillment.ts` (push + status sync)
- Settings page: `src/app/(admin)/admin/settings/qikink/` — credentials, environment
  toggle, enable/auto-send, Test connection, and a **Send test order** panel
- Order detail: `src/app/(admin)/admin/orders/[id]/qikink-card.tsx` — Send to Qikink,
  status/AWB/tracking, Refresh status
- Auto-send (off by default) fires via `after()` from `next/server` in
  `(checkout)/checkout/actions.ts`, so Qikink can never block a shopper's checkout

**Hard-won facts — do not re-derive:**
- The API is **orders-only**: `POST /api/token`, `POST /api/order/create`, `GET /api/order`.
  No product endpoints. Sandbox `https://sandbox.qikink.com`, live `https://api.qikink.com`.
  30 requests/minute. Postman JSON:
  `https://documenter.gw.postman.com/api/collections/26157218/2sB3QKqpma`
- **"Push To Store" only targets Shopify/WooCommerce**, not custom stores. Products are
  never synced — they are **matched on SKU**.
- Qikink shows three SKU columns. Use the **Store SKU** (`v-8RCp0i6ad1dU18MNNRc0pbbepQ3b9XQ=`)
  as the Hazestudios variant SKU. Confirmed by inspecting the product Qikink had pushed to
  Shopify — its variant SKUs are verbatim the Store SKUs. *Product SKU* (`MRnHs-Bk-S`) is
  just the blank garment; *Design SKU* (`karanMbadge`) is the artwork.
- **Sandbox has no My Products data** — `search_from_my_products: 1` returns "Invalid SKU"
  there for any value. That mode is only testable on live. Catalogue SKUs
  (`search_from_my_products: 0`) do work in sandbox.
- `order_number` must be `[A-Za-z0-9]{1,15}` — both limits undocumented, found by tripping
  them. Validated client-side in `createOrder`.
- Qikink's "optional" fields are **not optional as keys**: it reads `last_name` and
  `address2` unconditionally and 500s with `Undefined array key`. `JSON.stringify` drops
  `undefined`, so `QikinkAddress` makes every field a required `string`; send `""` for none.
  Suspect the same for `line_items[].print_type_id` / `designs` (omitted when
  `search_from_my_products: 1`, not yet exercised on live).
- Credentials live in `integration_credentials` with **RLS on and zero policies** —
  service-role only. This is deliberate: `shop_settings` has `for select to anon using
  (true)`, so anything there is world-readable. Every server action touching it gates on
  `is_staff()` because service-role bypasses RLS. **Do not add a policy to that table.**

## What I'm waiting on

**Qikink live API credentials** — request submitted, pending approval. Sandbox testing
requirement is satisfied (sandbox order `12667872` created successfully via catalogue mode).

## Next steps, in order

1. **When live credentials arrive:** Settings → Qikink → Environment **Live** → re-enter the
   **live** secret (differs from sandbox) → Test connection → send one test order in
   **My Products** mode with a Store SKU. That's the last unverified thing.
2. Paste all 6 Store SKUs into the `Unisex Classic Crew T-Shirt` variants in Hazestudios,
   then run a real checkout → Send to Qikink → Refresh status.
3. **Check pricing before going live.** Qikink shows Product Cost ₹283.50 vs Selling Cost
   ₹252.00, and Shopify lists at ₹252.00. If ₹283.50 is what Qikink bills me, every unit
   sells at a ₹31.50 loss. Confirm which column is the charge; set Hazestudios retail above it.

## Unbuilt work I've already scoped

- **Tracking write-back (offered, not built):** Qikink's AWB + tracking link land in
  `qikink_fulfillments`, which is staff-only, so the customer's order-status page at
  `/orders/[token]` shows nothing. Write them through to the `fulfillments` table on status
  refresh.
- **How Qikink products get into Hazestudios — decision never made.** Options: import from
  my Shopify store via the Admin API (Qikink already pushes there), extend the in-progress
  product CSV importer (`0015_product_import.sql`, `import-dialog.tsx`), or enter products
  manually. Orders work either way as long as Store SKUs match.
