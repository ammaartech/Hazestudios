-- Product CSV import — the columns a Shopify export carries that this schema
-- had nowhere to put, plus a bulk write path.
--
-- ===========================================================================
-- WHAT THE EXPORT CONTAINS THAT WE COULD NOT STORE
-- ===========================================================================
-- A Shopify `products_export.csv` is 100 columns wide. Mapped against the
-- schema as it stood after 0014, four kinds of data had no home:
--
--   1. `Variant Taxable`. Whether tax is charged on a line. Shopify puts it on
--      the variant and the admin surfaces it on the product; we had neither, so
--      every imported product would have silently become taxable-by-assumption
--      with no way for an operator to see or change that.
--
--   2. Metafields — ~45 columns of them. Two are the store's own and are read
--      by the storefront (`custom.badge` drives the product-card flag,
--      `custom.key_info` the highlight line); the rest are the Shopify
--      taxonomy set (`shopify.fabric`, `shopify.color-pattern`, `shopify.size`,
--      …) plus the Google Shopping feed fields. Dropping them on import would
--      mean the badge on a product came back blank after a round trip.
--
--      They land in one `jsonb` column rather than a `product_metafields`
--      table. A metafield set is sparse (the average product fills three of the
--      forty-five), always read whole with the product, and never queried a key
--      at a time — a row-per-key table would be ~2,500 rows of pure join
--      overhead for data with no query surface. `jsonb_path_ops` on the column
--      covers containment lookups if that ever changes.
--
--   3. `Option1/2/3 Linked To`. Shopify links a colour option to a metaobject
--      so the storefront can render real swatches instead of text. Without the
--      pointer the link is unrecoverable — the option value "sage" alone does
--      not say which palette it came from.
--
--   4. Import history. An import that half-fails needs to say which handles
--      failed and why, after the dialog has been closed.
--
-- Deliberately NOT added: `Variant Fulfillment Service` (constant "manual"),
-- `Gift Card` (the gift_cards table already models these, and the flag is false
-- across the export), `Included/Price/Compare At / <market>` (market-specific
-- pricing is a price-list feature, not a product column), and `Unit Price
-- Measure` (EU unit pricing, empty).
--
-- Inventory quantity is absent from the export itself: Shopify moved it out of
-- the product CSV when locations became first class. There is nothing to
-- import, so imported products land with no stock rather than a fabricated
-- zero-at-the-default-location.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists taxable    boolean not null default true,
  add column if not exists metafields jsonb   not null default '{}'::jsonb;

alter table product_variants
  add column if not exists taxable boolean not null default true;

alter table product_options
  add column if not exists linked_to text not null default '';

