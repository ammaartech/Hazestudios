-- Waitlist: a name on every entry, two more things to come for, and somewhere
-- to put "other".
--
-- ===========================================================================
-- WHY `name` IS NULLABLE-BY-DEFAULT RATHER THAN `not null` WITH NO DEFAULT
-- ===========================================================================
-- The form now asks for a name and the action requires one, so every row
-- written from here on has it. The rows already in the table do not, and there
-- is no honest value to backfill them with — inventing one from the email's
-- local part would put a guess in a column an operator reads as a fact when
-- they text somebody. `not null default ''` keeps the column non-null for
-- everything downstream (no `?? ""` at every read) while leaving "we never
-- asked this person" legible as an empty string. The requirement lives in the
-- action, which is where it can produce a message rather than a 500.
alter table waitlist_entries
  add column if not exists name text not null default '';

-- The open-ended answer that goes with the 'other' chip.
--
-- Separate from `craft` on purpose. `craft` stays a closed set that the check
-- constraint below polices and the admin filters on; this is free text a
-- stranger typed, and it must never be able to widen that set. Empty for every
-- entry that picked one of the named chips.
alter table waitlist_entries
  add column if not exists craft_note text not null default '';

-- The craft set, widened.
--
-- 'movie' and 'other' are new; the four original ids are unchanged, so no row
-- has to be rewritten and no screenshot anybody holds becomes wrong. The
-- constraint is dropped and recreated rather than altered because Postgres has
-- no `alter constraint` for a check expression.
alter table waitlist_entries
  drop constraint if exists waitlist_entries_craft_check;

alter table waitlist_entries
  add constraint waitlist_entries_craft_check
  check (craft in ('fan', 'lantern', 'movie', 'keychain', 'polaroid', 'other'));

-- A note without 'other' selected is a contradiction: it would show up in the
-- admin beside a craft it does not describe. Enforced here rather than trusted
-- to the action, because the service-role key bypasses RLS and this table is
-- writable from anywhere that holds it.
alter table waitlist_entries
  drop constraint if exists waitlist_entries_craft_note_check;

alter table waitlist_entries
  add constraint waitlist_entries_craft_note_check
  check (craft = 'other' or craft_note = '');
