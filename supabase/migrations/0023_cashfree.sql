-- Cashfree payment gateway.
--
-- ===========================================================================
-- WHY A payments TABLE AND NOT JUST orders.payment_status
-- ===========================================================================
-- Until now `payment_status` was the store's entire record of money: one enum
-- on the order, flipped by hand from the admin. That was honest while every
-- order was COD, because there was nothing else to know — the courier either
-- collected or did not.
--
-- A gateway makes it insufficient. `paid` cannot answer which of three attempts
-- succeeded, what the shopper paid with, why the first two failed, or what id
-- to quote Cashfree when a customer says the money left their account and the
-- order says pending. Reconciliation is the whole job of these tables, and it
-- is a job of *attempts*, not of outcomes.
--
-- So: one row per attempt, never updated in place across attempts. A retry
-- writes a new row. The order keeps its single `payment_status` as the
-- settled truth, and this table is the evidence behind it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  provider           text not null default 'cashfree',

  -- The id we hand Cashfree as *their* `order_id`, and the reason this table
  -- can be joined back from a webhook that knows nothing about our uuids.
  --
  -- Unique and never reused, which is also Cashfree's own rule: an order id
  -- they have seen before is rejected. Retrying a payment therefore cannot
  -- reuse the order's number on its own — the attempt counter is what makes
  -- the second try a distinct id. Format is HZ<order_number>A<attempt>, kept
  -- alphanumeric and well inside their 3–45 character limit.
  provider_order_id  text not null unique,

  -- Cashfree's own identifiers. cf_order_id is theirs for the order;
  -- cf_payment_id identifies the individual transaction and is the number a
  -- customer's bank statement can be matched against, so it is the single most
  -- useful field here for support.
  cf_order_id        text,
  cf_payment_id      text,

  -- Handed to their JS SDK to open the checkout. Short-lived and useless to
  -- anyone else, but stored so a page reload can resume an attempt rather than
  -- minting a second one.
  payment_session_id text,

  -- Our view of the attempt.
  --   created      — session minted, shopper has not finished (or even started)
  --   pending      — Cashfree is still settling it; some methods are not instant
  --   success      — money captured
  --   failed       — declined
  --   user_dropped — closed the window without paying
  --   cancelled    — terminated by us or by them
  --   expired      — the 30-minute session lapsed
  status             text not null default 'created'
                       check (status in ('created', 'pending', 'success',
                                         'failed', 'user_dropped',
                                         'cancelled', 'expired')),

  -- What we asked Cashfree to charge, snapshotted from orders.total at the
  -- moment the session was minted. The webhook compares its own figure against
  -- this one and refuses to mark an order paid when they disagree, which is the
  -- only defence against a tampered amount that does not require trusting the
  -- caller.
  amount             numeric(12,2) not null,
  currency           text not null default 'INR',

  -- Cashfree's `payment_group`: upi, credit_card, net_banking, wallet…  Free
  -- text on their side, so not constrained here.
  method             text,

  -- Same reasoning as qikink_fulfillments (0016): the provider's failures are
  -- terse and arrive once. Without the exact request that produced an error, a
  -- mapping bug is a guess.
  request            jsonb not null default '{}'::jsonb,
  response           jsonb not null default '{}'::jsonb,
  error              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists payments_order_idx on payments (order_id);
create index if not exists payments_status_idx on payments (status);

alter table payments enable row level security;

-- Staff only, via the same helper every other admin table uses. Deliberately
-- not exposed to anon: the shopper's order page reads `orders` and is told
-- whether the order is paid, which is all it needs. A gateway's payment ids are
-- reconciliation data, and a token in a URL is not an authentication.
drop policy if exists payments_staff_all on payments;
create policy payments_staff_all on payments
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table payments is
  'One row per payment attempt against an order. Retries add rows rather than updating them; orders.payment_status remains the settled outcome.';

-- ---------------------------------------------------------------------------
-- payment_events
-- ---------------------------------------------------------------------------
-- Cashfree delivers webhooks **at least once** and retries until it gets a 200,
-- so the same success event will arrive twice sooner or later. Handling one
-- twice would be harmless for the order (the update is conditional) but not for
-- what follows it: a second push would try to put the same garment into
-- production again.
--
-- The unique constraint below *is* the deduplication. The handler inserts
-- first; a unique violation means another delivery already did the work, and
-- the correct response is 200 and nothing else. Doing it this way rather than
-- with a read-then-write check is deliberate — two deliveries can land on two
-- instances at the same moment, and only the database can arbitrate that.

create table if not exists payment_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null default 'cashfree',

  -- Cashfree's `x-idempotency-header` when present, falling back to
  -- '<type>:<cf_payment_id>' — which identifies the same event just as well,
  -- since a payment reaches each terminal state exactly once.
  idempotency_key text not null,

  event_type      text,
  payload         jsonb not null default '{}'::jsonb,
  received_at     timestamptz not null default now(),

  unique (provider, idempotency_key)
);

create index if not exists payment_events_received_idx
  on payment_events (received_at desc);

alter table payment_events enable row level security;

drop policy if exists payment_events_staff_all on payment_events;
create policy payment_events_staff_all on payment_events
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table payment_events is
  'Raw gateway webhooks, one row per delivered event. The unique (provider, idempotency_key) constraint is what makes at-least-once delivery safe to act on.';

-- ---------------------------------------------------------------------------
-- Nothing else changes
-- ---------------------------------------------------------------------------
-- place_order() is untouched: its allowlist has accepted 'prepaid' since 0022,
-- and `payment_status` has had 'paid' in its enum since 0001. A prepaid order
-- is still written as pending inside the same transaction as every other order;
-- all this migration adds is somewhere to record what happened next.