-- Containment-only operator class: it indexes `@>` (the "which products carry
-- this metafield" question) at roughly half the size of the default, and we
-- have no use for the key-exists operators the default also covers.
create index if not exists products_metafields_gin
  on products using gin (metafields jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 2. Import ledger
-- ---------------------------------------------------------------------------
-- One row per import run. `errors` holds [{ handle, message }] so a failure is
-- still answerable once the dialog is gone, and the counts let the products
-- page show "845 products imported" without recounting the catalogue.
create table if not exists product_imports (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null default '',
  status       text not null default 'running'
                 check (status in ('running', 'completed', 'failed')),
  total        int  not null default 0,
  created      int  not null default 0,
  updated      int  not null default 0,
  skipped      int  not null default 0,
  failed       int  not null default 0,
  errors       jsonb not null default '[]'::jsonb,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists product_imports_created_idx
  on product_imports (created_at desc);

alter table product_imports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'product_imports'
      and policyname = 'product_imports_staff_all'
  ) then
    create policy product_imports_staff_all on product_imports
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. save_product — republished with taxable, metafields and option links.
--
-- Copied wholesale from 0008 with only the new fields threaded through, which
-- is the same approach 0008 took to 0006 and 0006 to 0005: Postgres cannot
-- patch a function body, so a versioned replacement is the honest unit of
-- change. Everything else here is byte-identical to 0008 on purpose — diffing
-- the two files should show exactly the new columns and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.save_product(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id           uuid    := nullif(payload->>'id', '')::uuid;
  v_title        text    := trim(coalesce(payload->>'title', ''));
  v_handle       text;
  v_images       jsonb   := coalesce(payload->'images',   '[]'::jsonb);
  v_options      jsonb   := coalesce(payload->'options',  '[]'::jsonb);
  v_variants     jsonb   := coalesce(payload->'variants', '[]'::jsonb);
  v_has_variants boolean := jsonb_array_length(v_options) > 0
                        and jsonb_array_length(v_variants) > 0;
  v_size_chart_enabled boolean := coalesce((payload->>'size_chart_enabled')::boolean, false);
  -- Only persist the chart when the toggle is on, so turning the size chart off
  -- cannot leave stale measurements readable on the storefront.
  v_size_chart   jsonb   := case
                              when coalesce((payload->>'size_chart_enabled')::boolean, false)
                              then coalesce(payload->'size_chart', '{}'::jsonb)
                              else '{}'::jsonb
                            end;
  -- Metafields are replaced wholesale, not merged. The editor always sends the
  -- complete set, so a merge would make a deleted key unremovable.
  v_metafields   jsonb   := case
                              when jsonb_typeof(payload->'metafields') = 'object'
                              then payload->'metafields'
                              else '{}'::jsonb
                            end;
begin
  if v_title = '' then
    raise exception 'Title is required' using errcode = 'check_violation';
  end if;

  v_handle := public.unique_product_handle(
    coalesce(nullif(trim(coalesce(payload->>'handle', '')), ''), v_title),
    v_id
  );

  -- Product row ------------------------------------------------------------
  if v_id is null then
    insert into products (
      title, handle, description_html, status, vendor, product_type, category,
      tags, price, compare_at_price, cost_per_item, sku, barcode,
      track_inventory, continue_selling, requires_shipping, weight, weight_unit,
      country_of_origin, hs_code, has_variants, seo_title, seo_description,
      published_at, size_chart_enabled, size_chart, taxable, metafields
    ) values (
      v_title,
      v_handle,
      coalesce(payload->>'description_html', ''),
      coalesce(nullif(payload->>'status', ''), 'draft')::product_status,
      coalesce(payload->>'vendor', ''),
      coalesce(payload->>'product_type', ''),
      coalesce(payload->>'category', ''),
      coalesce(array(select jsonb_array_elements_text(payload->'tags')), '{}'),
      coalesce((payload->>'price')::numeric, 0),
      (payload->>'compare_at_price')::numeric,
      (payload->>'cost_per_item')::numeric,
      coalesce(payload->>'sku', ''),
      coalesce(payload->>'barcode', ''),
      coalesce((payload->>'track_inventory')::boolean, true),
      coalesce((payload->>'continue_selling')::boolean, false),
      coalesce((payload->>'requires_shipping')::boolean, true),
      (payload->>'weight')::numeric,
      coalesce(nullif(payload->>'weight_unit', ''), 'kg'),
      coalesce(payload->>'country_of_origin', ''),
      coalesce(payload->>'hs_code', ''),
      v_has_variants,
      coalesce(payload->>'seo_title', ''),
      coalesce(payload->>'seo_description', ''),
      (payload->>'published_at')::timestamptz,
      v_size_chart_enabled,
      v_size_chart,
      coalesce((payload->>'taxable')::boolean, true),
      v_metafields
    )
    returning id into v_id;
  else
    update products set
      title             = v_title,
      handle            = v_handle,
      description_html  = coalesce(payload->>'description_html', ''),
      status            = coalesce(nullif(payload->>'status', ''), 'draft')::product_status,
      vendor            = coalesce(payload->>'vendor', ''),
      product_type      = coalesce(payload->>'product_type', ''),
      category          = coalesce(payload->>'category', ''),
      tags              = coalesce(array(select jsonb_array_elements_text(payload->'tags')), '{}'),
      price             = coalesce((payload->>'price')::numeric, 0),
      compare_at_price  = (payload->>'compare_at_price')::numeric,
      cost_per_item     = (payload->>'cost_per_item')::numeric,
      sku               = coalesce(payload->>'sku', ''),
      barcode           = coalesce(payload->>'barcode', ''),
      track_inventory   = coalesce((payload->>'track_inventory')::boolean, true),
      continue_selling  = coalesce((payload->>'continue_selling')::boolean, false),
      requires_shipping = coalesce((payload->>'requires_shipping')::boolean, true),
      weight            = (payload->>'weight')::numeric,
      weight_unit       = coalesce(nullif(payload->>'weight_unit', ''), 'kg'),
      country_of_origin = coalesce(payload->>'country_of_origin', ''),
      hs_code           = coalesce(payload->>'hs_code', ''),
      has_variants      = v_has_variants,
      seo_title         = coalesce(payload->>'seo_title', ''),
      seo_description   = coalesce(payload->>'seo_description', ''),
      published_at      = (payload->>'published_at')::timestamptz,
      size_chart_enabled = v_size_chart_enabled,
      size_chart         = v_size_chart,
      taxable            = coalesce((payload->>'taxable')::boolean, true),
      metafields         = v_metafields
    where id = v_id;

    if not found then
      raise exception 'Product % not found', v_id using errcode = 'no_data_found';
    end if;
  end if;

  -- Images -----------------------------------------------------------------
  -- Upsert on the client-generated id so a reordered or re-alt'd image keeps
  -- its identity, and `product_variants.image_id` keeps pointing at it.
  delete from product_images
  where product_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(v_images) e
      where (e.value->>'id')::uuid = product_images.id
    );

  insert into product_images (id, product_id, url, alt, position)
  select (e.value->>'id')::uuid, v_id, e.value->>'url',
         coalesce(e.value->>'alt', ''), (e.ord - 1)::int
  from jsonb_array_elements(v_images) with ordinality e(value, ord)
  on conflict (id) do update set
    product_id = excluded.product_id,
    url        = excluded.url,
    alt        = excluded.alt,
    position   = excluded.position;

  -- Options ----------------------------------------------------------------
  delete from product_options
  where product_id = v_id
    and (not v_has_variants
         or not exists (
           select 1 from jsonb_array_elements(v_options) e
           where e.value->>'name' = product_options.name
         ));

  if v_has_variants then
    insert into product_options (product_id, name, "values", position, linked_to)
    select v_id, e.value->>'name',
           coalesce(array(select jsonb_array_elements_text(e.value->'values')), '{}'),
           (e.ord - 1)::int,
           coalesce(e.value->>'linked_to', '')
    from jsonb_array_elements(v_options) with ordinality e(value, ord)
    on conflict (product_id, name) do update set
      "values"  = excluded."values",
      position  = excluded.position,
      linked_to = excluded.linked_to;
  end if;

  -- Variants ---------------------------------------------------------------
  -- Dropped variants cascade their inventory_levels away, which is correct: a
  -- variant that no longer exists has no stock.
  delete from product_variants
  where product_id = v_id
    and (not v_has_variants
         or not exists (
           select 1 from jsonb_array_elements(v_variants) e
           where e.value->>'title' = product_variants.title
         ));

  if v_has_variants then
    insert into product_variants (
      product_id, title, option1, option2, option3, price, compare_at_price,
      cost_per_item, sku, barcode, weight, weight_unit, requires_shipping,
      track_inventory, continue_selling, available, image_id, position, taxable
    )
    select
      v_id,
      e.value->>'title',
      e.value->>'option1',
      e.value->>'option2',
      e.value->>'option3',
      coalesce((e.value->>'price')::numeric, 0),
      (e.value->>'compare_at_price')::numeric,
      (e.value->>'cost_per_item')::numeric,
      coalesce(e.value->>'sku', ''),
      coalesce(e.value->>'barcode', ''),
      (e.value->>'weight')::numeric,
      coalesce(nullif(e.value->>'weight_unit', ''), 'kg'),
      coalesce((e.value->>'requires_shipping')::boolean, true),
      coalesce((e.value->>'track_inventory')::boolean, true),
      coalesce((e.value->>'continue_selling')::boolean, false),
      coalesce((e.value->>'available')::boolean, true),
      nullif(e.value->>'image_id', '')::uuid,
      (e.ord - 1)::int,
      coalesce((e.value->>'taxable')::boolean, true)
    from jsonb_array_elements(v_variants) with ordinality e(value, ord)
    on conflict (product_id, title) do update set
      option1           = excluded.option1,
      option2           = excluded.option2,
      option3           = excluded.option3,
      price             = excluded.price,
      compare_at_price  = excluded.compare_at_price,
      cost_per_item     = excluded.cost_per_item,
      sku               = excluded.sku,
      barcode           = excluded.barcode,
      weight            = excluded.weight,
      weight_unit       = excluded.weight_unit,
      requires_shipping = excluded.requires_shipping,
      track_inventory   = excluded.track_inventory,
      continue_selling  = excluded.continue_selling,
      available         = excluded.available,
      image_id          = excluded.image_id,
      position          = excluded.position,
      taxable           = excluded.taxable;
  end if;

  -- Inventory --------------------------------------------------------------
  -- The desired (variant_id, location_id) set from the payload, materialised so
  -- the prune and the upsert are two ordered statements rather than two
  -- data-modifying CTEs in one. CTEs in a single statement share one snapshot
  -- and have no defined order between them, which is not something inventory
  -- correctness should rest on.
  create temporary table if not exists _desired_levels (
    variant_id  uuid,
    location_id uuid,
    quantity    int
  ) on commit drop;
  truncate table _desired_levels;

  -- Per-variant stock.
  insert into _desired_levels (variant_id, location_id, quantity)
  select pv.id, (l.value->>'location_id')::uuid,
         coalesce((l.value->>'quantity')::int, 0)
  from jsonb_array_elements(case when v_has_variants then v_variants else '[]'::jsonb end) e(value)
  join product_variants pv
    on pv.product_id = v_id and pv.title = e.value->>'title'
  cross join lateral jsonb_array_elements(coalesce(e.value->'inventory', '[]'::jsonb)) l(value);

  -- Simple-product stock lives on the variant_id IS NULL row.
  insert into _desired_levels (variant_id, location_id, quantity)
  select null, (l.value->>'location_id')::uuid,
         coalesce((l.value->>'quantity')::int, 0)
  from jsonb_array_elements(
         case when v_has_variants then '[]'::jsonb
              else coalesce(payload->'inventory', '[]'::jsonb) end
       ) l(value);

  -- Anything for this product not in the desired set is stale.
  delete from inventory_levels il
  where il.product_id = v_id
    and not exists (
      select 1 from _desired_levels d
      where d.location_id = il.location_id
        and d.variant_id is not distinct from il.variant_id
    );

  -- Upsert, so per-location counts survive a save instead of collapsing onto
  -- the default location the way the old client-side write did.
  insert into inventory_levels (product_id, variant_id, location_id, quantity)
  select v_id, d.variant_id, d.location_id, d.quantity
  from _desired_levels d
  on conflict (product_id, variant_id, location_id) do update set
    quantity = excluded.quantity;

  -- Collections ------------------------------------------------------------
  delete from product_collections
  where product_id = v_id
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(payload->'collection_ids', '[]'::jsonb)) c
      where c.value::uuid = product_collections.collection_id
    );

  insert into product_collections (product_id, collection_id)
  select v_id, c.value::uuid
  from jsonb_array_elements_text(coalesce(payload->'collection_ids', '[]'::jsonb)) c
  on conflict do nothing;

  return jsonb_build_object('id', v_id, 'handle', v_handle);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. duplicate_product — republished so a copy carries the new fields.
