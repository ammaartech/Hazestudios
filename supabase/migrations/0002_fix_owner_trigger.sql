-- Fix: signup failed with 500 because the auth.users trigger ran with the
-- auth schema's search_path and couldn't resolve "staff_roles".
-- Schema-qualify everything and pin search_path.

create or replace function public.grant_first_owner() returns trigger as $$
begin
  if not exists (select 1 from public.staff_roles) then
    insert into public.staff_roles (user_id, role, display_name)
    values (new.id, 'owner', coalesce(new.raw_user_meta_data->>'display_name', new.email));
  else
    insert into public.staff_roles (user_id, role, display_name)
    values (new.id, 'staff', coalesce(new.raw_user_meta_data->>'display_name', new.email));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
