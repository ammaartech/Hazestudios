-- Courier shipping: Shree Maruti (InnoFulfill / SMILE) and Blue Dart.
--
-- ===========================================================================
-- WHAT THIS IS FOR
-- ===========================================================================
-- Qikink prints *and* ships, so an order sent there needs nothing else from
-- the merchant. Everything Qikink does not make — stock held here, one-offs,
-- replacements — is packed by hand and has, until now, meant opening a courier
-- website and retyping the address, the phone number, the amount to collect
-- and the parcel weight for every single parcel.
--
-- This migration gives the order page a "Ship now" button instead: pick a
-- courier and a service, confirm the parcel, and the booking is made over the
-- courier's API with the AWB written back to the order. The tables below are
-- that button's memory.
--
-- ===========================================================================
-- CREDENTIALS: SAME TABLE, TWO MORE COLUMNS
-- ===========================================================================
-- `integration_credentials` (0016) has exactly the property a courier key
-- needs — RLS on, no policies, readable only by the service-role client — so
-- both couriers live there as their own `provider` rows. Two things the table
-- did not have:
--
--   * A second secret. Blue Dart authenticates twice over: a consumer key and
--     secret mint the JWT, and then a *licence key* rides inside every payload.
--     Shree Maruti signs its webhooks with a key that is not the API key. One
--     `client_secret` column is not enough, and packing two secrets into one
--     string is how they end up logged together.
--   * Non-secret configuration that is still provider-specific: Blue Dart's
--     login id, customer code and origin area; Shree Maruti's tenant and user
--     ids; which service is the default. A jsonb column rather than six
--     nullable ones that mean something different per row.
--
-- Both columns inherit the table's RLS, so `settings` is not readable from a
-- browser either — which is fine, since the settings page reads a redacted
-- projection through a Server Action like it always has.

alter table integration_credentials
  add column if not exists extra_secret text  not null default '',
  add column if not exists settings     jsonb not null default '{}'::jsonb;

comment on column integration_credentials.extra_secret is
  'A provider''s second secret: Blue Dart''s licence key, Shree Maruti''s webhook signing key. Same rules as client_secret — never selected by the anon or authenticated client.';
comment on column integration_credentials.settings is
  'Provider-specific, non-secret configuration (login id, customer code, origin area, tenant id, default service). Read only through the service-role client.';

-- ---------------------------------------------------------------------------
-- courier_settings — where parcels ship from
-- ---------------------------------------------------------------------------
-- The pickup address, the return (RTO) address, and the parcel defaults the
-- "Ship now" dialog pre-fills. One row, ever, which is what the boolean
-- primary key with a check on it enforces: `id` can only be true, and there
-- is only one true.
--
-- Not in `shop_settings`, deliberately. 0003 made that row world-readable so
-- the storefront can show the store name before anyone logs in; a warehouse
-- address and a pickup phone number are not something to serve to every
-- visitor. Not in `locations` either: that table holds a city and a country
-- for inventory purposes and has no pincode, phone or contact name, all of
-- which a courier refuses a booking without.

