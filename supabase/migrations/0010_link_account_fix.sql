-- Fix link_customer_account() against the UNIQUE constraint on customers.email.
--
-- The bug: 0009 declined to *claim* a guest record on an unconfirmed email
-- (correct) but then fell through to INSERT a new customer row carrying that
-- same email. `customers_email_key` rejects it, so signing up with an address
-- that already had a guest order raised a unique violation and broke the whole
-- sign-in flow — the security guard worked, the fallback did not.
--
-- The fix inverts the model: an unverified account has no shop identity at all.
-- No record is created until the address is confirmed. That is simpler than
-- minting a placeholder row and later merging it, leaves no orphans, and keeps
-- the guarantee the store actually wants — order history is never attached to
-- an address nobody has proved they own.
--
-- Callers must treat a NULL return as "verify your email", not as an error.
--
-- NOTE FOR THE OPERATOR: this only means something if "Confirm email" is
-- enabled in Supabase → Authentication → Providers → Email. With confirmation
-- disabled, Supabase stamps email_confirmed_at at signup and every address
-- counts as verified, which silently downgrades this to claim-on-signup.
-- Google sign-in arrives pre-confirmed, which is correct: Google verified it.

create or replace function public.link_customer_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid := auth.uid();
  v_email     text;
  v_confirmed timestamptz;
  v_meta      jsonb;
  v_customer  uuid;
  v_first     text;
  v_last      text;
  v_full      text;
begin
  if v_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Staff use the admin, not a storefront account.
  if exists (select 1 from staff_roles where user_id = v_id) then
    return null;
  end if;

  -- Already linked — idempotent, and the common path on every page load.
  select id into v_customer from customers where user_id = v_id;
  if v_customer is not null then
    return v_customer;
  end if;

  select email, email_confirmed_at, coalesce(raw_user_meta_data, '{}'::jsonb)
    into v_email, v_confirmed, v_meta
    from auth.users where id = v_id;

  -- No identity until the address is proven. The caller renders a
  -- "confirm your email" state rather than an empty account.
  if v_confirmed is null or v_email is null then
    return null;
  end if;

  v_full := coalesce(nullif(v_meta->>'full_name', ''), nullif(v_meta->>'name', ''), '');
  v_first := coalesce(
    nullif(v_meta->>'first_name', ''),
    nullif(v_meta->>'given_name', ''),
    nullif(split_part(v_full, ' ', 1), ''),
    ''
  );
  v_last := coalesce(
    nullif(v_meta->>'last_name', ''),
    nullif(v_meta->>'family_name', ''),
    nullif(nullif(substring(v_full from position(' ' in v_full) + 1), v_full), ''),
    ''
  );

  -- Claim an unowned guest/imported record for this address.
  select id into v_customer
    from customers
   where lower(email) = lower(v_email)
     and user_id is null
   order by created_at
   limit 1;

  if v_customer is not null then
    update customers
       set user_id    = v_id,
           first_name = case when first_name = '' then v_first else first_name end,
           last_name  = case when last_name  = '' then v_last  else last_name  end
     where id = v_customer;
    return v_customer;
  end if;

  -- Otherwise create one. `on conflict` guards the remaining collision: a
  -- record with this email that is already owned by a different user, which
  -- only arises from manual data edits. Merging it would hand over someone
  -- else's history, so this fails loudly instead.
  insert into customers (user_id, email, first_name, last_name)
  values (v_id, v_email, v_first, v_last)
  on conflict (email) do nothing
  returning id into v_customer;

  if v_customer is null then
    raise exception
      'Customer record for % is already linked to another account', v_email
      using errcode = 'unique_violation';
  end if;

  return v_customer;
end;
$$;

revoke all on function public.link_customer_account() from public;
grant execute on function public.link_customer_account() to authenticated;
