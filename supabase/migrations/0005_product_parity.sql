-- Product parity with the Shopify "Add and update products" model, plus an
-- atomic write path.
--
-- Two things are wrong with the pre-0005 product save, and both are fixed here:
--
--   1. It was not atomic. `saveProduct` issued ~8 separate PostgREST calls and
--      bailed on the first error, so a failure halfway through left the product
--      row updated but its variants deleted and not yet re-inserted.
--   2. It deleted and re-inserted every child row on every save. That reissued
--      new `product_images.id` values, which silently nulled
--      `product_variants.image_id` (FK is `on delete set null`), and it wrote
--      variant stock to the default location only while reading it summed
--      across all locations — so multi-location stock collapsed onto one row
--      each time anyone pressed Save.
--
-- The replacement is a single `save_product(jsonb)` function: one round trip,
-- one implicit transaction, upserts on stable keys, and deletes scoped to rows
-- the payload actually dropped. It runs SECURITY INVOKER, so the existing
-- `*_staff_all` RLS policies still gate it — a function is not a bypass.

-- ---------------------------------------------------------------------------
-- Product columns
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists handle            text,
  add column if not exists category          text    not null default '',
  add column if not exists requires_shipping boolean not null default true,
  add column if not exists weight            numeric(10,3),
  add column if not exists weight_unit       text    not null default 'kg',
  add column if not exists country_of_origin text    not null default '',
  add column if not exists hs_code           text    not null default '',
  add column if not exists continue_selling  boolean not null default false,
  add column if not exists published_at      timestamptz;

alter table products
  drop constraint if exists products_weight_unit_check;
alter table products
  add constraint products_weight_unit_check
  check (weight_unit in ('kg', 'g', 'lb', 'oz'));

-- ---------------------------------------------------------------------------
-- Variant columns — a variant can now diverge from its parent on every axis
-- Shopify allows, instead of inheriting price and nothing else.
-- ---------------------------------------------------------------------------
alter table product_variants
  add column if not exists cost_per_item     numeric(12,2),
  add column if not exists weight            numeric(10,3),
  add column if not exists weight_unit       text    not null default 'kg',
  add column if not exists requires_shipping boolean not null default true,
  add column if not exists track_inventory   boolean not null default true,
  add column if not exists continue_selling  boolean not null default false,
  add column if not exists available         boolean not null default true;

-- ---------------------------------------------------------------------------
-- Handles
-- ---------------------------------------------------------------------------

-- No `unaccent` dependency: Supabase has the extension available but it is not
-- enabled by default, and a slug helper is not worth making the migration
-- conditional on one. Non-ASCII simply collapses to separators.
create or replace function public.slugify(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g')), ''),
    'product'
  );
$$;

-- Appends -2, -3, … until free. `exclude_id` lets a product keep its own handle
-- while editing rather than incrementing on every save.
create or replace function public.unique_product_handle(desired text, exclude_id uuid default null)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  base    text := public.slugify(desired);
  final   text := base;
  attempt int  := 1;
begin
  while exists (
    select 1 from products
    where handle = final
      and (exclude_id is null or id <> exclude_id)
  ) loop
    attempt := attempt + 1;
    final := base || '-' || attempt;
  end loop;
  return final;
end;
$$;

-- Backfill before adding the unique index, oldest first so the earliest product
-- keeps the bare handle and later collisions take the suffix.
do $$
declare
  r record;
begin
  for r in select id, title from products where handle is null or handle = '' order by created_at loop
    update products set handle = public.unique_product_handle(r.title, r.id) where id = r.id;
  end loop;
end $$;

alter table products alter column handle set not null;
create unique index if not exists products_handle_key on products (handle);

-- ---------------------------------------------------------------------------
-- Stable child keys — these are what make upsert-instead-of-wipe possible
-- ---------------------------------------------------------------------------
create unique index if not exists product_options_product_name_key
  on product_options (product_id, name);
create unique index if not exists product_variants_product_title_key
  on product_variants (product_id, title);

-- Lookup indexes for the organisation autocompletes.
create index if not exists products_vendor_idx       on products (vendor)       where vendor <> '';
create index if not exists products_product_type_idx on products (product_type) where product_type <> '';

