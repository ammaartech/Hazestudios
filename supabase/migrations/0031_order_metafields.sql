-- Order-specific custom data uses the order's existing staff-only write policy.
alter table public.orders add column if not exists metafields jsonb not null default '{}'::jsonb;
alter table public.orders add constraint orders_metafields_object check (jsonb_typeof(metafields) = 'object');
