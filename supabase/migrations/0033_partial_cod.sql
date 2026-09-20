-- Partial COD: an advance collected online against a cash-on-delivery order.
--
-- The single most expensive thing a COD order can do is come back. A small
-- prepayment — ₹99, ₹199, a fifth of the total — is the standard way Indian
-- D2C stores separate the shopper who wants the parcel from the one who will
-- refuse it at the door. This migration gives the store three things:
--
--   1. A way to *hold* a risky COD order before it is pushed to Qikink, because
--      Qikink's Open API can create and read an order but never change one.
--      Once the printer has it as full-value COD, the collectable amount is
--      fixed. So the hold has to come first, and the push after the decision.
--   2. A `payment_requests` row for each advance the store asks for — amount,
--      deadline, who asked, what happened. One open request per order, and the
--      history kept when it expires or is withdrawn.
--   3. `orders.amount_paid`, the money actually captured online, so the balance
--      the courier collects is `total - amount_paid` and `map.ts` can say so.
--
-- Payment itself rides on the existing Cashfree pipeline: a `payments` attempt
-- now carries `request_id`, and `settle_payment_request()` is what the settle
-- path calls instead of flipping the order to paid outright.

-- ---------------------------------------------------------------------------
-- 1. orders: money captured, and the review hold
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists amount_paid numeric(12,2) not null default 0
    check (amount_paid >= 0),
  -- Set when checkout decides this COD order needs a look before it ships;
  -- cleared (released_at) when staff approve it or the advance lands. Both are
  -- kept rather than a boolean so the page can say how long it sat.
  add column if not exists held_at     timestamptz,
  add column if not exists hold_reason text,
  add column if not exists released_at timestamptz;

comment on column orders.amount_paid is
  'Money captured online against this order so far. For a COD order this is the advance; the courier collects total - amount_paid.';
comment on column orders.held_at is
  'When this order was parked for review instead of being sent to fulfilment. On hold while released_at is null.';

-- The "Needs review" list: small, and only ever the currently-held rows.
create index if not exists orders_on_hold_idx
  on orders (held_at desc)
  where held_at is not null and released_at is null;

-- ---------------------------------------------------------------------------
-- 2. payment_requests
-- ---------------------------------------------------------------------------
create table if not exists payment_requests (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,

  -- What the money is for. Only one kind today; the column exists so a later
  -- "collect the balance online" or "extra shipping charge" reuses the table.
  kind             text not null default 'cod_advance'
                     check (kind in ('cod_advance')),

  amount           numeric(12,2) not null check (amount > 0),
  currency         text not null default 'INR',

  --   open      — waiting on the shopper
  --   paid      — money captured; payment_id says which attempt
  --   expired   — past expires_at without payment (set lazily, on first touch)
  --   cancelled — withdrawn by staff, or superseded by a decision on the order
  status           text not null default 'open'
                     check (status in ('open', 'paid', 'expired', 'cancelled')),

  -- Shown to the shopper on the order page, so it is written for them.
  reason           text,
  expires_at       timestamptz not null,

  -- Same shape as order_notes: the author's email is stamped at write time
  -- because auth.users is not readable from the session client.
  created_by       uuid references auth.users(id) on delete set null,
  created_by_email text,

  paid_at          timestamptz,
  payment_id       uuid references payments(id) on delete set null,
  resolved_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists payment_requests_order_idx
  on payment_requests (order_id, created_at desc);

-- One live ask at a time. Two open requests for different amounts would leave
-- the shopper choosing which sentence on the page to believe.
create unique index if not exists payment_requests_one_open_idx
  on payment_requests (order_id)
  where status = 'open';

alter table payment_requests enable row level security;

-- Staff only, exactly like `payments`. The shopper's order page reads these
-- through the service role behind its bearer token; anon sees nothing.
drop policy if exists payment_requests_staff_all on payment_requests;
create policy payment_requests_staff_all on payment_requests
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

comment on table payment_requests is
  'An amount the store has asked a shopper to pay online against an existing order — today, the advance on a cash-on-delivery order.';

-- ---------------------------------------------------------------------------
-- 3. payments: which request an attempt is paying
-- ---------------------------------------------------------------------------
-- Null means what it always meant — the attempt is for the whole order. Set,
-- it means the attempt is for `payment_requests.amount`, and settling it
-- credits the order rather than closing it.
alter table payments
  add column if not exists request_id uuid references payment_requests(id) on delete set null;

create index if not exists payments_request_idx
  on payments (request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- 4. shop_settings.cod — the hold rule and the request defaults
-- ---------------------------------------------------------------------------
-- A sibling of `checkout` rather than more keys inside it: `getCheckoutSettings`
-- and `quoteTotals` read that object on every cart render, and nothing here
-- belongs anywhere near a price calculation. Shape (all optional):
--   hold_enabled    boolean   park COD orders for review before fulfilment
--   hold_min_total  number    …only when total >= this; null/absent = every one
--   presets         number[]  quick-pick advance amounts on the request dialog
--   percent         number    the "% of total" quick pick
--   expiry_hours    number    default validity of a request
--   message         text      WhatsApp/share template; {name} {order} {amount}
--                             {balance} {link} {expires}
alter table shop_settings
  add column if not exists cod jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cod) = 'object');