-- ---------------------------------------------------------------------------
-- save_product — the whole write, atomically
-- ---------------------------------------------------------------------------
-- Payload shape (all keys optional unless noted):
--   { id?, title*, handle?, description_html, status, vendor, product_type,
--     category, tags[], price, compare_at_price, cost_per_item, sku, barcode,
--     track_inventory, continue_selling, requires_shipping, weight,
--     weight_unit, country_of_origin, hs_code, seo_title, seo_description,
--     published_at,
--     images:      [{ id*, url*, alt }]                       -- id is client-generated uuid
--     options:     [{ name*, values[]* }]
--     variants:    [{ title*, option1..3, price, compare_at_price, cost_per_item,
--                     sku, barcode, weight, weight_unit, requires_shipping,
--                     track_inventory, continue_selling, available, image_id,
--                     inventory: [{ location_id*, quantity* }] }]
--     inventory:   [{ location_id*, quantity* }]              -- simple products only
--     collection_ids: [uuid] }
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
      published_at
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
      (payload->>'published_at')::timestamptz
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
      published_at      = (payload->>'published_at')::timestamptz
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
    insert into product_options (product_id, name, "values", position)
    select v_id, e.value->>'name',
           coalesce(array(select jsonb_array_elements_text(e.value->'values')), '{}'),
           (e.ord - 1)::int
    from jsonb_array_elements(v_options) with ordinality e(value, ord)
    on conflict (product_id, name) do update set
      "values" = excluded."values",
      position = excluded.position;
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
      track_inventory, continue_selling, available, image_id, position
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
      (e.ord - 1)::int
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
      position          = excluded.position;
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
  delete from _desired_levels;

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
-- duplicate_product — Shopify's "Duplicate" action. Copies the record and all
-- children as a draft, with a fresh handle and fresh child ids.
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
    hs_code, has_variants, seo_title, seo_description, published_at
  )
  -- A duplicate always lands as a draft: copying a live product straight onto
  -- the storefront is never what the operator meant.
  select v_title, v_handle, description_html, 'draft', vendor, product_type, category,
         tags, price, compare_at_price, cost_per_item, sku, barcode, track_inventory,
         continue_selling, requires_shipping, weight, weight_unit, country_of_origin,
         hs_code, has_variants, seo_title, seo_description, null
  from products where id = source_id
  returning id into v_new_id;

  -- Images first, keeping a source→copy map so variant.image_id can be remapped
  -- onto the copies rather than left pointing at the original's rows.
  --
  -- Looped rather than a set-based INSERT…RETURNING: recovering the mapping
  -- from a bulk insert means joining old to new on (url, position), which
  -- quietly fans out if a product ever has two images sharing both. Image
  -- counts are small, so the explicit loop costs nothing and cannot be wrong.
  create temporary table if not exists _dup_image_map (old_id uuid, new_id uuid)
    on commit drop;
  delete from _dup_image_map;

  for v_image in
    select id, url, alt, position from product_images
    where product_id = source_id order by position
  loop
    v_new_image_id := gen_random_uuid();
    insert into product_images (id, product_id, url, alt, position)
    values (v_new_image_id, v_new_id, v_image.url, v_image.alt, v_image.position);
    insert into _dup_image_map (old_id, new_id) values (v_image.id, v_new_image_id);
  end loop;

  insert into product_options (product_id, name, "values", position)
  select v_new_id, name, "values", position from product_options where product_id = source_id;

  insert into product_variants (
    product_id, title, option1, option2, option3, price, compare_at_price,
    cost_per_item, sku, barcode, weight, weight_unit, requires_shipping,
    track_inventory, continue_selling, available, image_id, position
  )
  select v_new_id, title, option1, option2, option3, price, compare_at_price,
         cost_per_item, sku, barcode, weight, weight_unit, requires_shipping,
         track_inventory, continue_selling, available,
         (select m.new_id from _dup_image_map m where m.old_id = v.image_id),
         position
  from product_variants v where product_id = source_id;

  insert into product_collections (product_id, collection_id)
  select v_new_id, collection_id from product_collections where product_id = source_id;

  -- Stock is deliberately NOT copied. Two products do not share one shelf.

  return jsonb_build_object('id', v_new_id, 'handle', v_handle);
end;
$$;

-- ---------------------------------------------------------------------------
-- Autocomplete sources for the organisation fields. One round trip each,
-- ordered by real usage so the values the store actually uses surface first.
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
                           from products where category <> ''), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants. `authenticated` covers the admin; the facets helper is admin-only.
-- ---------------------------------------------------------------------------
grant execute on function public.save_product(jsonb)               to authenticated;
grant execute on function public.duplicate_product(uuid, text)     to authenticated;
grant execute on function public.product_facets()                  to authenticated;
grant execute on function public.slugify(text)                     to authenticated, anon;
grant execute on function public.unique_product_handle(text, uuid) to authenticated;
