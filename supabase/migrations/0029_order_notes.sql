-- Internal notes on an order, for the people packing and chasing it.
--
-- ===========================================================================
-- WHY A TABLE RATHER THAN A COLUMN
-- ===========================================================================
-- `orders.note` already exists and is kept: it is the *customer's* note, captured
-- at checkout, and belongs to the order the way the shipping address does.
--
-- What the admin lacks is somewhere for staff to talk to each other — "customer
-- asked to change the size", "Qikink held this, chased on the 21st", "do not
-- refund, replacement already sent". That is a log, not a field: it is written
-- by different people at different times, and the previous entry must survive
-- the next one. A single editable column would have each note silently
-- overwrite the last, which is precisely the information worth keeping.
--
-- Deliberately append-only in spirit and separate from the customer's note, so
-- nothing an operator types here can ever be mistaken for something the shopper
-- said.

create table if not exists order_notes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  body        text not null check (btrim(body) <> ''),
  -- Who wrote it. Null-able and ON DELETE SET NULL: a note written by someone
  -- who has since left the team is still worth reading, so losing the author
  -- must not take the note with it.
  author_id   uuid references auth.users(id) on delete set null,
  -- Denormalised at write time. The author's email lives in `auth.users`, which
  -- the admin's session client cannot read, so resolving names at render time
  -- would mean a service-role lookup per note. Stamping it once keeps the list
  -- one plain query, and keeps the note readable after the account is gone.
  author_email text,
  created_at  timestamptz not null default now()
);

-- The only access pattern: every note for one order, newest first.
create index if not exists order_notes_order_id_idx
  on order_notes (order_id, created_at desc);

alter table order_notes enable row level security;

-- Staff only, via the same helper every other admin table uses. Never exposed
-- to anon: these are explicitly the remarks not meant for the customer, and the
-- storefront's order-status page reads `orders`, never this.
drop policy if exists order_notes_staff_all on order_notes;
create policy order_notes_staff_all on order_notes
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table order_notes is
  'Internal staff notes on an order. Distinct from orders.note, which is the customer''s own note from checkout and is never written here.';
comment on column order_notes.author_email is
  'Author''s email at the time of writing, denormalised so the list renders without a privileged lookup into auth.users and survives the account being deleted.';
