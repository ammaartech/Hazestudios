-- Storefront analytics: sessions, events, and the geo data behind Live View.
--
-- Two tables rather than one event log with a session column:
--   * `analytics_sessions` is mutable and small — one row per visitor visit,
--     with `last_seen_at` bumped by a heartbeat. "Visitors right now" is a
--     count over this table, which stays cheap as the event log grows.
--   * `analytics_events` is append-only — page views, cart adds, checkouts.
--     Funnels and "sessions by landing page" read from here.
--
-- Writes arrive from the public storefront, so they go through /api/track on
-- the service-role key. There is deliberately no anon insert policy: a public
-- insert grant would let anyone forge sessions and poison the dashboard.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create table analytics_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated, stored in sessionStorage. Unique so the beacon can upsert
  -- on it without a read-then-write race between concurrent heartbeats.
  session_key text not null unique,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Geo, resolved server-side from platform headers or an IP lookup. All
  -- nullable: local dev and private-range IPs legitimately resolve to nothing.
  country text,
  country_code text,
  region text,
  city text,
  latitude double precision,
  longitude double precision,

  -- Attribution + device, for the Live View side panels.
  referrer text not null default '',
  referrer_host text not null default '',
  landing_path text not null default '/',
  device_type text not null default 'desktop',
  user_agent text not null default '',

  -- Rolled up by the beacon so the funnel does not need a join per session.
  page_views int not null default 0,
  is_returning boolean not null default false,

  -- Set when a session converts, so Live View can show "Purchased".
  order_id uuid references orders (id) on delete set null,
  checkout_started_at timestamptz,
  purchased_at timestamptz
);

create index analytics_sessions_last_seen_idx on analytics_sessions (last_seen_at desc);
create index analytics_sessions_started_idx on analytics_sessions (started_at desc);
create index analytics_sessions_country_idx on analytics_sessions (country_code);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create type analytics_event_type as enum (
  'page_view',
  'product_view',
  'collection_view',
  'search',
  'add_to_cart',
  'checkout_start',
  'purchase'
);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references analytics_sessions (id) on delete cascade,
  type analytics_event_type not null,
  path text not null default '/',
  -- Denormalised title so a deleted product does not blank out history.
  product_id uuid references products (id) on delete set null,
  product_title text not null default '',
  search_query text not null default '',
  -- Order value for 'purchase', cart value for 'add_to_cart'.
  value numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index analytics_events_session_idx on analytics_events (session_id);
create index analytics_events_created_idx on analytics_events (created_at desc);
create index analytics_events_type_created_idx on analytics_events (type, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — admin reads, service-role writes, nothing for anon.
-- ---------------------------------------------------------------------------
alter table analytics_sessions enable row level security;
alter table analytics_events enable row level security;

grant select on analytics_sessions to authenticated;
grant select on analytics_events to authenticated;

create policy analytics_sessions_admin_read on analytics_sessions
  for select to authenticated using (true);

create policy analytics_events_admin_read on analytics_events
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Retention. Live View only looks back minutes and the reports look back a
-- year; sessions older than that are dead weight. Called opportunistically by
-- the beacon rather than scheduled, so there is no pg_cron dependency.
-- ---------------------------------------------------------------------------
create or replace function prune_analytics(older_than interval default '400 days')
returns void
language sql
security definer
set search_path = public
as $$
  delete from analytics_sessions where started_at < now() - older_than;
$$;
