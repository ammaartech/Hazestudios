-- Admin performance and hardening.
--
-- Measured before this migration (pg_stat_statements, 2026-09-20):
--
--   * `select count(*) from orders` as a staff session took 330 ms; the same
--     statement as the service role took 140 ms. The difference is the RLS
--     policy: `using (is_staff())` is evaluated ONCE PER ROW, and is_staff()
--     is a query against staff_roles, so a 6,700-row count ran 6,700 lookups.
--     Wrapped as `(select is_staff())` the planner hoists it into an InitPlan
--     and runs it once per statement. Same statement, same result, ~2.5x.
--   * `fulfillments` had 11,377 sequential scans and 4 index scans. It has no
--     index on order_id, and the orders list embeds it per row.
--   * `refunds` likewise: 21,655 sequential scans, 1 index scan.
--
-- ---------------------------------------------------------------------------
-- 1. Evaluate is_staff() / auth.uid() once per statement, not once per row
-- ---------------------------------------------------------------------------
-- Rewritten from the catalog rather than listed by hand so every policy on
-- every table gets it, including the ones later migrations add before anyone
-- remembers this file. Skips expressions already wrapped, so it is safe to run
-- again.
do $$
declare
  p        record;
  new_qual text;
  new_chk  text;
  stmt     text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (
        coalesce(qual, '')       ~ '(?<!SELECT )(public\.)?(is_staff|auth\.uid)\(\)'
        or coalesce(with_check, '') ~ '(?<!SELECT )(public\.)?(is_staff|auth\.uid)\(\)'
      )
  loop
    new_qual := regexp_replace(p.qual,       '(?<!SELECT )(public\.)?is_staff\(\)', '(select public.is_staff())', 'g');
    new_qual := regexp_replace(new_qual,     '(?<!SELECT )auth\.uid\(\)',           '(select auth.uid())',        'g');
    new_chk  := regexp_replace(p.with_check, '(?<!SELECT )(public\.)?is_staff\(\)', '(select public.is_staff())', 'g');
    new_chk  := regexp_replace(new_chk,      '(?<!SELECT )auth\.uid\(\)',           '(select auth.uid())',        'g');

    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if p.with_check is not null then
      stmt := stmt || format(' with check (%s)', new_chk);
    end if;

    begin
      execute stmt;
    exception when insufficient_privilege then
      -- storage.objects is owned by the storage service on some projects.
      raise notice 'skipped % (insufficient privilege)', p.policyname;
    end;
  end loop;
end $$;

-- 0015 created this table with `using (true)` for every authenticated user,
-- which includes shopper accounts. It is an admin table.
alter policy product_imports_staff_all on public.product_imports
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- 2. Indexes the admin's reads were missing
-- ---------------------------------------------------------------------------
create index if not exists fulfillments_order_idx on public.fulfillments (order_id);
create index if not exists refunds_order_idx      on public.refunds (order_id);
create index if not exists refunds_created_idx    on public.refunds (created_at);

-- The orders list: newest first, one tab at a time. Partial on is_draft so the
-- 6,700 live orders and the handful of drafts never share a scan.
create index if not exists orders_live_created_idx
  on public.orders (created_at desc) where is_draft = false;
create index if not exists orders_live_fulfillment_idx
  on public.orders (fulfillment_status, created_at desc) where is_draft = false;
create index if not exists orders_live_payment_idx
  on public.orders (payment_status, created_at desc) where is_draft = false;
create index if not exists orders_live_open_idx
  on public.orders (created_at desc) where is_draft = false and closed_at is null;
create index if not exists orders_draft_created_idx
  on public.orders (created_at desc) where is_draft = true;
-- Prev/next on the order page walks order_number within is_draft.
create index if not exists orders_number_idx on public.orders (is_draft, order_number);

create index if not exists products_created_idx  on public.products (created_at desc);
create index if not exists products_updated_idx  on public.products (updated_at desc);
create index if not exists customers_created_idx on public.customers (created_at desc);
create index if not exists discounts_created_idx on public.discounts (created_at desc);

-- The dashboard funnel counts add-to-cart sessions in a window.
create index if not exists analytics_events_cart_idx
  on public.analytics_events (created_at) where type = 'add_to_cart';

-- ---------------------------------------------------------------------------
-- 3. Staff status in the JWT
-- ---------------------------------------------------------------------------
-- The admin gate ran two network calls per request: `auth.getUser()` and
-- `rpc('is_staff')`. The project signs tokens with ES256 and publishes a JWKS,
-- so the app can now verify the token locally — but it still needs to know
-- whether the holder is staff without asking Postgres. That fact belongs in
-- `app_metadata`, which only the service role and the database can write, so
-- the token itself carries it. This trigger keeps it true to staff_roles, and
-- RLS remains the boundary: a forged claim gets an empty admin, not data.
create or replace function public.sync_staff_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := coalesce(new.user_id, old.user_id);
  srole text;
begin
  select role::text into srole from public.staff_roles where user_id = uid;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('is_staff', srole is not null, 'staff_role', srole)
   where id = uid;
  return coalesce(new, old);
end;
$$;

revoke all on function public.sync_staff_claim() from public;

drop trigger if exists staff_roles_sync_claim on public.staff_roles;
create trigger staff_roles_sync_claim
  after insert or update or delete on public.staff_roles
  for each row execute function public.sync_staff_claim();

-- Backfill everyone who is staff today. Their current token is stamped on its
-- next refresh (an hour at most); until then the gate falls back to the RPC.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object('is_staff', true, 'staff_role', s.role::text)
  from public.staff_roles s
 where s.user_id = u.id;

-- ---------------------------------------------------------------------------
-- 4. One round trip for the order page
-- ---------------------------------------------------------------------------
-- The order page made four sequential waves of requests (order + children,
-- then images, then prev/next). Tokyo is ~140 ms away, so that was more than
-- half a second of pure waiting. One function, one trip. SECURITY INVOKER so
-- RLS still decides who sees an order.
create or replace function public.admin_order_detail(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'order', to_jsonb(o) || jsonb_build_object('customers', to_jsonb(c)),
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(i) || jsonb_build_object(
          'image', (
            select jsonb_build_object('url', pi.url, 'alt', pi.alt)
            from product_images pi
            where pi.product_id = i.product_id
            order by pi.position
            limit 1
          )
        )
        order by i.id
      )
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'fulfillments', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at desc)
      from fulfillments f where f.order_id = o.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from refunds r where r.order_id = o.id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', n.id, 'body', n.body, 'author_email', n.author_email, 'created_at', n.created_at)
        order by n.created_at desc
      )
      from order_notes n where n.order_id = o.id
    ), '[]'::jsonb),
    'previous_id', (
      select p.id from orders p
      where p.is_draft = o.is_draft and p.order_number < o.order_number
      order by p.order_number desc limit 1
    ),
    'next_id', (
      select p.id from orders p
      where p.is_draft = o.is_draft and p.order_number > o.order_number
      order by p.order_number limit 1
    )
  )
  from orders o
  left join customers c on c.id = o.customer_id
  where o.id = p_id;
$$;

revoke all on function public.admin_order_detail(uuid) from public;
grant execute on function public.admin_order_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. One round trip for the Home tiles
-- ---------------------------------------------------------------------------
create or replace function public.admin_home_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'products',    (select count(*) from products),
    'unfulfilled', (select count(*) from orders where is_draft = false and fulfillment_status = 'unfulfilled'),
    'customers',   (select count(*) from customers)
  );
$$;

revoke all on function public.admin_home_counts() from public;
grant execute on function public.admin_home_counts() to authenticated;
