-- Price the payment method into the order.
--
-- Two numbers, opposite directions, one purpose. Cash on delivery costs the
-- store a courier handling fee and a materially worse return rate, and until
-- now the store absorbed both; it now carries a flat 49 charge. Paying up front
-- takes 5% off the merchandise total. The gap between the two is the whole
-- point — a shopper comparing them should find prepaid obviously cheaper.
--
-- Both land in their own columns rather than being folded into shipping_total
-- and discount_total. A 49 "shipping" charge on an order with free shipping is
-- a line nobody can explain, and a prepaid saving mixed into discount_total
-- would be indistinguishable from a coupon in every report that reads it.
--
-- The constants are duplicated in src/lib/shop/payment-methods.ts, which is
-- what the summary quotes from while the shopper is still typing. They have to
-- agree to the paisa: this function is the authority, so a drift can only
-- correct downward at submission, but a shopper watching the total change under
-- them is a shopper who stops trusting the total.
--
-- 'prepaid' joins the allowlist. 'upi' stays in it — it is the value this
-- store's first prepaid orders would have carried, and dropping it from the
-- allowlist would fail a request that was legitimate when it was written.
--
-- Otherwise identical to 0021.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- Defaulted to zero, so every order placed before today reads as what it was:
-- no COD charge levied and no prepaid saving given.
alter table orders
  add column if not exists cod_fee          numeric(12,2) not null default 0,
  add column if not exists prepaid_discount numeric(12,2) not null default 0;

comment on column orders.cod_fee is
  'Flat cash-on-delivery handling charge added to the total. Zero on prepaid orders.';
comment on column orders.prepaid_discount is
  'Money taken off for paying up front, after any coupon. Zero on COD orders.';

-- ---------------------------------------------------------------------------
-- place_order(): charge for COD, discount for prepaid
-- ---------------------------------------------------------------------------
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
