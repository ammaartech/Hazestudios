-- Checkout durability. Apply before deploying the matching application code.
alter table orders
  add column checkout_cart_key text unique,
  add column reservation_expires_at timestamptz,
  add column stock_released_at timestamptz;

create table checkout_stock_allocations (
  order_id uuid not null references orders(id) on delete cascade,
  inventory_id uuid references inventory_levels(id) on delete set null,
  quantity integer not null check (quantity > 0),
  id uuid primary key default gen_random_uuid()
);
alter table checkout_stock_allocations enable row level security;
create index checkout_stock_allocations_order_idx on checkout_stock_allocations(order_id);

alter table payment_events add column processed_at timestamptz;

alter table payments
  add column session_expires_at timestamptz,
  add column gateway_closed_at timestamptz,
  add column gateway_environment text,
  add column reconciliation_required boolean not null default false;

create table commerce_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  kind text not null check (kind in ('fulfill', 'reconcile', 'expire')),
  order_id uuid not null references orders(id) on delete cascade,
  payment_id uuid references payments(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready','running','done','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commerce_jobs_due on commerce_jobs(available_at) where status in ('ready','running');
alter table commerce_jobs enable row level security;
create policy commerce_jobs_staff_read on commerce_jobs for select to authenticated using (public.is_staff());

create table commerce_rate_limits (
  key text primary key, hits integer not null, expires_at timestamptz not null
);
alter table commerce_rate_limits enable row level security;

create function public.consume_commerce_rate(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into commerce_rate_limits as r values (p_key, 1, now() + make_interval(secs => p_seconds))
  on conflict (key) do update set
    hits = case when r.expires_at <= now() then 1 else r.hits + 1 end,
    expires_at = case when r.expires_at <= now() then excluded.expires_at else r.expires_at end
  returning hits into n;
  return n <= p_limit;
end;
$$;

create function public.claim_commerce_job(p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j commerce_jobs%rowtype;
begin
  select * into j from commerce_jobs
  where (p_kind is null or kind = p_kind) and available_at <= now()
    and (status = 'ready' or (status = 'running' and lease_until < now()))
  order by available_at, id for update skip locked limit 1;
  if not found then return null; end if;
  update commerce_jobs set status = 'running', attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes', updated_at = now()
  where id = j.id returning * into j;
  return to_jsonb(j);
end;
$$;

-- An order lock makes allocation/reuse of a gateway attempt atomic across instances.
-- A failed transaction or closed popup does NOT mean its gateway order is closed.
create function public.claim_cashfree_attempt(p_order_id uuid, p_request_id uuid, p_environment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; r payment_requests%rowtype; p payments%rowtype;
  amount numeric; expiry timestamptz; attempt_id uuid := gen_random_uuid();
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.is_draft or o.cancelled_at is not null or o.stock_released_at is not null
    or o.payment_status <> 'pending' then
    raise exception 'This order is no longer awaiting payment.' using errcode = 'HZ001';
  end if;
  if o.reservation_expires_at <= now() then
    raise exception 'The payment window has expired. Please place a new order.' using errcode = 'HZ001';
  end if;
  if p_request_id is not null then
    select * into r from payment_requests where id = p_request_id and order_id = o.id for update;
    if not found or r.status <> 'open' or r.expires_at <= now() or o.payment_method <> 'cod' then
      raise exception 'This advance is no longer available.' using errcode = 'HZ001';
    end if;
    amount := r.amount;
  else
    if o.payment_method not in ('upi','prepaid') then
      raise exception 'This order is not set up for online payment.' using errcode = 'HZ001';
    end if;
    amount := o.total;
  end if;
  if amount < 1 then
    raise exception 'Online payment requires a total of at least 1.' using errcode='HZ001';
  end if;
  select * into p from payments where order_id = o.id and provider='cashfree'
    and request_id is not distinct from p_request_id and gateway_closed_at is null
  order by created_at desc limit 1;
  if found then
    if p.gateway_environment is not null and p.gateway_environment <> p_environment then
      raise exception 'Payment environment changed; contact the store.' using errcode = 'HZ001';
    end if;
    return to_jsonb(p);
  end if;
  expiry := least(now() + interval '30 minutes', coalesce(r.expires_at, now() + interval '30 minutes'));
  if expiry < now() + interval '5 minutes' then
    raise exception 'This payment link is expiring. Please contact the store.' using errcode = 'HZ001';
  end if;
  insert into payments(id, order_id, request_id, provider_order_id, amount, currency,
    session_expires_at, gateway_environment)
  values (attempt_id, o.id, p_request_id, 'HZ' || replace(attempt_id::text,'-',''), amount, o.currency,
    expiry, p_environment) returning * into p;
  if o.reservation_expires_at is not null then
    update orders set reservation_expires_at = greatest(reservation_expires_at, expiry + interval '5 minutes') where id = o.id;
  end if;
  insert into commerce_jobs(job_key, kind, order_id, payment_id, available_at)
  values ('payment:' || p.id, 'reconcile', o.id, p.id, now() + interval '2 minutes');
  return to_jsonb(p);
end;
$$;

create function public.prepare_cashfree_payload(p_payment_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype;
begin
  select * into p from payments where id=p_payment_id for update;
  if not found or p.session_expires_at <= now() then raise exception 'Payment session expired'; end if;
  if p.request = '{}'::jsonb then
    update payments set request=p_payload where id=p.id returning * into p;
  end if;
  return p.request;
end;
$$;

-- One commit records the event, money, order state and downstream work.
-- Any exception rolls all of them back, so the gateway can safely redeliver.
create function public.settle_cashfree_payment(
  p_provider_order_id text, p_outcome jsonb, p_event_key text default null,
  p_event_type text default null, p_event_payload jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; o orders%rowtype; r payment_requests%rowtype;
  s text := p_outcome->>'status'; newly boolean := false; needs_review boolean := false;
begin
  -- Find first, then lock order BEFORE payment/request to keep lock ordering uniform.
  select * into p from payments where provider_order_id = p_provider_order_id;
  if not found then raise exception 'Payment attempt not found' using errcode = 'P0002'; end if;
  select * into o from orders where id = p.order_id for update;
  select * into p from payments where id = p.id for update;
  if p_event_key is not null then
    if p.provider <> 'cashfree' then raise exception 'Webhook does not identify a gateway attempt'; end if;
    insert into payment_events(idempotency_key,event_type,payload)
    values (p_event_key,p_event_type,coalesce(p_event_payload,'{}')) on conflict do nothing;
    -- Old ledger rows only proved receipt. Reprocess them unless completion is explicit.
    perform 1 from payment_events where provider='cashfree' and idempotency_key=p_event_key
      and processed_at is not null;
    if found then return jsonb_build_object('status',p.status,'newlyPaid',false); end if;
  end if;
  if p.status = 'success' then
    update payment_events set processed_at=now() where provider='cashfree' and idempotency_key=p_event_key;
    return jsonb_build_object('status','success','newlyPaid',false);
  end if;
  if s = 'success' and (
    nullif(p_outcome->>'paidAmount','') is null or
    (p_outcome->>'paidAmount')::numeric <> p.amount or
    upper(coalesce(p_outcome->>'paidCurrency','')) <> upper(p.currency)
  ) then
    raise exception 'Payment amount or currency mismatch' using errcode = '22000';
  end if;
  update payments set status = s,
    cf_payment_id = coalesce(p_outcome->>'cfPaymentId',cf_payment_id),
    method = coalesce(p_outcome->>'method',method), error = p_outcome->>'error',
    response = coalesce(p_outcome->'response',response), updated_at = now(),
    gateway_closed_at = case when p_outcome->>'remoteOrderStatus' in ('EXPIRED','TERMINATED','NOT_FOUND')
      then now() else gateway_closed_at end
  where id = p.id;
  if s = 'success' then
    needs_review := o.stock_released_at is not null or o.cancelled_at is not null
      or o.payment_status not in ('pending','partially_paid');
    if p.request_id is not null then
      select * into r from payment_requests where id = p.request_id for update;
      if not found then raise exception 'Payment request missing'; end if;
      if r.status = 'paid' then needs_review := true;
      else
        update payment_requests set status='paid', paid_at=now(), payment_id=p.id,
          resolved_at=now(), updated_at=now() where id=r.id;
        update orders set amount_paid=amount_paid+p.amount,
          payment_status=case when payment_status in ('pending','partially_paid')
            then (case when amount_paid+p.amount >= total then 'paid' else 'partially_paid' end)::payment_status
            else payment_status end,
          released_at=case when not needs_review and held_at is not null then coalesce(released_at,now()) else released_at end
        where id=o.id;
        newly := true;
      end if;
    elsif o.payment_status = 'pending' and not needs_review then
      update orders set payment_status='paid', amount_paid=total where id=o.id;
      newly := true;
    end if;
    if needs_review then
      update payments set reconciliation_required=true, error='Captured payment requires review: order closed, stock released, or another payment already credited.' where id=p.id;
      update orders set held_at=now(), hold_reason='payment_review', released_at=null where id=o.id;
    else
      insert into commerce_jobs(job_key,kind,order_id) values ('fulfill:'||o.id,'fulfill',o.id)
      on conflict (job_key) do update set status='ready', available_at=now(), updated_at=now()
        where commerce_jobs.status in ('done','failed');
    end if;
  end if;
  update payment_events set processed_at=now() where provider='cashfree' and idempotency_key=p_event_key;
  return jsonb_build_object('status',s,'newlyPaid',newly);
end;
$$;

create function public.release_checkout_stock(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; a record;
begin
  select * into o from orders where id=p_order_id for update;
  if not found or o.reservation_expires_at is null or o.reservation_expires_at > now()
    or o.stock_released_at is not null or o.cancelled_at is not null
    or o.payment_status <> 'pending' then return false; end if;
  -- Local time alone is NEVER authority to release potentially paid inventory.
  if exists(select 1 from payments where order_id=o.id and (gateway_closed_at is null or status='success')) then return false; end if;
  if exists(select 1 from checkout_stock_allocations where order_id=o.id and inventory_id is null) then
    raise exception 'Allocated inventory was removed; manual review required';
  end if;
  for a in select il.id, allocation.quantity from checkout_stock_allocations allocation
    join inventory_levels il on il.id=allocation.inventory_id where allocation.order_id=o.id
    order by il.product_id, il.variant_id nulls first, il.id for update of il
  loop
    update inventory_levels set quantity=quantity+a.quantity where id=a.id;
  end loop;
  update orders set stock_released_at=now(), cancelled_at=now(), payment_status='voided',
    fulfillment_status='restocked' where id=o.id;
  if o.discount_code is not null then
    update discounts set used_count=greatest(used_count-1,0) where lower(code)=lower(o.discount_code);
  end if;
  return true;
end;
$$;

-- RPCs and private tables are accessible only to trusted server code.
do $$ declare f record;
begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('consume_commerce_rate','claim_commerce_job','claim_cashfree_attempt','prepare_cashfree_payload','settle_cashfree_payment','release_checkout_stock')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

grant all on checkout_stock_allocations,commerce_jobs,commerce_rate_limits to service_role;

-- Complete replacement of 0022 checkout, retaining pricing and address semantics.
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart        carts%rowtype;
  v_line        record;
  v_stock       int;
  v_untracked   boolean;
  v_unlimited   boolean;
  v_price       numeric(12,2);
  v_subtotal    numeric(12,2) := 0;
  v_lines       int := 0;
  v_discount    numeric(12,2) := 0;
  v_free_ship   boolean := false;
  v_disc        discounts%rowtype;
  v_code        text;
  v_settings    jsonb;
  v_currency    text;
  v_flat        numeric(12,2);
  v_threshold   numeric(12,2);
  v_tax_rate    numeric(12,4);
  v_shipping    numeric(12,2) := 0;
  v_tax         numeric(12,2) := 0;
  v_cod_fee     numeric(12,2) := 0;
  v_prepaid_off numeric(12,2) := 0;
  v_merch       numeric(12,2) := 0;
  v_total       numeric(12,2);
  v_customer    uuid;
  v_email       text;
  v_first       text;
  v_last        text;
  v_phone       text;
  v_ship_addr   jsonb;
  v_bill_addr   jsonb;
  v_opt_in      boolean;
  v_method      text;
  v_label       text;
  v_has_addr    boolean;
  v_location    uuid;
  v_take        int;
  v_level       record;
  v_order       uuid;
  v_number      int;
  v_token       text;
  v_session     text;
  v_existing orders%rowtype;
  v_cod jsonb;
begin
  -- ---- Inputs -------------------------------------------------------------
  v_email     := lower(nullif(btrim(payload->>'email'), ''));
  v_first     := coalesce(btrim(payload->>'first_name'), '');
  v_last      := coalesce(btrim(payload->>'last_name'), '');
  v_phone     := coalesce(btrim(payload->>'phone'), '');
  v_ship_addr := coalesce(payload->'shipping_address', '{}'::jsonb);
  v_bill_addr := coalesce(payload->'billing_address', '{}'::jsonb);
  v_opt_in    := coalesce((payload->>'marketing_opt_in')::boolean, false);
  v_code      := nullif(btrim(payload->>'discount_code'), '');
  v_session   := nullif(btrim(payload->>'session_key'), '');
  v_label     := left(coalesce(nullif(btrim(payload->>'address_label'), ''), 'Home'), 24);

  -- Defaulted rather than required, so the admin's own callers and anything
  -- predating this migration keep working: an order with no stated method is
  -- one the courier collects for, which is what this store did before today.
  v_method    := lower(coalesce(nullif(btrim(payload->>'payment_method'), ''), 'cod'));

  -- 'upi' is retained for the reason given in the header: it was the storefront's
  -- prepaid value before 0022 renamed it, and it prices identically below.
  if v_method not in ('cod', 'upi', 'prepaid') then
    raise exception 'Choose a payment method.' using errcode = 'HZ001';
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = 'HZ001';
  end if;

  if v_phone = '' then
    raise exception 'Enter a phone number.' using errcode = 'HZ001';
  end if;

  if coalesce(v_ship_addr->>'address1', '') = ''
     or coalesce(v_ship_addr->>'city', '') = ''
     or coalesce(v_ship_addr->>'province', '') = ''
     or coalesce(v_ship_addr->>'postal_code', '') = ''
     or coalesce(v_ship_addr->>'country', '') = '' then
    raise exception 'Enter a complete delivery address.' using errcode = 'HZ001';
  end if;

  -- Serialize repeats even after the original cart has been deleted.
  perform pg_advisory_xact_lock(hashtextextended('checkout:' || coalesce(payload->>'cart_token',''),0));
  select * into v_existing from orders where checkout_cart_key=md5(payload->>'cart_token');
  if found then
    return jsonb_build_object('order_id',v_existing.id,'order_number',v_existing.order_number,
      'checkout_token',v_existing.checkout_token,'total',v_existing.total);
  end if;
  -- Guest checkouts sharing an email must not race the unique customer insert.
  perform pg_advisory_xact_lock(hashtextextended('checkout-email:' || v_email,0));

  -- ---- The cart -----------------------------------------------------------
  -- Locked for the duration. Two tabs submitting the same cart serialise here,
  -- and the second one finds the cart already deleted by the first rather than
  -- placing a duplicate order.
  select * into v_cart from carts
   where token = payload->>'cart_token'
   for update;

  if v_cart.id is null then
    raise exception 'Your bag has expired. Add your items again to continue.'
      using errcode = 'HZ001';
  end if;

  -- Default location, used for the stock decrement below.
  select id into v_location from locations where is_default order by created_at limit 1;

  select coalesce(checkout, '{}'::jsonb), currency
    into v_settings, v_currency
    from shop_settings where id = 1;

  v_settings  := coalesce(v_settings, '{}'::jsonb);
  v_currency  := coalesce(v_currency, 'USD');
  v_flat      := coalesce((v_settings->>'flat_rate')::numeric, 0);
  v_threshold := nullif(v_settings->>'free_threshold', '')::numeric;
  v_tax_rate  := coalesce((v_settings->>'tax_rate')::numeric, 0);

  -- ---- The order shell ----------------------------------------------------
  -- Created before the lines so `order_items.order_id` has something to point
  -- at. Its totals are wrong until the bottom of this function, which is
  -- invisible: nothing outside this transaction can see the row until commit.
  --
  -- Two v4 uuids stripped of their dashes, rather than gen_random_bytes():
  -- pgcrypto is not guaranteed to be installed here, and gen_random_uuid() is
  -- core. 64 hex characters, ~244 bits of randomness.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into orders (
    is_draft, payment_status, fulfillment_status, currency, location_id,
    email, phone, shipping_address, billing_address,
    payment_method, checkout_token, source,
    marketing_opt_in, utm, referrer, landing_path, note
  ) values (
    false, 'pending', 'unfulfilled', v_currency, v_location,
    v_email, v_phone, v_ship_addr, v_bill_addr,
    v_method, v_token, 'storefront',
    v_opt_in,
    coalesce(payload->'utm', '{}'::jsonb),
    coalesce(payload->>'referrer', ''),
    coalesce(payload->>'landing_path', ''),
    coalesce(payload->>'note', '')
  )
  returning id, order_number into v_order, v_number;

  -- ---- Lines --------------------------------------------------------------
  for v_line in
    select ci.product_id,
           ci.variant_id,
           ci.quantity,
           p.title            as p_title,
           p.status           as p_status,
           p.price            as p_price,
           p.track_inventory  as p_track,
           p.continue_selling as p_oversell,
           v.id               as v_id,
           v.title            as v_title,
           v.price            as v_price,
           v.available        as v_available,
           v.track_inventory  as v_track,
           v.continue_selling as v_oversell
      from cart_items ci
      join products p on p.id = ci.product_id
      left join product_variants v on v.id = ci.variant_id
     where ci.cart_id = v_cart.id
     order by ci.product_id, ci.variant_id nulls first, ci.id
  loop
    if v_line.p_status <> 'active' then
      raise exception '% is no longer available.', v_line.p_title
        using errcode = 'HZ001';
    end if;

    -- The line names a variant the product no longer has.
    if v_line.variant_id is not null and v_line.v_id is null then
      raise exception '% is no longer available in that option.', v_line.p_title
        using errcode = 'HZ001';
    end if;

    -- Lock this line's inventory rows before reading them, so two shoppers
    -- racing for the last unit serialise instead of both being told yes.
    -- `is not distinct from` because a simple product's level row carries a
    -- null variant_id, and `= null` would match nothing.
    perform 1 from inventory_levels il
     where il.product_id = v_line.product_id
       and il.variant_id is not distinct from v_line.variant_id
     order by il.id
     for update;

    select coalesce(sum(il.quantity), 0) into v_stock
      from inventory_levels il
     where il.product_id = v_line.product_id
       and il.variant_id is not distinct from v_line.variant_id;

    -- Transcribed from attachStock() in src/lib/shop/queries.ts — see header.
    v_untracked := (not v_line.p_track) or v_line.p_oversell;

    if v_line.v_id is not null then
      v_unlimited := v_untracked or (not v_line.v_track) or v_line.v_oversell;

      -- The operator's per-variant switch outranks stock in both directions.
      if not v_line.v_available then
        raise exception '% (%) is sold out.', v_line.p_title, v_line.v_title
          using errcode = 'HZ001';
      end if;

      if (not v_unlimited) and v_stock < v_line.quantity then
        raise exception 'Only % left of % (%).', greatest(v_stock, 0),
          v_line.p_title, v_line.v_title using errcode = 'HZ001';
      end if;

      v_price := v_line.v_price;
    else
      v_unlimited := v_untracked;

      if (not v_unlimited) and v_stock < v_line.quantity then
        raise exception 'Only % left of %.', greatest(v_stock, 0), v_line.p_title
          using errcode = 'HZ001';
      end if;

      v_price := v_line.p_price;
    end if;

    insert into order_items (
      order_id, product_id, variant_id,
      title_snapshot, variant_snapshot, price_snapshot, quantity
    ) values (
      v_order, v_line.product_id, v_line.v_id,
      v_line.p_title, coalesce(v_line.v_title, ''), v_price, v_line.quantity
    );

    v_subtotal := v_subtotal + (v_price * v_line.quantity);
    v_lines    := v_lines + 1;

    -- ---- Stock ------------------------------------------------------------
    -- Untracked and oversellable lines have no counter to move.
    if not v_unlimited then
      v_take := v_line.quantity;

      -- Default location first, then anything else holding stock. The admin's
      -- adjustStock() only ever touches the default location, which is the
      -- known defect at item 2 of the build order in docs/SHOPIFY_GAP.md; this
      -- spills rather than silently failing to decrement when the default
      -- location does not stock the item. When that item is fixed, both paths
      -- should end up on the same routing helper.
      for v_level in
        select il.id, il.quantity
          from inventory_levels il
         where il.product_id = v_line.product_id
           and il.variant_id is not distinct from v_line.variant_id
           and il.quantity > 0
         order by (il.location_id = v_location) desc, il.quantity desc
      loop
        exit when v_take <= 0;
        update inventory_levels
           set quantity = quantity - least(v_take, v_level.quantity)
         where id = v_level.id;
        insert into checkout_stock_allocations(order_id,inventory_id,quantity)
        values (v_order,v_level.id,least(v_take,v_level.quantity));
        v_take := v_take - least(v_take, v_level.quantity);
      end loop;
    end if;
  end loop;

  if v_lines = 0 then
    raise exception 'Your bag is empty.' using errcode = 'HZ001';
  end if;

  -- ---- Discount -----------------------------------------------------------
  -- The same rules createOrder() applies in the admin, plus free_shipping,
  -- which only became meaningful once an order had a shipping total.
  if v_code is not null then
    select * into v_disc from discounts where lower(code) = lower(v_code) limit 1 for update;

    if v_disc.id is null
       or v_disc.status <> 'active'
       or v_disc.starts_at > now()
       or (v_disc.ends_at is not null and v_disc.ends_at <= now())
       or (v_disc.usage_limit is not null and v_disc.used_count >= v_disc.usage_limit)
       or (v_disc.min_purchase is not null and v_subtotal < v_disc.min_purchase) then
      raise exception 'That discount code is not valid for this order.'
        using errcode = 'HZ001';
    end if;

    case v_disc.type
      when 'percentage'    then v_discount := round(v_subtotal * v_disc.value / 100, 2);
      when 'fixed'         then v_discount := least(v_disc.value, v_subtotal);
      when 'free_shipping' then v_free_ship := true;
      else
        -- bxgy needs per-line logic that does not exist yet anywhere in the
        -- codebase. Refusing is honest; applying nothing would charge full
        -- price against a code the shopper watched be accepted.
        raise exception 'That discount code is not supported at checkout yet.'
          using errcode = 'HZ001';
    end case;

    update discounts set used_count = used_count + 1 where id = v_disc.id;
    v_code := v_disc.code;
  end if;

  -- ---- Money --------------------------------------------------------------
  -- Transcribed from quoteTotals() in src/lib/shop/checkout-totals.ts, which is
  -- what the shopper watched while filling the form in. Same order, same
  -- rounding — see the header on why that has to hold.
  v_merch := greatest(v_subtotal - v_discount, 0);

  -- Shipping is settled against the merchandise total *before* the prepaid
  -- saving, so choosing to pay online can never drop an order back under the
  -- free-shipping bar and charge for the privilege of saving the store money.
  if not v_free_ship then
    v_shipping := v_flat;
    if v_threshold is not null and v_merch >= v_threshold then
      v_shipping := 0;
    end if;
  end if;

  -- The payment method, priced. 5% off the discounted merchandise total for
  -- paying up front — not off shipping or the fee below, neither of which is
  -- the store's margin to give away — and a flat 49 when the courier has to
  -- collect. Exactly one of the two is ever non-zero.
  if v_method in ('prepaid', 'upi') then
    v_prepaid_off := round(v_merch * 0.05, 2);
  else
    v_cod_fee := 49;
  end if;

  -- Tax on what is left of the merchandise: the prepaid saving is taxable value
  -- the store gave up, so it comes off the base. Shipping and the COD fee are
  -- both left out — whether either is taxable is a jurisdiction question, and
  -- answering it wrongly here would be worse than leaving it to the zones work.
  v_tax   := round(greatest(v_merch - v_prepaid_off, 0) * v_tax_rate, 2);
  v_total := greatest(v_merch - v_prepaid_off, 0) + v_shipping + v_tax + v_cod_fee;

  -- ---- Customer -----------------------------------------------------------
  -- Derived from the cart or the email, never from the payload: a customer_id
  -- the browser could name is a customer_id the browser could swap.
  v_customer := v_cart.customer_id;

  if v_customer is null then
    select id into v_customer from customers where lower(email) = v_email;
  end if;

  if v_customer is null then
    insert into customers (first_name, last_name, email, phone, accepts_marketing)
    values (v_first, v_last, v_email, nullif(v_phone, ''), v_opt_in)
    returning id into v_customer;
  else
    -- Fill blanks only. A shopper typing a shipping name at checkout must not
    -- overwrite what the operator curated on the customer record.
    update customers set
      first_name = case when first_name = '' then v_first else first_name end,
      last_name  = case when last_name  = '' then v_last  else last_name  end,
      phone      = coalesce(nullif(phone, ''), nullif(v_phone, '')),
      default_address = case
        when default_address = '{}'::jsonb then v_ship_addr else default_address end
    where id = v_customer;
  end if;

  -- Consent is only ever granted here, never revoked: an unticked box at
  -- checkout is the absence of a new opt-in, not a withdrawal of an old one.
  -- Unsubscribing is its own deliberate act and belongs to its own surface.
  if v_opt_in then
    update customers set
      accepts_marketing       = true,
      marketing_opt_in_at     = coalesce(marketing_opt_in_at, now()),
      marketing_opt_in_source = coalesce(marketing_opt_in_source, 'checkout')
    where id = v_customer;
  end if;

  -- ---- Address book -------------------------------------------------------
  -- Saved as a side effect of ordering rather than behind a "save this address"
  -- tick, because the tick is the step everyone skips and then pays for on
  -- their next order. Nothing here can fail the checkout: the unique index
  -- makes a repeat address an update, and there is no path that raises.
  select exists (select 1 from customer_addresses where customer_id = v_customer)
    into v_has_addr;

  insert into customer_addresses (
    customer_id, label, first_name, last_name, phone,
    address1, address2, city, province, postal_code, country, is_default
  ) values (
    v_customer, v_label, v_first, v_last, v_phone,
    coalesce(v_ship_addr->>'address1', ''),
    coalesce(v_ship_addr->>'address2', ''),
    coalesce(v_ship_addr->>'city', ''),
    coalesce(v_ship_addr->>'province', ''),
    coalesce(v_ship_addr->>'postal_code', ''),
    coalesce(v_ship_addr->>'country', ''),
    -- The first address a customer ever saves is their default. Later ones are
    -- not promoted automatically: the shopper chose this one for this order,
    -- which is not the same as saying it should be the standing answer.
    not v_has_addr
  )
  on conflict (customer_id, fingerprint) do update set
    -- Ordering to a known address again refreshes the parts that legitimately
    -- change — who is receiving it and on what number — and re-labels it,
    -- since the shopper just told us what they call this place. The address
    -- itself is what the fingerprint matched on, so there is nothing to move.
    label      = excluded.label,
    first_name = excluded.first_name,
    last_name  = excluded.last_name,
    phone      = excluded.phone,
    updated_at = now();

  -- ---- Settle the order ---------------------------------------------------
  update orders set
    customer_id    = v_customer,
    subtotal       = v_subtotal,
    discount_total = v_discount,
    discount_code  = v_code,
    shipping_total = v_shipping,
    tax_total      = v_tax,
    cod_fee        = v_cod_fee,
    prepaid_discount = v_prepaid_off,
    total          = v_total,
    checkout_cart_key = md5(payload->>'cart_token'),
    reservation_expires_at = case when v_method in ('upi','prepaid') then now()+interval '45 minutes' end
  where id = v_order;

  -- ---- Attribution --------------------------------------------------------
  -- Closes the loop 0007 left open: analytics_sessions.order_id has existed
  -- since the analytics migration and nothing has ever written it.
  if v_session is not null then
    update analytics_sessions set
      order_id     = v_order,
      purchased_at = now()
    where session_key = v_session;
  end if;

  -- COD review decisions and downstream work belong to the checkout commit.
  if v_method='cod' then
    select coalesce(cod,'{}') into v_cod from shop_settings where id=1;
    if coalesce((v_cod->>'hold_enabled')::boolean,false)
      and (nullif(v_cod->>'hold_min_total','') is null or v_total >= (v_cod->>'hold_min_total')::numeric) then
      update orders set held_at=now(),hold_reason='cod_review' where id=v_order;
    end if;
    insert into commerce_jobs(job_key,kind,order_id) values ('fulfill:'||v_order,'fulfill',v_order);
  else
    insert into commerce_jobs(job_key,kind,order_id,available_at)
    values ('expire:'||v_order,'expire',v_order,now()+interval '45 minutes');
  end if;

  -- ---- Done ---------------------------------------------------------------
  -- Cascades to cart_items. The cart is finished; keeping it would leave the
  -- shopper's next visit holding items they have already paid for.
  delete from carts where id = v_cart.id;

  return jsonb_build_object(
    'order_id',       v_order,
    'order_number',   v_number,
    'checkout_token', v_token,
    'total',          v_total
  );
end;
$$;
