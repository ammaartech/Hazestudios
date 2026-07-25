-- Checkout: turning a cart into an order.
--
-- ===========================================================================
-- WHY ONE POSTGRES FUNCTION AND NOT A SEQUENCE OF SERVER-ACTION WRITES
-- ===========================================================================
-- Placing an order is seven writes that have to land together or not at all:
-- the order row, its line items, the inventory decrements, the discount's
-- usage counter, the customer record, the cart deletion, and the attribution
-- stamp. Done from a server action that is seven PostgREST round trips, and
-- every gap between them is a state the store can get stuck in — stock taken
-- for an order that was never created, a cart emptied for an order that
-- failed, a discount counted twice because the shopper double-clicked.
--
-- A plpgsql function is one transaction. Either the shopper has an order or
-- the database is exactly as it was. This is the same reasoning that put
-- product saves behind save_product() in 0005, and it matters more here:
-- a half-saved product is an operator's afternoon, a half-placed order is
-- someone's money.
--
-- ===========================================================================
-- WHY THE PRICES ARE RE-RESOLVED HERE
-- ===========================================================================
-- 0011 made cart lines carry references and a quantity and nothing else, so
-- that a returning shopper sees today's catalogue. The other half of that
-- decision lives here: this function reads price, title and stock from
-- `products`/`product_variants` at the moment of purchase and snapshots those
-- into `order_items`. Nothing the browser sent is priced, and nothing the cart
-- displayed is trusted — the summary the shopper saw was rendered from the
-- same tables microseconds earlier, so agreeing is the normal case, but the
-- authority is here.
--
-- The availability rules are a deliberate transcription of `attachStock()` in
-- src/lib/shop/queries.ts. If the two ever disagree, the storefront will offer
-- something checkout refuses, so they must be changed together.
--
-- ===========================================================================
-- WHY THERE IS NO ANON POLICY FOR THE ORDER STATUS PAGE
-- ===========================================================================
-- A guest's confirmation page is reached with `orders.checkout_token`, which
-- is a bearer credential in a URL, and RLS cannot read a URL any more than it
-- could read 0011's cart cookie. So the precedent 0011 set holds: no anon
-- policy, and the storefront reads the order through the service role after
-- checking the token itself.

-- ---------------------------------------------------------------------------
-- 1. Order fields checkout needs
-- ---------------------------------------------------------------------------
-- An order created before this migration had no address, no email and no way
-- to describe shipping or tax — it could only ever have come from the admin,
-- where a staff member knew who the customer was. A storefront order has to
-- carry its own context.
alter table orders
  -- The contact identity for this order. Denormalised rather than read through
  -- customer_id, because an order is a contract: it must still say where it was
  -- going after the customer edits their profile or the record is erased.
  add column if not exists email             text not null default '',
  add column if not exists phone             text not null default '',
  add column if not exists shipping_address  jsonb not null default '{}'::jsonb,
  -- Empty means "same as shipping". Storing the copy instead would be more
  -- uniform, but then nothing records that the shopper never gave a separate
  -- billing address, which is what a payment gateway will eventually ask.
  add column if not exists billing_address   jsonb not null default '{}'::jsonb,
  add column if not exists shipping_total    numeric(12,2) not null default 0,
  add column if not exists tax_total         numeric(12,2) not null default 0,
  -- 'manual' until a gateway exists. Named now because every order placed
  -- before that point still needs to be distinguishable from the ones after.
  add column if not exists payment_method    text not null default 'manual',
  -- Bearer token for the order status page. Null on admin-created orders,
  -- which are reached through the admin instead.
  add column if not exists checkout_token    text,
  -- Where the order came from. Not a sales_channels foreign key: that entity
  -- is a later piece of work (see docs/SHOPIFY_GAP.md §7) and guessing its
  -- shape now would mean migrating this column twice.
  add column if not exists source            text not null default 'admin';

-- Marketing capture. These live on the order and not only on the customer
-- because consent and attribution are facts about a moment: "this person opted
-- in at this purchase, arriving from this campaign". Rolling them up onto the
-- customer row would answer "are they subscribed" and lose "what worked".
alter table orders
  add column if not exists marketing_opt_in  boolean not null default false,
  -- { source, medium, campaign, term, content } — whichever were present.
  add column if not exists utm               jsonb not null default '{}'::jsonb,
  add column if not exists referrer          text not null default '',
  add column if not exists landing_path      text not null default '';

-- A token is only a credential if it cannot collide.
create unique index if not exists orders_checkout_token_key
  on orders (checkout_token) where checkout_token is not null;

-- Order search by email is the single most common support lookup, and today
-- src/app/(admin)/admin/orders/page.tsx can only match an order number.
create index if not exists orders_email_idx on orders (lower(email))
  where email <> '';

comment on column orders.checkout_token is
  'Bearer token for the guest order status page. Read through the service role after the caller presents it; never exposed by an RLS policy.';