--
-- Without this a duplicate would silently drop the badge, the taxable flag and
-- the option swatch links, which is the exact class of bug the import is here
-- to stop.
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_product(source_id uuid, new_title text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_id       uuid;
  v_title        text;
  v_handle       text;
  v_image        record;
  v_new_image_id uuid;
begin
  select coalesce(nullif(trim(coalesce(new_title, '')), ''), p.title || ' copy')
    into v_title
  from products p where p.id = source_id;

  if v_title is null then
    raise exception 'Product % not found', source_id using errcode = 'no_data_found';
  end if;

  v_handle := public.unique_product_handle(v_title);

  insert into products (
    title, handle, description_html, status, vendor, product_type, category, tags,
    price, compare_at_price, cost_per_item, sku, barcode, track_inventory,
    continue_selling, requires_shipping, weight, weight_unit, country_of_origin,
    hs_code, has_variants, seo_title, seo_description, published_at,
    size_chart_enabled, size_chart, taxable, metafields
  )
  -- A duplicate always lands as a draft: copying a live product straight onto
  -- the storefront is never what the operator meant.
  select v_title, v_handle, description_html, 'draft', vendor, product_type, category,
         tags, price, compare_at_price, cost_per_item, sku, barcode, track_inventory,
         continue_selling, requires_shipping, weight, weight_unit, country_of_origin,
         hs_code, has_variants, seo_title, seo_description, null,
         size_chart_enabled, size_chart, taxable, metafields
  from products where id = source_id
  returning id into v_new_id;

  -- Images first, keeping a source→copy map so variant.image_id can be remapped
  -- onto the copies rather than left pointing at the original's rows.
  create temporary table if not exists _dup_image_map (old_id uuid, new_id uuid)
    on commit drop;
  truncate table _dup_image_map;

  for v_image in
    select id, url, alt, position from product_images
    where product_id = source_id order by position
  loop
    v_new_image_id := gen_random_uuid();
    insert into product_images (id, product_id, url, alt, position)
    values (v_new_image_id, v_new_id, v_image.url, v_image.alt, v_image.position);
    insert into _dup_image_map (old_id, new_id) values (v_image.id, v_new_image_id);
  end loop;

  insert into product_options (product_id, name, "values", position, linked_to)
  select v_new_id, name, "values", position, linked_to
  from product_options where product_id = source_id;

  insert into product_variants (
    product_id, title, option1, option2, option3, price, compare_at_price,
    cost_per_item, sku, barcode, weight, weight_unit, requires_shipping,
    track_inventory, continue_selling, available, image_id, position, taxable
  )
  select v_new_id, title, option1, option2, option3, price, compare_at_price,
         cost_per_item, sku, barcode, weight, weight_unit, requires_shipping,
         track_inventory, continue_selling, available,
         (select m.new_id from _dup_image_map m where m.old_id = v.image_id),
         position, taxable
  from product_variants v where product_id = source_id;

  insert into product_collections (product_id, collection_id)
  select v_new_id, collection_id from product_collections where product_id = source_id;

  -- Stock is deliberately NOT copied. Two products do not share one shelf.

  return jsonb_build_object('id', v_new_id, 'handle', v_handle);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. import_products — a batch of save_product calls, one round trip.
--
-- Payload: { overwrite: bool, products: [ <save_product payload>, … ] }
--
-- Three things this does that a client-side loop over save_product cannot:
--
--   * Resolves each product's identity by handle before writing. save_product
--     treats a payload with no id as a new product and would hand the second
--     import of the same file a `-2` handle for all 845 rows. Here an existing
--     handle becomes an UPDATE, so re-importing a corrected export fixes the
--     catalogue instead of duplicating it — which is what Shopify's own CSV
--     import means by "overwrite products with the same handle".
--
--   * Isolates failures per product. The BEGIN…EXCEPTION block opens a
--     subtransaction per item, so one product with an unparseable price rolls
--     back alone and the other 844 still land. A single-transaction batch would
--     throw the whole file away over one bad row.
--
--   * Collapses the round trips. 845 products through PostgREST is 845 HTTP
--     requests; batched it is a handful, and each batch is one transaction.
--
-- Returns { created, updated, skipped, failed, errors: [{handle, message}] }.
-- ---------------------------------------------------------------------------
create or replace function public.import_products(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_overwrite boolean := coalesce((payload->>'overwrite')::boolean, true);
  v_item      jsonb;
  v_handle    text;
  v_existing  uuid;
  v_created   int   := 0;
  v_updated   int   := 0;
  v_skipped   int   := 0;
  v_failed    int   := 0;
  v_errors    jsonb := '[]'::jsonb;
begin
  for v_item in
    select value from jsonb_array_elements(coalesce(payload->'products', '[]'::jsonb))
  loop
    v_handle := public.slugify(
      coalesce(nullif(trim(coalesce(v_item->>'handle', '')), ''), v_item->>'title')
    );

    select id into v_existing from products where handle = v_handle;

    -- "Add new products, leave existing ones alone" — the unticked box in the
    -- import dialog. Reported as skipped rather than silently ignored.
    if v_existing is not null and not v_overwrite then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      perform public.save_product(
        v_item || jsonb_build_object('id', v_existing, 'handle', v_handle)
      );
      if v_existing is null then
        v_created := v_created + 1;
      else
        v_updated := v_updated + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      -- Capped so a systematically broken file returns a readable report
      -- instead of a multi-megabyte error array.
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('handle', v_handle, 'message', sqlerrm)
        );
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'failed',  v_failed,
    'errors',  v_errors
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. product_facets — republished so the editor's autocompletes can offer the
--    metafield keys already in use, the same way they offer tags and vendors.
-- ---------------------------------------------------------------------------
create or replace function public.product_facets()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'tags',      coalesce((select jsonb_agg(t order by n desc, t)
                           from (select tag as t, count(*) as n
                                 from products, unnest(tags) as tag
                                 group by tag) s), '[]'::jsonb),
    'vendors',   coalesce((select jsonb_agg(distinct vendor)
                           from products where vendor <> ''), '[]'::jsonb),
    'types',     coalesce((select jsonb_agg(distinct product_type)
                           from products where product_type <> ''), '[]'::jsonb),
    'categories',coalesce((select jsonb_agg(distinct category)
                           from products where category <> ''), '[]'::jsonb),
    'metafield_keys', coalesce((select jsonb_agg(k order by n desc, k)
                           from (select mk.k, count(*) as n
                                 from products, jsonb_object_keys(metafields) as mk(k)
                                 group by mk.k) s), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.import_products(jsonb) to authenticated;
