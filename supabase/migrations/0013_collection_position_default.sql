-- Assign a manual position to memberships created outside the collection editor.
--
-- 0012 added product_collections.position with `default 0`, which is wrong for
-- every writer except the collection editor itself.
--
-- The editor deletes a collection's rows and re-inserts the whole set with
-- explicit positions 0..n, so it is fine. But it is not the only writer:
-- `save_product` adds memberships from the *product* side, and
-- `duplicate_product` copies them — neither supplies a position. Under the old
-- default every product added that way landed at 0, so a merchant assigning
-- three products to a collection from the product editor got three rows all
-- claiming first place, ordered arbitrarily among themselves and all sorting
-- ahead of the arrangement the merchant had actually made.
--
-- Fixing it in `save_product` would mean re-emitting a hundred-line function to
-- change one statement, and would still leave `duplicate_product` and any
-- future writer broken. A trigger fixes every path at once.
--
-- The default becomes NULL rather than a sentinel value, so "no position given"
-- is unambiguous — 0 is a legitimate position and cannot also mean "unset".
-- NOT NULL still holds: Postgres checks it *after* BEFORE-triggers run, so the
-- trigger has already filled the value by the time the constraint is evaluated.

alter table product_collections alter column position drop default;
alter table product_collections alter column position set default null;

create or replace function public.set_collection_position() returns trigger
language plpgsql
as $$
begin
  if new.position is null then
    select coalesce(max(position) + 1, 0) into new.position
      from product_collections
     where collection_id = new.collection_id;
  end if;
  return new;
end;
$$;

comment on function public.set_collection_position() is
  'Appends a membership to the end of a collection when the writer did not specify a position. The collection editor always specifies one; save_product and duplicate_product do not.';

drop trigger if exists product_collections_position on product_collections;
create trigger product_collections_position
  before insert on product_collections
  for each row execute function public.set_collection_position();
