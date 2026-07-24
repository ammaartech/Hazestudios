-- Customer accounts, and the security rework they require.
--
-- ===========================================================================
-- WHY THIS MIGRATION IS A SECURITY FIX FIRST AND A FEATURE SECOND
-- ===========================================================================
-- 0001 built an admin-only system and encoded that assumption as
-- "authenticated == staff":
--
--   * every table got `for all to authenticated using (true) with check (true)`
--   * the storage buckets got the same
--   * `grant_first_owner` inserted a `staff_roles` row for EVERY new auth user
--
-- That is correct while the only people who can log in are staff. The moment
-- shoppers can sign up it becomes three independent full compromises: a new
-- customer would be granted a staff role outright, and even without one they
-- could read and write products, orders, other customers, discounts and gift
-- cards.
--
-- So customer accounts cannot be added on top of this. The trust model has to
-- change underneath them first, which is what the bulk of this file does:
--
--   1. `is_staff()` becomes the single definition of staff.
--   2. Every staff policy is re-pointed at it.
--   3. The signup trigger stops minting staff.
--   4. Customers get narrow, self-scoped read access and nothing else.
--
-- Customers never get write access to anything except their own profile row.
-- Orders are written by staff or by a service-role checkout, never by the
-- shopper's own session.

-- ---------------------------------------------------------------------------
-- 1. The staff predicate
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read staff_roles without tripping that table's own
-- RLS policy — a policy on staff_roles that queried staff_roles would recurse.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_roles where user_id = auth.uid()
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

comment on function public.is_staff() is
  'True when the current session belongs to a staff member. The single source of truth for admin access; do not inline `exists(select from staff_roles)` in policies.';

-- ---------------------------------------------------------------------------
-- 2. Re-point every staff policy at is_staff()
-- ---------------------------------------------------------------------------
-- Same table list as 0001, plus the analytics tables from 0007, which had the
-- same over-broad `to authenticated using (true)` read policy.
do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_roles','shop_settings','locations','products','product_images',
    'product_options','product_variants','collections','product_collections',
    'inventory_levels','customers','segments','orders','order_items',
    'fulfillments','refunds','discounts','gift_cards','files'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_staff_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_staff_all', t
    );
  end loop;

  foreach t in array array['analytics_sessions','analytics_events'] loop
    execute format('drop policy if exists %I on %I', t || '_admin_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (public.is_staff())',
      t || '_admin_read', t
    );
  end loop;
end $$;

-- Storage: 0001 let any authenticated user write the product-image, files and
-- brand buckets. A shopper could have replaced product photography.
drop policy if exists "staff write product-images" on storage.objects;
create policy "staff write buckets" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-images','files','brand') and public.is_staff())
  with check (bucket_id in ('product-images','files','brand') and public.is_staff());

-- ---------------------------------------------------------------------------
-- 3. Stop the signup trigger minting staff
-- ---------------------------------------------------------------------------
-- Bootstrap only. The first account to exist owns the store; everyone after is
-- a shopper. Staff are promoted deliberately from the admin, never by signing up.
create or replace function public.grant_first_owner() returns trigger as $$
begin
  if not exists (select 1 from public.staff_roles) then
    insert into public.staff_roles (user_id, role, display_name)
    values (new.id, 'owner', coalesce(new.raw_user_meta_data->>'display_name', new.email));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Link customers to auth users
-- ---------------------------------------------------------------------------
alter table customers
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- One auth user maps to at most one customer record. Partial, because the great
-- majority of rows are guest/imported customers with no account at all.
create unique index if not exists customers_user_id_key
  on customers (user_id) where user_id is not null;

-- Account claiming matches on email, case-insensitively.
create index if not exists customers_email_lower_idx on customers (lower(email));

-- ---------------------------------------------------------------------------
-- 5. Customer-scoped RLS
-- ---------------------------------------------------------------------------
-- Every policy below is SELECT-only except the profile update, and every one is
-- scoped through `customers.user_id = auth.uid()`. A customer can never widen
-- their view by guessing an id.

