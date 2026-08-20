-- Qikink delivery tracking: a normalised stage, and the clock that makes
-- "stuck" a fact rather than a feeling.
--
-- ===========================================================================
-- WHY A SECOND STATUS COLUMN
-- ===========================================================================
-- 0016 stores `qikink_status` as free text, deliberately: it is Qikink's word
-- and theirs to change ("In Transit", "Out For Delivery", "RTO Initiated").
-- That makes it useless as a filter — a casing change on their side would
-- silently empty a tab, and `ilike '%transit%'` across every order is a scan.
--
-- So the free text stays exactly as received, and `stage` is added beside it:
-- our normalisation of it, from a fixed vocabulary, indexed. One column is the
-- evidence, the other is the interpretation, and when the mapping is wrong the
-- original is still there to fix it against.
-- ===========================================================================

alter table qikink_fulfillments
  add column if not exists stage text not null default 'created'
    check (stage in (
      'not_sent', 'created', 'in_production', 'picked_up', 'in_transit',
      'out_for_delivery', 'delivered', 'rto', 'cancelled', 'unknown'
    ));

-- When `stage` last changed value — NOT when the row was last synced.
--
-- The distinction is the whole alerting model. Syncing touches every open order
-- every few minutes, so `synced_at` only ever says "we asked recently". What an
-- operator needs is "this parcel has said 'In Transit' for nine days", and that
-- can only be read from a timestamp that survives a sync which changed nothing.
alter table qikink_fulfillments
  add column if not exists stage_since timestamptz not null default now();

-- The tracking page's default view is "everything not yet delivered, oldest
-- first" — the orders whose stage is unfinished, ordered by how long they have
-- been sitting there. This index serves that directly.
create index if not exists qikink_fulfillments_stage_idx
  on qikink_fulfillments (stage, stage_since desc);

comment on column qikink_fulfillments.stage is
  'Normalised delivery stage derived from qikink_status (see src/lib/qikink/status.ts). Filterable; qikink_status keeps Qikink''s original wording.';

comment on column qikink_fulfillments.stage_since is
  'When `stage` last changed. Not touched by a sync that leaves the stage alone — that is what makes "stuck for N days" measurable.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Existing rows carry a status but no stage. This mirrors the rule order in
-- status.ts: reversals before the happy path, because "rto delivered" contains
-- "delivered" and must not be read as a success.
--
-- `stage_since` is seeded from the best evidence each row has of when it last
-- moved, rather than now() — otherwise the backfill would reset every clock and
-- an order genuinely stuck for a fortnight would look freshly created.

update qikink_fulfillments
set
  stage = case
    when status = 'failed' then 'not_sent'
    when qikink_status is null or btrim(qikink_status) = '' then
      case when awb is not null and awb <> '' then 'picked_up' else 'created' end
    when qikink_status ilike '%cancel%' then 'cancelled'
    when qikink_status ilike '%rto%'
      or qikink_status ilike '%return%'
      or qikink_status ilike '%undeliver%' then 'rto'
    when qikink_status ilike '%out for delivery%' then 'out_for_delivery'
    when qikink_status ilike '%delivered%'
      or qikink_status ilike '%complete%' then 'delivered'
    when qikink_status ilike '%transit%'
      or qikink_status ilike '%shipped%'
      or qikink_status ilike '%dispatch%' then 'in_transit'
    when qikink_status ilike '%pick%'
      or qikink_status ilike '%manifest%'
      or qikink_status ilike '%ready to ship%' then 'picked_up'
    when qikink_status ilike '%production%'
      or qikink_status ilike '%printing%'
      or qikink_status ilike '%processing%'
      or qikink_status ilike '%accepted%'
      or qikink_status ilike '%confirm%' then 'in_production'
    when qikink_status ilike '%created%'
      or qikink_status ilike '%new%'
      or qikink_status ilike '%pending%' then 'created'
    else 'unknown'
  end,
  stage_since = coalesce(synced_at, sent_at, created_at)
-- 0006's pg_safeupdate guard: this needs a WHERE clause, and every row is in
-- scope, so the primary key being present is the condition.
where id is not null;
