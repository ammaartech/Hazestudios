-- Qikink's own order date, so the tracking page can be sorted the way the
-- merchant's Qikink dashboard is sorted.
--
-- ===========================================================================
-- WHY OUR OWN created_at IS NOT ENOUGH
-- ===========================================================================
-- The tracking table sorted by `orders.created_at`, on the assumption that when
-- we recorded an order and when Qikink recorded it are the same moment. For
-- most orders they are within seconds. For some they are not, and the list
-- comes out visibly scrambled against the dashboard it is meant to mirror.
--
-- Order 7586 is the case that exposed it: Qikink has it as 2026-08-20 23:00,
-- the newest order in the account and the first row of their "On Hold" list.
-- Our `orders.created_at` for it reads 2026-02-14 — six months earlier — so it
-- sorted to the very bottom of our page while sitting at the top of theirs.
--
-- Storing their timestamp separately keeps both truths: `orders.created_at` is
-- when the customer placed it here, `qikink_placed_at` is when Qikink took it
-- on, and the tracking page — which exists to mirror Qikink — sorts by theirs.
--
-- ===========================================================================
-- TIMEZONE
-- ===========================================================================
-- `created_on` comes back as a naive string, "2026-08-20 23:00:05", with no
-- offset. It is IST (UTC+5:30), established by comparing three same-day orders
-- against our own UTC timestamps: the gap was 5.50, 5.51 and 5.53 hours. Read
-- as UTC it would place orders in the future, which is what made a freshly
-- created order briefly show a negative age. The conversion happens in
-- tracking.ts before the value is written; this column is plain timestamptz.

alter table qikink_fulfillments
  add column if not exists qikink_placed_at timestamptz;

comment on column qikink_fulfillments.qikink_placed_at is
  'Qikink''s own `created_on` for the order, converted from IST to UTC. Sorted on by the tracking page so its order matches the Qikink dashboard; null until first synced.';

-- Sort key for the tracking page: newest first, and only rows that have one.
create index if not exists qikink_fulfillments_placed_at_idx
  on qikink_fulfillments (qikink_placed_at desc nulls last);
