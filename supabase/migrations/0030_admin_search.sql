-- ---------------------------------------------------------------------------
-- Global admin search
-- ---------------------------------------------------------------------------
--
-- The admin's topbar search used to be an input that pushed `?q=` at the
-- products list and nothing more. This migration backs the half of the new
-- search that cannot live in the browser.
--
-- The split is by cardinality, and it is the whole design:
--
--   * Products (849) and collections (33) are 55 KB gzipped in total. They ship
--     to the client once per session and are matched there, so every keystroke
--     ranks the entire catalogue in well under a millisecond with no network at
--     all. Nothing in this file is on that path.
--
--   * Orders (6,772), customers (3,974) and variant SKUs (2,659) are too many
--     to ship and change too often to cache. They are searched here, over the
--     wire, debounced — and merged into the dropdown when they land rather than
--     being waited on. `admin_search` is that query.
--
-- One round trip, not three: the function unions the three entities and ranks
-- them against each other, so the caller gets a single ordered result set and
-- the dropdown does not have to reconcile three in-flight requests per
-- keystroke.
--
-- SECURITY INVOKER, deliberately. Every table here is `for all to authenticated
-- using (true)` (0001_init.sql), so the function needs no privileges of its
-- own — and if those policies ever tighten, this tightens with them instead of
-- quietly becoming a bypass.

-- ---------------------------------------------------------------------------
-- Trigram matching
-- ---------------------------------------------------------------------------
--
-- pg_trgm buys two distinct things, and it is worth being clear which is which:
--
--   1. `similarity()` / `%` — real typo tolerance. "shriya" finds "Shreya".
--      Used for customer names only, where misspelling is the norm.
--   2. GIN indexes that make an unanchored `ilike '%foo%'` an index scan
--      instead of a sequential one. This is what most of the indexes below are
--      for: an operator searching an order types the *middle* of an email or
--      the tail of a phone number, and a left-anchored btree is useless for it.
--
-- Created without a schema qualifier so it lands wherever the migration role's
-- search_path puts it; the function below searches `public, extensions` so it
-- resolves either way.
create extension if not exists pg_trgm;

-- Orders. `email` and `phone` are `not null default ''`, `order_name` is
-- nullable (only imported orders carry one) — GIN simply skips the nulls.
create index if not exists orders_order_name_trgm_idx
  on orders using gin (lower(order_name) gin_trgm_ops);
create index if not exists orders_email_trgm_idx
  on orders using gin (lower(email) gin_trgm_ops);
create index if not exists orders_phone_trgm_idx
  on orders using gin (phone gin_trgm_ops);

-- Order numbers are matched as *text* with a prefix, because "758" should
-- surface #7580–#7589 while someone is still typing. text_pattern_ops is what
-- makes `like '758%'` indexable regardless of the database's collation.
create index if not exists orders_order_number_text_idx
  on orders ((order_number::text) text_pattern_ops);

-- Customers. The full name is indexed as one expression rather than two
-- columns: the query is "shreya nair", and matching that against first_name and
-- last_name separately would need the caller to guess where the split falls.
-- Safe as an index expression because both columns are `not null default ''`,
-- so the concatenation is never null and `lower(a || ' ' || b)` is immutable.
create index if not exists customers_name_trgm_idx
  on customers using gin (lower(first_name || ' ' || last_name) gin_trgm_ops);
create index if not exists customers_email_trgm_idx
  on customers using gin (lower(email) gin_trgm_ops);
create index if not exists customers_phone_trgm_idx
  on customers using gin (phone gin_trgm_ops);

-- Variant SKUs. 2,659 of 4,751 variants carry one, and for the Qikink-fulfilled
-- range it is an opaque token pasted from a manifest — never typed from memory,
-- always pasted whole or in part. Substring matching is the only useful shape.
create index if not exists product_variants_sku_trgm_idx
  on product_variants using gin (lower(sku) gin_trgm_ops);

