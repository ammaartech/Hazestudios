-- Storefront public read access.
--
-- 0001_init.sql granted every table to `authenticated` only, which is correct for
-- the admin but leaves the customer-facing storefront with zero rows on the anon
-- key. This adds narrowly-scoped `select` policies for the `anon` role covering
-- only what a shopper needs to browse.
--
-- Deliberately NOT exposed to anon: customers, orders, order_items, staff_roles,
-- discounts, gift_cards, refunds, fulfillments, segments, files, locations.
-- Checkout writes go through a server action on the service-role key instead of
-- a public insert policy, so a customer cannot forge order rows or read anyone
-- else's order.

-- ---------------------------------------------------------------------------
-- Products — active only. Draft and archived stay invisible to the public.
-- ---------------------------------------------------------------------------
create policy products_public_read on products
  for select to anon
  using (status = 'active');

-- ---------------------------------------------------------------------------
-- Product children — visible only when the parent product is public.
-- The exists() guard stops draft product imagery/pricing leaking via these
-- tables, which is why this is not a blanket `using (true)`.
-- ---------------------------------------------------------------------------
create policy product_images_public_read on product_images
  for select to anon
  using (exists (
    select 1 from products p
    where p.id = product_images.product_id and p.status = 'active'
  ));

create policy product_options_public_read on product_options
  for select to anon
  using (exists (
    select 1 from products p
    where p.id = product_options.product_id and p.status = 'active'
  ));

create policy product_variants_public_read on product_variants
  for select to anon
  using (exists (
    select 1 from products p
    where p.id = product_variants.product_id and p.status = 'active'
  ));

-- Stock counts drive the out-of-stock UI, so they must be readable — but only
-- for active products.
create policy inventory_levels_public_read on inventory_levels
  for select to anon
  using (exists (
    select 1 from products p
    where p.id = inventory_levels.product_id and p.status = 'active'
  ));

-- ---------------------------------------------------------------------------
-- Collections & membership
-- ---------------------------------------------------------------------------
create policy collections_public_read on collections
  for select to anon
  using (true);

create policy product_collections_public_read on product_collections
  for select to anon
  using (exists (
    select 1 from products p
    where p.id = product_collections.product_id and p.status = 'active'
  ));

-- ---------------------------------------------------------------------------
-- Shop settings — the storefront header/footer needs store name, currency and
-- brand/policy blobs. These columns are already non-sensitive.
-- ---------------------------------------------------------------------------
create policy shop_settings_public_read on shop_settings
  for select to anon
  using (true);
