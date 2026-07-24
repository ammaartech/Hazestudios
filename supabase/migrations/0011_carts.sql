-- Shopping carts.
--
-- ===========================================================================
-- WHY A TABLE AND NOT A COOKIE
-- ===========================================================================
-- A cart could live entirely in the browser, and for a guest-only store that
-- would be less machinery than this. Three things make it the wrong call here:
--
--   * A cookie cart is capped at ~4KB and is trivially editable by the shopper.
--     Any price it carries is a suggestion, so the server has to re-resolve
--     every line anyway — at which point the cookie is only holding ids.
--   * `orders.customer_id` already exists. A cart that is a row with a nullable
--     `customer_id` becomes a customer's cart with one UPDATE; a cart that is a
--     cookie has to be re-uploaded and reconciled on every sign-in.
--   * Abandoned carts are a real admin surface (there is already a route for
--     them at /admin/orders/abandoned). Carts the server cannot see are carts
--     nobody can recover.
--
-- So the browser holds one opaque token in an httpOnly cookie, and the rows
-- live here.
--
-- ===========================================================================
-- WHY NO PRICES ARE STORED ON A CART LINE
-- ===========================================================================
-- `order_items` snapshots title, variant and price, because an order is a
-- contract and must not change when the catalogue does. A cart is the opposite:
-- it is an *intent*, and a shopper returning to a cart a week later should see
-- today's price, today's stock and today's product title — not a stale quote.
--
-- So a cart line stores references and a quantity, and nothing else. Every
-- price the shopper sees is resolved live from `products`/`product_variants` at
-- read time. The snapshot happens once, at checkout, on the way into
-- `order_items`.
--
-- ===========================================================================
-- WHY RLS GRANTS NOBODY ANYTHING
-- ===========================================================================
-- This follows the precedent 0003 set for checkout and 0007 set for analytics:
-- a public insert policy on a cart table would let anyone forge rows, and a
-- public select policy would let anyone enumerate other people's carts. There
-- is no `using (...)` expression that fixes this, because a guest cart has no
-- authenticated identity to scope against — the bearer token IS the identity,
-- and RLS cannot see a cookie.
--
-- So: RLS on, staff get read for the admin's abandoned-cart views, and anon and
-- authenticated get nothing at all. Every storefront read and write goes through
-- the service-role client in a server action, which checks the token first.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists carts (
  id          uuid primary key default gen_random_uuid(),
  -- Opaque bearer token, held in an httpOnly cookie. 32 random bytes, base64url.
  -- Not a uuid: uuids invite being treated as guessable-but-fine identifiers,
  -- and this one is a credential.
  token       text not null unique,
  -- Null for a guest cart. Set when a signed-in shopper's cart is claimed.
  customer_id uuid references customers (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists carts_customer_idx on carts (customer_id);
-- Drives both abandoned-cart reporting and the sweep in step 5.
create index if not exists carts_updated_idx on carts (updated_at);

create table if not exists cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references carts (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  -- Null for a simple product with no variants, mirroring inventory_levels.
  variant_id uuid references product_variants (id) on delete cascade,
  quantity   int not null default 1 check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cart_items_cart_idx on cart_items (cart_id);

-- Adding a variant that is already in the cart must bump its quantity rather
-- than create a second line. Two partial indexes rather than one index over
-- (cart_id, product_id, variant_id): Postgres treats NULLs as distinct in a
-- unique index, so the single-index version would happily allow a simple
-- product to be added twice.
create unique index if not exists cart_items_variant_key
  on cart_items (cart_id, variant_id) where variant_id is not null;

create unique index if not exists cart_items_simple_key
  on cart_items (cart_id, product_id) where variant_id is null;

-- ---------------------------------------------------------------------------
-- 2. updated_at
-- ---------------------------------------------------------------------------
-- `carts.updated_at` is what makes a cart "abandoned", so it has to move when a
-- *line* changes, not only when the cart row itself does. Hence the second
-- trigger reaching up to the parent.
drop trigger if exists carts_updated_at on carts;
create trigger carts_updated_at before update on carts
  for each row execute function set_updated_at();

drop trigger if exists cart_items_updated_at on cart_items;
create trigger cart_items_updated_at before update on cart_items
  for each row execute function set_updated_at();

create or replace function public.touch_cart() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update carts set updated_at = now()
   where id = coalesce(new.cart_id, old.cart_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists cart_items_touch_cart on cart_items;
create trigger cart_items_touch_cart
  after insert or update or delete on cart_items
  for each row execute function public.touch_cart();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table carts enable row level security;
alter table cart_items enable row level security;

-- Staff read only. Even staff do not get write access: nothing in the admin
-- edits a shopper's live cart, and a policy that allows it is a policy that can
-- be exercised by mistake. Recovery emails read carts; they do not rewrite them.
drop policy if exists carts_staff_read on carts;
create policy carts_staff_read on carts
  for select to authenticated
  using (public.is_staff());

drop policy if exists cart_items_staff_read on cart_items;
create policy cart_items_staff_read on cart_items
  for select to authenticated
  using (public.is_staff());

-- Deliberately absent: any policy for `anon`, and any write policy at all.
-- See the header. Service role bypasses RLS and is the only writer.

-- ---------------------------------------------------------------------------
-- 4. Claiming a cart for a signed-in customer
-- ---------------------------------------------------------------------------
-- Called after sign-in, with the guest cart's token. Merges that cart into the
-- customer's existing cart if they have one, otherwise adopts it outright.
--
-- Quantities are summed and clamped rather than replaced: a shopper who put two
-- of something in on their phone and one on their laptop meant to have three,
-- and silently discarding either side is the one behaviour they would notice.
--
-- Returns the token of the cart that survived, which the caller writes back to
-- the cookie — it is not necessarily the token that was passed in.
create or replace function public.claim_cart(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_guest    uuid;
  v_existing uuid;
  v_token    text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Staff shop from the admin, not the storefront; they have no customer row.
  select id into v_customer from customers where user_id = auth.uid();
  if v_customer is null then
    return p_token;
  end if;

  select id into v_guest from carts
   where token = p_token and customer_id is null;

  -- The customer's own cart, most recently touched if somehow there are several.
  select id, token into v_existing, v_token from carts
   where customer_id = v_customer
   order by updated_at desc
   limit 1;

  -- Nothing to merge from — hand back whichever cart they already had.
  if v_guest is null then
    return coalesce(v_token, p_token);
  end if;

  -- No prior cart: the guest cart simply becomes theirs. Cheapest path, and the
  -- common one.
  if v_existing is null then
    update carts set customer_id = v_customer where id = v_guest;
    return p_token;
  end if;

  -- Both exist. Fold the guest lines into the customer's cart.
  insert into cart_items (cart_id, product_id, variant_id, quantity)
  select v_existing, product_id, variant_id, quantity
    from cart_items where cart_id = v_guest and variant_id is not null
  on conflict (cart_id, variant_id) where variant_id is not null
  do update set quantity = least(99, cart_items.quantity + excluded.quantity);

  insert into cart_items (cart_id, product_id, variant_id, quantity)
  select v_existing, product_id, variant_id, quantity
    from cart_items where cart_id = v_guest and variant_id is null
  on conflict (cart_id, product_id) where variant_id is null
  do update set quantity = least(99, cart_items.quantity + excluded.quantity);

  delete from carts where id = v_guest;

  update carts set updated_at = now() where id = v_existing;

  return v_token;
end;
$$;

revoke all on function public.claim_cart(text) from public;
grant execute on function public.claim_cart(text) to authenticated;

comment on function public.claim_cart(text) is
  'Merges a guest cart into the calling customer''s cart. Returns the surviving cart token, which the caller must write back to the cart cookie.';

-- ---------------------------------------------------------------------------
-- 5. Sweeping abandoned guest carts
-- ---------------------------------------------------------------------------
-- Guest carts accumulate forever otherwise — every bot that touches a product
-- page leaves one. 60 days is past any useful recovery window and comfortably
-- past the cookie's own lifetime, so nothing a shopper could still return to is
-- removed. Customer carts are never swept: those belong to a known person.
--
-- Not scheduled here. Call it from a cron job or the SQL editor:
--   select public.sweep_abandoned_carts();
create or replace function public.sweep_abandoned_carts(p_days int default 60)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from carts
   where customer_id is null
     and updated_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.sweep_abandoned_carts(int) from public;

comment on table carts is
  'Live shopping carts. Identified by an opaque bearer token in an httpOnly cookie; customer_id is set once the shopper signs in. Written only by the service role.';
comment on table cart_items is
  'Cart lines. References and quantity only — prices are resolved live at read time and snapshotted into order_items at checkout.';
