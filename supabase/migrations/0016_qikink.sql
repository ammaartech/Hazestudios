-- Qikink print-on-demand fulfillment.
--
-- ===========================================================================
-- WHY A SEPARATE CREDENTIALS TABLE AND NOT shop_settings
-- ===========================================================================
-- 0003 gave shop_settings `for select to anon using (true)` — the whole row is
-- world-readable, deliberately, because the storefront header needs the store
-- name and currency before anyone logs in. RLS is row-level: there is no way to
-- add a column to that table that the public cannot read. An API secret stored
-- there would be served to every visitor.
--
-- So credentials get their own table, and it is locked harder than anything
-- else in this schema: RLS is enabled and **no policy is ever created on it**.
-- `anon` gets nothing, and so does `authenticated` — including staff. The only
-- thing that can read it is the service-role client, which bypasses RLS, and
-- that client only exists inside server actions. A leaked anon key, a stolen
-- staff session, or someone pointing PostgREST at the table directly all come
-- back empty rather than holding the key to the merchant's Qikink account.
--
-- The secret therefore never crosses the network to a browser. The settings UI
-- reads a boolean ("a secret is saved") and writes a new value; it never
-- renders the stored one.
-- ===========================================================================

create table if not exists integration_credentials (
  provider      text primary key,
  -- Which Qikink host to talk to. The ClientId is shared across both; the
  -- secret is not, so switching environments means re-entering it.
  environment   text not null default 'sandbox'
                  check (environment in ('sandbox', 'live')),
  client_id     text not null default '',
  client_secret text not null default '',
  -- Master switch. Off means the order page shows nothing and auto-send is
  -- inert, regardless of what else is configured.
  enabled       boolean not null default false,
  -- Push new orders as they are placed. Off by default: a SKU mapping mistake
  -- should be caught on one manual send, not discovered after fifty orders
  -- went into production.
  auto_send     boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table integration_credentials enable row level security;

comment on table integration_credentials is
  'API credentials for third-party integrations. RLS is enabled with NO policies by design — readable only by the service-role client inside server actions. Never add a policy here, and never select it with the anon or authenticated client.';

-- ---------------------------------------------------------------------------
-- Fulfillment linkage
-- ---------------------------------------------------------------------------
-- One row per order, created the first time it is pushed. Kept out of `orders`
-- because it is integration bookkeeping, not part of the order contract: an
-- order is still a valid order if Qikink never hears about it, and a failed
-- push must not leave a half-written order row behind.
--
-- `request` and `response` are kept because Qikink's failures are terse and
-- returned once. Without the exact payload that produced an error, a mapping
-- bug is a guess.

create table if not exists qikink_fulfillments (
  id              uuid primary key default gen_random_uuid(),
  -- Unique: an order is pushed once. A retry updates this row rather than
  -- creating a second one, which is also what stops a double-click becoming
  -- two production jobs.
  order_id        uuid not null unique references orders(id) on delete cascade,
  -- Qikink's id for the order, returned by /api/order/create.
  qikink_order_id text,
  -- Our view of the push: queued → sent, or failed.
  status          text not null default 'queued'
                    check (status in ('queued', 'sent', 'failed')),
  -- Qikink's own status string, refreshed from /api/order. Free text on their
  -- side ("Archived", "In Production", …) so it is not constrained here.
  qikink_status   text,
  awb             text,
  tracking_url    text,
  request         jsonb not null default '{}'::jsonb,
  response        jsonb not null default '{}'::jsonb,
  error           text,
  sent_at         timestamptz,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists qikink_fulfillments_status_idx
  on qikink_fulfillments (status);

alter table qikink_fulfillments enable row level security;

-- Staff only, via the same helper every other admin table uses. Not exposed to
-- anon: a shopper's order-status page reads `orders`, and surfacing which
-- supplier prints a garment is nobody's business but the merchant's.
drop policy if exists qikink_fulfillments_staff_all on qikink_fulfillments;
create policy qikink_fulfillments_staff_all on qikink_fulfillments
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table qikink_fulfillments is
  'Per-order Qikink push state: their order id, status, AWB and tracking, plus the exact request/response for diagnosing mapping failures.';