-- Own profile: read and limited update.
create policy customers_self_read on customers
  for select to authenticated
  using (user_id = auth.uid());

create policy customers_self_update on customers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Own orders. Drafts stay invisible: they are staff scratch space, not orders
-- the customer has placed.
create policy orders_self_read on orders
  for select to authenticated
  using (
    is_draft = false
    and customer_id in (select id from customers where user_id = auth.uid())
  );

create policy order_items_self_read on order_items
  for select to authenticated
  using (
    order_id in (
      select o.id from orders o
      join customers c on c.id = o.customer_id
      where c.user_id = auth.uid() and o.is_draft = false
    )
  );

-- Shipment tracking and refund history for own orders.
create policy fulfillments_self_read on fulfillments
  for select to authenticated
  using (
    order_id in (
      select o.id from orders o
      join customers c on c.id = o.customer_id
      where c.user_id = auth.uid() and o.is_draft = false
    )
  );

create policy refunds_self_read on refunds
  for select to authenticated
  using (
    order_id in (
      select o.id from orders o
      join customers c on c.id = o.customer_id
      where c.user_id = auth.uid() and o.is_draft = false
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Account claiming
-- ---------------------------------------------------------------------------
-- Called once after sign-in. Returns the caller's customer id, creating or
-- claiming a record as needed.
--
-- The email-confirmation guard is the whole security story here: matching an
-- unconfirmed address to an existing customer would let anyone read a stranger's
-- order history by signing up with their email. So an unconfirmed session gets
-- a customer record of its own and inherits nothing.
create or replace function public.link_customer_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id         uuid := auth.uid();
  v_email      text;
  v_confirmed  timestamptz;
  v_meta       jsonb;
  v_customer   uuid;
  v_first      text;
  v_last       text;
begin
  if v_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Staff use the admin, not a storefront account.
  if exists (select 1 from staff_roles where user_id = v_id) then
    return null;
  end if;

  select email, email_confirmed_at, coalesce(raw_user_meta_data, '{}'::jsonb)
    into v_email, v_confirmed, v_meta
    from auth.users where id = v_id;

  -- Already linked — nothing to do.
  select id into v_customer from customers where user_id = v_id;
  if v_customer is not null then
    return v_customer;
  end if;

  -- Prefer names supplied by the provider (Google gives given_name/family_name).
  v_first := coalesce(
    nullif(v_meta->>'first_name', ''),
    nullif(v_meta->>'given_name', ''),
    nullif(split_part(coalesce(v_meta->>'full_name', v_meta->>'name', ''), ' ', 1), ''),
    ''
  );
  v_last := coalesce(
    nullif(v_meta->>'last_name', ''),
    nullif(v_meta->>'family_name', ''),
    nullif(substring(coalesce(v_meta->>'full_name', v_meta->>'name', '') from position(' ' in coalesce(v_meta->>'full_name', v_meta->>'name', '')) + 1), ''),
    ''
  );

  -- Claim a prior guest/imported record, but only on a confirmed address and
  -- only if nobody else already owns it.
  if v_confirmed is not null and v_email is not null then
    select id into v_customer
      from customers
     where lower(email) = lower(v_email)
       and user_id is null
     order by created_at
     limit 1;

    if v_customer is not null then
      update customers
         set user_id    = v_id,
             first_name = case when first_name = '' then v_first else first_name end,
             last_name  = case when last_name  = '' then v_last  else last_name  end
       where id = v_customer;
      return v_customer;
    end if;
  end if;

  insert into customers (user_id, email, first_name, last_name)
  values (v_id, v_email, v_first, v_last)
  returning id into v_customer;

  return v_customer;
end;
$$;

revoke all on function public.link_customer_account() from public;
grant execute on function public.link_customer_account() to authenticated;

comment on function public.link_customer_account() is
  'Idempotently returns the caller''s customer id. Claims a matching guest record only when the auth email is confirmed.';
