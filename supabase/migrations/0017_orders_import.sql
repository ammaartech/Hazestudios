-- Historical order import (Shopify export) + rupee defaults.
--
-- ===========================================================================
-- WHY THE ENUMS GROW
-- ===========================================================================
-- 0001 modelled payment_status on the happy path a native checkout produces:
-- pending → paid → (partially_)refunded. A real Shopify ledger carries two more
-- states that are not reachable from that path but are very reachable from a
-- storefront that takes cash on delivery:
--
--   voided          the authorisation was released without ever capturing —
--                   1,919 of the 6,576 imported orders, almost all COD orders
--                   the customer cancelled before dispatch. Not "refunded":
--                   no money ever moved, so counting them as refunds would
--                   overstate both gross sales and refund rate.
--   partially_paid  a deposit or gift-card part-payment against a larger total.
--
-- Likewise fulfillment_status gains `restocked` — a cancelled order whose units
-- went back on the shelf. Reporting has to tell that apart from `unfulfilled`,
-- which still owes the customer goods.
--
-- Both are additive. Nothing that reads the old four/three values breaks; code
-- that switches on them must simply learn the new ones.
--
-- ===========================================================================
-- WHY order_name EXISTS ALONGSIDE order_number
-- ===========================================================================
-- order_number is an int off a sequence, and the admin renders it as `#1234`.
-- The imported ledger does not fit that shape:
--
--   * Names are prefixed — FOG7577, not 7577. The prefix is the store's, and
--     support tickets, courier manifests and the customer's own email all say
--     "FOG7577". Losing it means the number in the admin matches nothing the
--     merchant can search for.
--   * Names are not unique *numerically*. Shopify issues exchange orders by
--     suffixing the original: FOG3726 spawned two separate FOG3726_A orders.
--     Three distinct orders therefore share the numeric part 3726, so the int
--     alone cannot identify a row.
--
-- So order_name holds the export's identifier verbatim and is the unique key
-- for the import; order_number keeps the numeric part so existing sorting,
-- range queries and the numeric search box go on working. New orders written by
-- the app leave order_name null and continue to display as `#<order_number>`.
--
-- ===========================================================================
-- WHY cancelled_at IS NOT closed_at
-- ===========================================================================
-- closed_at already means "archived out of the open queue" and the admin's
-- open/closed tabs key off it. Cancellation is a different fact — it says the
-- order will never ship — and 2,035 imported orders carry it. Overloading
-- closed_at would make a cancelled order indistinguishable from one that was
-- fulfilled and filed away.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- PG 12+ permits ADD VALUE inside a transaction so long as the new label is not
-- *used* before commit. This file only declares them; the importer runs later.
alter type payment_status add value if not exists 'voided';
alter type payment_status add value if not exists 'partially_paid';
alter type fulfillment_status add value if not exists 'restocked';

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists order_name   text,
  add column if not exists cancelled_at timestamptz;

-- Partial: only imported rows carry a name, and null is not "duplicate null"
-- here — app-created orders must be free to leave it empty.
create unique index if not exists orders_order_name_key
  on orders (order_name)
  where order_name is not null;

create index if not exists orders_cancelled_idx
  on orders (cancelled_at)
  where cancelled_at is not null;

-- The store sells in India and shop_settings.currency is already INR; the
-- column default was the last place still minting dollars.
alter table orders alter column currency set default 'INR';
alter table carts  alter column currency set default 'INR';

comment on column orders.order_name is
  'Verbatim identifier from the source system (e.g. FOG7577). Null for orders created in-app, which display as #<order_number>.';
comment on column orders.cancelled_at is
  'When the order was cancelled at source. Distinct from closed_at, which only means "filed out of the open queue".';
