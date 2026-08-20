-- "On Hold" is a stage, not an unknown.
--
-- ===========================================================================
-- WHY
-- ===========================================================================
-- 0026 built a ten-stage vocabulary modelled on a courier pipeline: created →
-- in production → picked up → in transit → out for delivery → delivered. That
-- shape was assumed rather than observed, and the live API disagrees.
--
-- Measured against the account's own `GET /api/order`, the entire vocabulary
-- Qikink actually emits is three strings:
--
--     On Hold     8
--     Delivered   1
--     Cancelled   1
--
-- `in_production`, `picked_up`, `in_transit` and `out_for_delivery` have never
-- appeared once. "On Hold" — the overwhelming majority — matched no rule in
-- status.ts and fell through to `unknown`, so most of the store's live orders
-- rendered as "Qikink reported a status we don't recognise yet". A warning that
-- fires on 80% of orders is not a warning; it is noise that hides the real ones.
--
-- "On Hold" is also not a neutral waypoint. In the live data every On Hold
-- order has `live_date: null`, no AWB and no courier assigned, while the single
-- Delivered order has all three. It is where Qikink parks an order it has
-- accepted but is not printing — and it stays there until a human clears it.
-- That makes it precisely the thing this page exists to surface, so it gets its
-- own stage and its own (tighter) stale timer rather than a shrug.
--
-- The unused pipeline stages are deliberately KEPT in the constraint. They cost
-- nothing, and removing them would mean a second migration the first time an
-- order does reach a courier.
-- ===========================================================================

alter table qikink_fulfillments
  drop constraint if exists qikink_fulfillments_stage_check;

alter table qikink_fulfillments
  add constraint qikink_fulfillments_stage_check
    check (stage in (
      'not_sent', 'created', 'on_hold', 'in_production', 'picked_up',
      'in_transit', 'out_for_delivery', 'delivered', 'rto', 'cancelled',
      'unknown'
    ));

-- ---------------------------------------------------------------------------
-- Reclassify the rows that were already mis-filed as `unknown`
-- ---------------------------------------------------------------------------
-- Only rows whose stored status actually says "hold" are touched, and only
-- those currently sitting in `unknown` — a row correctly classified as anything
-- else is left alone.
--
-- `stage_since` is deliberately NOT reset. These orders have been on hold since
-- their stage was last observed to change; rewriting the clock here would erase
-- exactly the evidence the alert depends on, and an order held for thirteen
-- days would silently present as fresh. The stage label is being corrected, not
-- the order's history.

update qikink_fulfillments
set stage = 'on_hold'
where stage = 'unknown'
  and qikink_status ilike '%hold%';