-- Product title/vendor, for the `?q=` list pages that still filter in SQL
-- (admin/products, and the storefront's /search). The dropdown does not use
-- these — it matches products in the browser — but every one of those pages was
-- running an unanchored ilike against a sequential scan.
create index if not exists products_title_trgm_idx
  on products using gin (lower(title) gin_trgm_ops);
create index if not exists products_vendor_trgm_idx
  on products using gin (lower(vendor) gin_trgm_ops);
create index if not exists collections_title_trgm_idx
  on collections using gin (lower(title) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- admin_search(q, lim)
-- ---------------------------------------------------------------------------
--
-- Scores are normalised to 0..1 across all three entities so the caller can
-- rank them against each other and against the browser-side results, which use
-- the same scale.
--
-- The scoring shape is a `greatest()` over independent match kinds rather than
-- a sum, because these are alternatives, not evidence to accumulate: an exact
-- email match is an exact match whether or not the phone number also happens to
-- contain the digits. Summing would let three weak partial matches outrank one
-- certain hit, which is exactly the failure that makes a search feel random.
--
-- The rungs, and why they sit where they do:
--
--   1.00  exact — this is the record, stop looking
--   0.90  prefix on an identifier (order number, order name)
--   0.82  prefix on a name or email — what typing forward feels like
--   0.72  substring on an identifier
--   0.60  substring anywhere else
--   ≤0.72 trigram similarity, scaled so a perfect fuzzy match can never
--         outrank a real prefix match
--
-- `set pg_trgm.similarity_threshold = 0.3` is attached to the function rather
-- than left to the session: the `%` operator reads that GUC, and PostgREST
-- hands out pooled connections whose session state this function has no way to
-- predict. Pinning it here makes the result set a function of its arguments.
create or replace function public.admin_search(q text, lim int default 6)
returns table (
  kind     text,
  id       uuid,
  title    text,
  subtitle text,
  meta     text,
  amount   numeric,
  at       timestamptz,
  score    real
)
language sql
stable
security invoker
set search_path = public, extensions
set pg_trgm.similarity_threshold = 0.3
as $$
with n as (
  select
    lower(btrim(q))                       as t,
    '%' || lower(btrim(q)) || '%'         as any_t,
    lower(btrim(q)) || '%'                as pre_t,
    -- Below two characters there is no useful answer, only cost: `ilike '%a%'`
    -- matches most of the email column and no index can help, so it degrades
    -- into a sequential scan of every order and customer in the store.
    --
    -- Enforced here rather than only in the caller because this function is a
    -- PostgREST endpoint: any authenticated session can invoke it directly, and
    -- a guard that lives in TypeScript is not a guard on the database.
    length(lower(btrim(q))) >= 2          as usable,
    -- Operators paste order references in every dialect the store has ever
    -- used: "7586", "#7586", "FOG7586". Stripping to digits makes all three
    -- reach order_number. Capped at 9 digits so a pasted phone number or a
    -- transaction id cannot overflow the int cast.
    nullif(regexp_replace(q, '[^0-9]', '', 'g'), '') as digits
),

-- Orders --------------------------------------------------------------------
-- Drafts are included: an operator looking up "7586" wants that record whether
-- or not it was finalised, and `meta` tells them which it is.
ord as (
  select
    'order'::text as kind,
    o.id,
    coalesce(nullif(o.order_name, ''), '#' || o.order_number::text) as title,
    -- The order's own contact, not the customer's current one. An order is a
    -- contract; it must keep saying who placed it after the profile is edited.
    nullif(
      btrim(coalesce(nullif(o.email, ''), '') || ' ' || coalesce(nullif(o.phone, ''), '')),
      ''
    ) as subtitle,
    case
      when o.is_draft       then 'Draft'
      when o.cancelled_at is not null then 'Cancelled'
      else initcap(replace(o.payment_status::text, '_', ' '))
    end as meta,
    o.total as amount,
    o.created_at as at,
    greatest(
      case when n.digits is not null and o.order_number::text = n.digits          then 1.00 else 0 end,
      case when lower(coalesce(o.order_name, '')) = n.t                           then 1.00 else 0 end,
      case when lower(o.email) = n.t                                              then 1.00 else 0 end,
      case when n.digits is not null and o.order_number::text like n.digits || '%' then 0.90 else 0 end,
      case when lower(coalesce(o.order_name, '')) like n.pre_t                     then 0.90 else 0 end,
      case when lower(o.email) like n.pre_t                                        then 0.82 else 0 end,
      case when o.phone like n.pre_t                                               then 0.82 else 0 end,
      case when lower(coalesce(o.order_name, '')) like n.any_t                     then 0.72 else 0 end,
      case when o.phone like n.any_t                                               then 0.66 else 0 end,
      case when lower(o.email) like n.any_t                                        then 0.60 else 0 end
    )::real as score
  from orders o
  cross join n
  where n.usable and (
    -- Every branch here is index-backed, and this is the only place row count
    -- is reduced: scoring runs on the survivors, not on all 6,772 rows.
    (n.digits is not null and length(n.digits) <= 9 and o.order_number::text like n.digits || '%')
    or lower(coalesce(o.order_name, '')) like n.any_t
    or lower(o.email) like n.any_t
    or o.phone like n.any_t
  )
),

-- Customers -----------------------------------------------------------------
-- The one entity where fuzzy matching earns its keep. Names arrive from
-- checkout typed by the shopper and from support tickets typed from a phone
-- call, and the two spellings routinely disagree.
cust as (
  select
    'customer'::text as kind,
    c.id,
    coalesce(
      nullif(btrim(c.first_name || ' ' || c.last_name), ''),
      c.email,
      c.phone,
      'Unnamed customer'
    ) as title,
    coalesce(nullif(c.email, ''), c.phone) as subtitle,
    case
      when c.orders_count = 1 then '1 order'
      else c.orders_count::text || ' orders'
    end as meta,
    c.total_spent as amount,
    c.created_at as at,
    least(
      1.0,
      greatest(
        case when lower(c.email) = n.t                                   then 1.00 else 0 end,
        case when lower(c.first_name || ' ' || c.last_name) = n.t        then 1.00 else 0 end,
        case when lower(c.first_name) like n.pre_t                       then 0.86 else 0 end,
        case when lower(c.last_name)  like n.pre_t                       then 0.84 else 0 end,
        case when lower(c.email)      like n.pre_t                       then 0.82 else 0 end,
        case when c.phone             like n.pre_t                       then 0.82 else 0 end,
        case when c.phone             like n.any_t                       then 0.66 else 0 end,
        case when lower(c.email)      like n.any_t                       then 0.60 else 0 end,
        -- Scaled to 0.72 so a perfect trigram match lands just under a real
        -- prefix match rather than displacing it.
        similarity(lower(c.first_name || ' ' || c.last_name), n.t) * 0.72
      )
      -- A customer with fifty orders is more likely to be the one being looked
      -- for than an identically-named ghost from an import. Capped low: this
      -- breaks ties, it does not decide matches.
      + least(0.06, c.orders_count * 0.01)
    )::real as score
  from customers c
  cross join n
  where n.usable and (
    lower(c.first_name || ' ' || c.last_name) like n.any_t
    or lower(c.email) like n.any_t
    or c.phone like n.any_t
    or lower(c.first_name || ' ' || c.last_name) % n.t
  )
),

-- Variant SKUs --------------------------------------------------------------
-- Emitted as `product` so the dropdown files them under Products alongside the
-- browser-side title matches; the caller dedupes on id and keeps the better
-- score. `distinct on` collapses the several variants of one product that share
-- a SKU stem down to the single best-scoring row.
sku as (
  select distinct on (p.id)
    'product'::text as kind,
    p.id,
    p.title,
    'SKU ' || v.sku as subtitle,
    initcap(p.status::text) as meta,
    p.price as amount,
    p.created_at as at,
    (case
      when lower(v.sku) = n.t        then 1.00
      when lower(v.sku) like n.pre_t then 0.90
      else 0.72
    end)::real as score
  from product_variants v
  join products p on p.id = v.product_id
  cross join n
  where v.sku is not null
    and v.sku <> ''
    -- Two characters of an opaque token match half the catalogue. Below three,
    -- the GIN index cannot help either — trigrams need three characters.
    and length(n.t) >= 3
    and lower(v.sku) like n.any_t
  order by p.id, score desc
),

merged as (
  select * from ord
  union all select * from cust
  union all select * from sku
)

select kind, id, title, subtitle, meta, amount, at, score
from (
  select
    m.*,
    -- Per-kind caps, not one global cap: forty matching orders must never be
    -- able to push the one matching customer off the end of the list.
    row_number() over (partition by m.kind order by m.score desc, m.at desc) as rn
  from merged m
  where m.score > 0
) ranked
where rn <= greatest(1, least(lim, 20))
order by score desc, at desc;
$$;

comment on function public.admin_search(text, int) is
  'Global admin search over orders, customers and variant SKUs. Scores are '
  '0..1 and comparable with the browser-side product matcher in '
  'src/lib/search/fuzzy.ts. Products and collections are deliberately absent — '
  'they are matched client-side from a prefetched index.';

-- PostgREST resolves RPCs through the caller's role; without this the function
-- is invisible to the admin client.
grant execute on function public.admin_search(text, int) to authenticated;