comment on column orders.utm is
  'Campaign attribution snapshotted at purchase. Durable on purpose: analytics_sessions is pruned at 400 days, an order is history.';

-- ---------------------------------------------------------------------------
-- 2. Marketing consent provenance on the customer
-- ---------------------------------------------------------------------------
-- `customers.accepts_marketing` already existed as a bare boolean, which is
-- enough to decide whether to send and not enough to defend the decision. A
-- consent record that cannot say when it was given or where it came from is
-- the one thing a privacy request will ask for.
--
-- Deliberately additive rather than the jsonb split docs/SHOPIFY_GAP.md §9
-- proposes: `accepts_marketing` stays the column everything reads, so the
-- admin's customer form keeps working untouched.
alter table customers
  add column if not exists marketing_opt_in_at     timestamptz,
  add column if not exists marketing_opt_in_source text;

comment on column customers.marketing_opt_in_at is
  'When consent was first given. Never cleared by a later unticked box — withdrawal is an explicit act, not the absence of one.';

-- ---------------------------------------------------------------------------
-- 3. Shipping and tax settings
-- ---------------------------------------------------------------------------
-- Real shipping is zones, rates and profiles (docs/SHOPIFY_GAP.md §2), which is
-- its own migration. Checkout cannot wait for it — an order needs *a* shipping
-- total — so this is the smallest honest stand-in: one flat rate, one free
-- threshold, one tax rate. Grouped as jsonb to match `brand` and `policies`
-- rather than adding three loose columns that a zones table would then orphan.
--
-- Defaults are zero: a store that has not configured shipping charges nothing,
-- which is wrong in a way the operator can see, rather than wrong in a way the
-- shopper pays for.
alter table shop_settings
  add column if not exists checkout jsonb not null default
    '{"flat_rate": 0, "free_threshold": null, "tax_rate": 0}'::jsonb;

comment on column shop_settings.checkout is
  'Interim shipping/tax config: { flat_rate, free_threshold, tax_rate }. Superseded by shipping_zones when that lands.';

-- ---------------------------------------------------------------------------
-- 4. Campaign attribution on sessions
-- ---------------------------------------------------------------------------
-- 0007 already captures referrer, landing path, geo and device, and already
-- has `order_id`, `checkout_started_at` and `purchased_at` waiting to be
-- written. The one thing missing for attribution is the campaign itself, which
-- arrives as query parameters on the landing URL.
alter table analytics_sessions
  add column if not exists utm jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 5. place_order()
-- ---------------------------------------------------------------------------
-- Expected, shopper-visible failures are raised with SQLSTATE 'HZ001' and a
-- message written to be shown as-is. Anything else that escapes is a fault,
-- and the caller shows a generic message instead of leaking database text.
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
  v_total       numeric(12,2);
  v_customer    uuid;
  v_email       text;
  v_first       text;
  v_last        text;
  v_phone       text;
  v_ship_addr   jsonb;
  v_bill_addr   jsonb;
  v_opt_in      boolean;
  v_location    uuid;
  v_take        int;
  v_level       record;
  v_order       uuid;
  v_number      int;
  v_token       text;
  v_session     text;
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

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = 'HZ001';
  end if;

  if coalesce(v_ship_addr->>'address1', '') = ''
     or coalesce(v_ship_addr->>'city', '') = ''
     or coalesce(v_ship_addr->>'country', '') = '' then
    raise exception 'Enter a complete delivery address.' using errcode = 'HZ001';
  end if;

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
    'manual', v_token, 'storefront',
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
     order by ci.created_at
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
    select * into v_disc from discounts where lower(code) = lower(v_code) limit 1;

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
  if not v_free_ship then
    v_shipping := v_flat;
    if v_threshold is not null and (v_subtotal - v_discount) >= v_threshold then
      v_shipping := 0;
    end if;
  end if;

  -- Tax on the discounted merchandise total. Shipping is left out: whether it
  -- is taxable is a jurisdiction question, and answering it wrongly here would
  -- be worse than leaving it to the zones work.
  v_tax   := round(greatest(v_subtotal - v_discount, 0) * v_tax_rate, 2);
  v_total := greatest(v_subtotal - v_discount, 0) + v_shipping + v_tax;

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

  -- ---- Settle the order ---------------------------------------------------
  update orders set
    customer_id    = v_customer,
    subtotal       = v_subtotal,
    discount_total = v_discount,
    discount_code  = v_code,
    shipping_total = v_shipping,
    tax_total      = v_tax,
    total          = v_total
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

-- The storefront calls this through the service-role client, exactly as it
-- calls every other cart operation — the cart token in the payload is the
-- credential, and anon must not be able to present one it guessed.
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to service_role;

comment on function public.place_order(jsonb) is
  'Atomically converts a cart into an order: re-resolves prices, checks and decrements stock, applies a discount, upserts the customer, stamps attribution and deletes the cart. Expected failures raise SQLSTATE HZ001 with a shopper-safe message.';
