-- Collections, brought up to the level of the rest of the catalogue.
--
-- ===========================================================================
-- WHAT WAS ACTUALLY BROKEN
-- ===========================================================================
-- `collections.image_url` has existed since 0001 and the storefront leans on it
-- hard: it is the full-bleed campaign hero on the home page, the hero on
-- /collections/[handle], and the artwork on the editorial tiles. The admin had
-- no field for it. The column was reachable only by seed data or by hand in the
-- SQL editor, so in practice a merchant could not set the largest image on
-- their own storefront.
--
-- The rest of this migration closes the smaller gaps that made collections feel
-- like a lesser object than products:
--
--   * products have seo_title/seo_description; collections had neither, so a
--     collection page's <title> could not be controlled.
--   * products have a status; collections were always live the moment they were
--     created, with no way to stage one before a drop.
--   * a manual collection is an ordered thing — "the first six pieces of the
--     drop" — but membership was a plain join table with no order at all, so the
--     storefront fell back to created_at and the merchant's arrangement was
--     simply discarded.
--   * collections had no updated_at, so "recently edited" was unanswerable.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table collections
  add column if not exists seo_title       text not null default '',
  add column if not exists seo_description text not null default '',
  add column if not exists sort_order      text not null default 'manual',
  add column if not exists published_at    timestamptz,
  add column if not exists updated_at      timestamptz not null default now();

-- Constrained rather than free text: the storefront switches on this value, and
-- an unrecognised one would silently fall through to an arbitrary order.
-- `manual` is the only value that reads product_collections.position.
alter table collections drop constraint if exists collections_sort_order_check;
alter table collections
  add constraint collections_sort_order_check check (sort_order in (
    'manual', 'alpha_asc', 'alpha_desc', 'price_asc', 'price_desc',
    'created_desc', 'created_asc'
  ));

-- Everything that already exists is live, and must stay live — this migration
-- must not quietly unpublish a storefront. Only collections created *after*
-- this point start unpublished, which is the safe direction for the default.
update collections set published_at = created_at where published_at is null;

comment on column collections.published_at is
  'When the collection became visible on the storefront. Null means unpublished — created but not yet live. Backdated to created_at for everything that predates 0012.';
comment on column collections.sort_order is
  'How products are ordered on the storefront. Only `manual` consults product_collections.position.';

-- ---------------------------------------------------------------------------
-- 2. Manual ordering
-- ---------------------------------------------------------------------------
alter table product_collections
  add column if not exists position int not null default 0;

-- Existing memberships have no meaningful order; seed one from the product's
-- own creation order so a merchant opening a collection for the first time sees
-- a stable arrangement rather than a random one they then have to fix.
with ordered as (
  select pc.product_id,
         pc.collection_id,
         row_number() over (
           partition by pc.collection_id order by p.created_at
         ) - 1 as seq
    from product_collections pc
    join products p on p.id = pc.product_id
)
update product_collections pc
   set position = ordered.seq
  from ordered
 where pc.product_id = ordered.product_id
   and pc.collection_id = ordered.collection_id
   and pc.position = 0;

create index if not exists product_collections_order_idx
  on product_collections (collection_id, position);

-- ---------------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists collections_updated_at on collections;
create trigger collections_updated_at before update on collections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Storefront visibility
-- ---------------------------------------------------------------------------
-- 0003 gave anon a blanket read on collections. Now that a collection can be
-- staged before a drop, that policy would leak the unreleased ones — the title
-- and artwork of a collection are exactly what a merchant wants held back.
-- Replaced with the same shape as products_public_read.
drop policy if exists collections_public_read on collections;
create policy collections_public_read on collections
  for select to anon
  using (published_at is not null and published_at <= now());

-- The join table has to agree, or an unpublished collection's membership would
-- still be enumerable even though the collection row is hidden.
--
-- Both halves are load-bearing and 0003 only had the first: the product must be
-- active (else a draft product leaks through its membership) AND the collection
-- must be published (else the shape of an unreleased drop leaks through the
-- join). Dropping either check reopens one of the two.
drop policy if exists product_collections_public_read on product_collections;
create policy product_collections_public_read on product_collections
  for select to anon
  using (
    exists (
      select 1 from products p
      where p.id = product_collections.product_id and p.status = 'active'
    )
    and exists (
      select 1 from collections c
      where c.id = product_collections.collection_id
        and c.published_at is not null
        and c.published_at <= now()
    )
  );