-- ---------------------------------------------------------------------------
-- 5. settle_payment_request — the one place an advance becomes truth
-- ---------------------------------------------------------------------------
-- The advance counterpart of the conditional `update orders set payment_status
-- = 'paid' where payment_status = 'pending'` in settlePayment(). Three writes
-- that must land together: the request is paid, the order is credited, and the
-- hold is released. Idempotent on the request's status: the webhook and the
-- shopper's own reconcile both arrive, in either order, more than once.
--
-- Deliberately credits the order even when the request is no longer 'open'
-- (expired, or withdrawn by staff while the shopper had the window up). The
-- money is real either way; recording it is the only honest option, and the
-- order page can then say that an advance arrived after the decision was made.
--
-- Returns true only on the call that did the work.
create or replace function public.settle_payment_request(
  p_request_id uuid,
  p_payment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    payment_requests%rowtype;
  v_total  numeric(12,2);
  v_paid   numeric(12,2);
begin
  -- Lock the request; a concurrent settle waits here and then sees 'paid'.
  select * into v_req
  from payment_requests
  where id = p_request_id
  for update;

  if not found then
    return false;
  end if;

  if v_req.status = 'paid' then
    return false;
  end if;

  update payment_requests
  set status      = 'paid',
      paid_at     = now(),
      payment_id  = p_payment_id,
      resolved_at = now(),
      updated_at  = now()
  where id = p_request_id;

  select total, amount_paid + v_req.amount
    into v_total, v_paid
  from orders
  where id = v_req.order_id
  for update;

  update orders
  set amount_paid    = v_paid,
      -- A paid or refunded order is left alone: this can only happen if money
      -- arrived for an order the operator had already closed by hand, and the
      -- amount_paid credit above is the record of it.
      payment_status = case
        when payment_status in ('pending', 'partially_paid')
          then (case when v_paid >= v_total then 'paid' else 'partially_paid' end)::payment_status
        else payment_status
      end,
      released_at    = coalesce(released_at, case when held_at is not null then now() else null end)
  where id = v_req.order_id;

  return true;
end;
$$;

-- Service role only. The webhook and the reconcile both run on it; nothing on
-- the session side has any business settling money.
revoke all on function public.settle_payment_request(uuid, uuid) from public;
revoke all on function public.settle_payment_request(uuid, uuid) from anon, authenticated;
grant execute on function public.settle_payment_request(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. admin_order_detail: the requests and attempts, in the same round trip
-- ---------------------------------------------------------------------------
-- Re-created from 0032 with two more arrays. `to_jsonb(o)` already carries the
-- new orders columns, so the page needs no second query for the hold.
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
    'payment_requests', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from payment_requests q where q.order_id = o.id
    ), '[]'::jsonb),
    -- Attempts, without the request/response blobs: they are diagnostic, they
    -- are large, and the page only needs status, amount, method and ids.
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'request_id', p.request_id, 'provider', p.provider,
          'provider_order_id', p.provider_order_id, 'cf_payment_id', p.cf_payment_id,
          'status', p.status, 'amount', p.amount, 'currency', p.currency,
          'method', p.method, 'error', p.error, 'created_at', p.created_at
        )
        order by p.created_at desc
      )
      from payments p where p.order_id = o.id
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