create table if not exists courier_settings (
  id               boolean primary key default true check (id),
  -- name, company, phone, email, address1, address2, landmark, city, state,
  -- postal_code, country, gst_number. Validated in code (src/lib/couriers).
  pickup           jsonb not null default '{}'::jsonb,
  -- Empty means "same as pickup", which is what nearly every merchant wants.
  return_address   jsonb not null default '{}'::jsonb,
  -- weight_kg, length_cm, width_cm, height_cm — a typical parcel, so the
  -- dialog opens with sensible numbers and the operator only corrects the
  -- unusual ones.
  package_defaults jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

alter table courier_settings enable row level security;

drop policy if exists courier_settings_staff_all on courier_settings;
create policy courier_settings_staff_all on courier_settings
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

comment on table courier_settings is
  'Singleton: the pickup/return address and parcel defaults used when booking courier shipments from the admin.';

-- ---------------------------------------------------------------------------
-- courier_shipments — one row per booking attempt
-- ---------------------------------------------------------------------------
-- Modelled on `qikink_fulfillments` with one deliberate difference: that table
-- is one row per order, this one is one row per *attempt*. A courier booking
-- can be cancelled before pickup and made again — with the other courier,
-- after fixing a pincode — and the operator needs to see that history, not
-- have it overwritten. What must still hold is that an order has at most one
-- shipment that is actually live, and the partial unique index at the bottom
-- is what enforces it: two staff clicking "Ship" together resolve in the
-- database, not in a race.
--
-- `request` and `response` are kept for the same reason as everywhere else in
-- this schema: both couriers' failures are terse and arrive once, and without
-- the exact payload that produced "InvalidAreaScNotInRegion" a mapping bug is
-- a guess.

create table if not exists courier_shipments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  provider           text not null
                       check (provider in ('shreemaruti', 'bluedart')),
  -- booked    — the courier accepted it and issued an AWB
  -- failed    — the courier (or our own validation) refused it
  -- cancelled — booked, then cancelled before pickup
  status             text not null default 'failed'
                       check (status in ('booked', 'failed', 'cancelled')),

  -- The courier's number for the parcel. Blue Dart: the 12-digit waybill.
  -- Shree Maruti: the AWB assigned on booking (e.g. SFCO0000000550).
  awb                text,
  -- Shree Maruti also has an order id of its own, which is what its cancel and
  -- label endpoints key on. Blue Dart has only the AWB.
  provider_order_id  text,

  -- What was booked. `service` is the courier's own code: SURFACE/AIR for
  -- Shree Maruti; A/D/E (Domestic Priority, Dart Apex, Surfaceline) for Blue
  -- Dart. Payment mode and amounts are snapshotted because they are what the
  -- courier was *told*, which is the figure that matters in a dispute even if
  -- the order changes afterwards.
  service            text not null,
  payment_mode       text not null check (payment_mode in ('prepaid', 'cod')),
  collectable_amount numeric(12,2) not null default 0,
  declared_value     numeric(12,2) not null default 0,
  weight_kg          numeric(8,3) not null default 0,
  length_cm          numeric(7,1),
  width_cm           numeric(7,1),
  height_cm          numeric(7,1),
  pieces             integer not null default 1,

  -- Progress. `provider_status` is the courier's own wording, refreshed by
  -- sync or webhook; `stage` is our normalised bucket (see
  -- src/lib/couriers/status.ts); `stage_since` restarts only when the stage
  -- genuinely moves, so "stuck for N days" cannot be reset by a refresh.
  provider_status    text,
  stage              text not null default 'not_booked',
  stage_since        timestamptz,
  tracking_url       text,
  -- Storage path of the label PDF in the private `shipping-labels` bucket,
  -- when the courier handed one back at booking (Blue Dart does).
  label_path         text,
  -- Blue Dart's routing answer, useful on the label and in support calls.
  destination_area   text,
  destination_location text,

  request            jsonb not null default '{}'::jsonb,
  response           jsonb not null default '{}'::jsonb,
  error              text,

  created_by         uuid,
  created_by_email   text,
  booked_at          timestamptz,
  synced_at          timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists courier_shipments_order_idx
  on courier_shipments (order_id, created_at desc);
create index if not exists courier_shipments_provider_stage_idx
  on courier_shipments (provider, status, stage);
create index if not exists courier_shipments_awb_idx
  on courier_shipments (awb) where awb is not null;

-- One live booking per order. Failed and cancelled rows stay as history;
-- only `booked` competes for the slot.
create unique index if not exists courier_shipments_one_live_per_order
  on courier_shipments (order_id) where status = 'booked';

alter table courier_shipments enable row level security;

-- Staff only, same as qikink_fulfillments. Not exposed to anon: the shopper's
-- order page reads `fulfillments`, which carries the carrier name and the AWB
-- and nothing about our account with the courier.
drop policy if exists courier_shipments_staff_all on courier_shipments;
create policy courier_shipments_staff_all on courier_shipments
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

comment on table courier_shipments is
  'Courier bookings made from the admin, one row per attempt: AWB, service, amounts told to the courier, normalised stage, and the exact request/response for diagnosis. At most one booked row per order.';

-- ---------------------------------------------------------------------------
-- courier_events — webhook ledger
-- ---------------------------------------------------------------------------
-- Shree Maruti pushes status changes to a webhook and, like every webhook
-- sender, may deliver the same event more than once. The unique constraint is
-- the deduplication, exactly as `payment_events` (0023) does it for Cashfree:
-- insert first, and a unique violation means another delivery already did the
-- work.

create table if not exists courier_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  idempotency_key text not null,
  event_type      text,
  awb             text,
  payload         jsonb not null default '{}'::jsonb,
  received_at     timestamptz not null default now(),

  unique (provider, idempotency_key)
);

create index if not exists courier_events_received_idx
  on courier_events (received_at desc);

alter table courier_events enable row level security;

drop policy if exists courier_events_staff_all on courier_events;
create policy courier_events_staff_all on courier_events
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

comment on table courier_events is
  'Raw courier webhooks, one row per delivery. The unique (provider, idempotency_key) constraint makes at-least-once delivery safe to act on.';

-- ---------------------------------------------------------------------------
-- fulfillments.tracking_url — the link the shopper gets
-- ---------------------------------------------------------------------------
-- A booking writes a `fulfillments` row (carrier + AWB), which is what the
-- account and order-status pages already render. A number the shopper has to
-- paste into a courier site is half a feature; the link makes it whole.
-- Nullable: every hand-entered fulfillment before today has none.
--
-- `admin_order_detail` composes fulfillments with `to_jsonb(f)`, so the new
-- column reaches the admin order page without touching that function.

alter table fulfillments
  add column if not exists tracking_url text;

-- ---------------------------------------------------------------------------
-- Label storage
-- ---------------------------------------------------------------------------
-- Blue Dart returns the printable waybill as PDF bytes in the booking
-- response and does not offer it again later, so it has to be kept somewhere
-- at that moment. A *private* bucket: no read policy for anon or authenticated,
-- so the only way to a label is the staff-gated route handler, which fetches
-- it with the service role. A shipping label carries a customer's full
-- address and phone number; it must not be a guessable public URL.
--
-- Wrapped because `storage.objects` is owned by the storage service on some
-- projects (see 0032) and the bucket insert itself can be refused; in that
-- case labels simply stay unsaved and the order page says so.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('shipping-labels', 'shipping-labels', false)
  on conflict (id) do nothing;
exception when insufficient_privilege then
  raise notice 'skipped creating the shipping-labels bucket (insufficient privilege) — create it as PRIVATE from the Supabase dashboard';
end $$;
