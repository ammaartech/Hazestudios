-- A POST to a supplier is not safe to repeat after a lost response.
create table fulfillment_dispatches (
  order_id uuid primary key references orders(id) on delete cascade,
  state text not null check (state in ('sending','retryable','uncertain','complete')),
  updated_at timestamptz not null default now()
);
alter table fulfillment_dispatches enable row level security;
create policy fulfillment_dispatches_staff_read on fulfillment_dispatches for select to authenticated using (public.is_staff());

create function public.claim_fulfillment_dispatch(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  -- Re-check business state while holding the same order lock as payment/expiry.
  perform 1 from orders where id=p_order_id and not is_draft and cancelled_at is null
    and stock_released_at is null and (held_at is null or released_at is not null)
    and (payment_method='cod' or payment_status='paid') for update;
  if not found then return false; end if;
  insert into fulfillment_dispatches as d(order_id,state) values(p_order_id,'sending')
  on conflict(order_id) do update set state='sending',updated_at=now() where d.state='retryable';
  return found;
end;
$$;
revoke all on function public.claim_fulfillment_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.claim_fulfillment_dispatch(uuid) to service_role;

alter table commerce_jobs add column failures integer not null default 0;

-- Recover existing unpaid sessions too. Legacy orders have no reservation ledger,
-- so their inventory is deliberately not automatically restocked.
insert into commerce_jobs(job_key,kind,order_id,payment_id)
select 'payment:'||p.id,'reconcile',p.order_id,p.id from payments p
join orders o on o.id=p.order_id
where p.provider='cashfree' and p.status<>'success' and p.gateway_closed_at is null and o.payment_status='pending'
on conflict(job_key) do nothing;

create table commerce_worker_health (
  id integer primary key check(id=1),
  last_finished_at timestamptz not null,
  summary jsonb not null
);
alter table commerce_worker_health enable row level security;
create index payments_review_idx on payments(id) where reconciliation_required;

create function public.commerce_health()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'lastFinishedAt',(select last_finished_at from commerce_worker_health where id=1),
    'failedJobs',(select count(*) from commerce_jobs where status='failed'),
    'readyJobs',(select count(*) from commerce_jobs where status='ready' and available_at<=now()),
    'expiredLeases',(select count(*) from commerce_jobs where status='running' and lease_until<now()),
    'oldestDueSeconds',(select coalesce(extract(epoch from now()-min(available_at)),0) from commerce_jobs where status='ready' and available_at<=now()),
    'paymentsNeedingReview',(select count(*) from payments where reconciliation_required),
    'uncertainDispatches',(select count(*) from fulfillment_dispatches where state='uncertain' or (state='sending' and updated_at<now()-interval '5 minutes'))
  );
$$;
revoke all on function public.commerce_health() from public,anon,authenticated;
grant execute on function public.commerce_health() to service_role;

-- Admin cancellation must share the expiry lock and the exact stock allocation
-- ledger. Legacy orders retain their existing manual cancellation behavior.
create function public.cancel_checkout_order(p_order_id uuid,p_restock boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare o orders%rowtype; allocation record;
begin
  if not public.is_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into o from orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.checkout_cart_key is null then return false; end if;
  if o.cancelled_at is not null then return true; end if;
  if p_restock and o.stock_released_at is null then
    if exists(select 1 from checkout_stock_allocations where order_id=o.id and inventory_id is null) then
      raise exception 'Allocated inventory was removed; manual stock adjustment required';
    end if;
    for allocation in select il.id, a.quantity from checkout_stock_allocations a
      join inventory_levels il on il.id=a.inventory_id where a.order_id=o.id
      order by il.product_id,il.variant_id nulls first,il.id for update of il
    loop
      update inventory_levels set quantity=quantity+allocation.quantity where id=allocation.id;
    end loop;
  end if;
  update orders set cancelled_at=now(),
    stock_released_at=case when p_restock then coalesce(stock_released_at,now()) else stock_released_at end,
    fulfillment_status=(case when p_restock then 'restocked' else 'unfulfilled' end)::fulfillment_status,
    payment_status=case when payment_status='pending' then 'voided'::payment_status else payment_status end
  where id=o.id;
  update payment_requests set status='cancelled',resolved_at=now(),updated_at=now() where order_id=o.id and status='open';
  return true;
end;
$$;
revoke all on function public.cancel_checkout_order(uuid,boolean) from public,anon;
grant execute on function public.cancel_checkout_order(uuid,boolean) to authenticated;

grant all on fulfillment_dispatches,commerce_worker_health to service_role;
