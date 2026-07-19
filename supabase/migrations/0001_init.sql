-- Hazestudios admin schema — run in Supabase SQL editor or via `supabase db push`

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type product_status as enum ('draft', 'active', 'archived');
create type collection_type as enum ('manual', 'smart');
create type payment_status as enum ('pending', 'paid', 'partially_refunded', 'refunded');
create type fulfillment_status as enum ('unfulfilled', 'partial', 'fulfilled');
create type discount_type as enum ('percentage', 'fixed', 'free_shipping', 'bxgy');
create type discount_status as enum ('active', 'scheduled', 'expired', 'disabled');
create type staff_role as enum ('owner', 'admin', 'staff');

-- ---------------------------------------------------------------------------
-- Staff / roles
-- ---------------------------------------------------------------------------
create table staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role staff_role not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Shop settings (single row)
-- ---------------------------------------------------------------------------
create table shop_settings (
  id int primary key default 1 check (id = 1),
  store_name text not null default 'Hazestudios',
  legal_name text,
  email text,
  phone text,
  currency text not null default 'USD',
  timezone text not null default 'America/Toronto',
  address jsonb not null default '{}'::jsonb,
  brand jsonb not null default '{}'::jsonb,      -- { logo_url, primary_color, secondary_color, slogan }
  policies jsonb not null default '{}'::jsonb,   -- { privacy, refund, shipping, terms }
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Locations & products
-- ---------------------------------------------------------------------------
create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description_html text not null default '',
  status product_status not null default 'draft',
  vendor text not null default '',
  product_type text not null default '',
  tags text[] not null default '{}',
  price numeric(12,2) not null default 0,
  compare_at_price numeric(12,2),
  cost_per_item numeric(12,2),
  sku text not null default '',
  barcode text not null default '',
  track_inventory boolean not null default true,
  has_variants boolean not null default false,
  seo_title text not null default '',
  seo_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_tags_gin on products using gin (tags);
create index products_status_idx on products (status);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  url text not null,
  alt text not null default '',
  position int not null default 0
);
create index product_images_product_idx on product_images (product_id);

create table product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  "values" text[] not null default '{}',
  position int not null default 0
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  title text not null,
  option1 text,
  option2 text,
  option3 text,
  price numeric(12,2) not null default 0,
  compare_at_price numeric(12,2),
  sku text not null default '',
  barcode text not null default '',
  image_id uuid references product_images (id) on delete set null,
  position int not null default 0
);
create index product_variants_product_idx on product_variants (product_id);

create table collections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  handle text not null unique,
  description text not null default '',
  type collection_type not null default 'manual',
  rules jsonb not null default '[]'::jsonb,  -- [{ field: 'tag'|'title'|'price'|'vendor'|'product_type', operator, value }]
  image_url text,
  created_at timestamptz not null default now()
);

create table product_collections (
  product_id uuid not null references products (id) on delete cascade,
  collection_id uuid not null references collections (id) on delete cascade,
  primary key (product_id, collection_id)
);

-- Inventory per location. variant_id null = simple product stock.
create table inventory_levels (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  variant_id uuid references product_variants (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  quantity int not null default 0,
  unique nulls not distinct (product_id, variant_id, location_id)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  email text unique,
  phone text,
  notes text not null default '',
  tags text[] not null default '{}',
  default_address jsonb not null default '{}'::jsonb,
  accepts_marketing boolean not null default false,
  total_spent numeric(12,2) not null default 0,
  orders_count int not null default 0,
  created_at timestamptz not null default now()
);

create table segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null default '[]'::jsonb,  -- [{ field, operator, value }]
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create sequence order_number_seq start 1001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number int not null default nextval('order_number_seq'),
  customer_id uuid references customers (id) on delete set null,
  is_draft boolean not null default false,
  payment_status payment_status not null default 'pending',
  fulfillment_status fulfillment_status not null default 'unfulfilled',
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  discount_code text,
  total numeric(12,2) not null default 0,
  currency text not null default 'USD',
  note text not null default '',
  location_id uuid references locations (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index orders_customer_idx on orders (customer_id);
create index orders_created_idx on orders (created_at);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  variant_id uuid references product_variants (id) on delete set null,
  title_snapshot text not null,
  variant_snapshot text not null default '',
  price_snapshot numeric(12,2) not null,
  quantity int not null default 1
);
create index order_items_order_idx on order_items (order_id);

create table fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  tracking_number text not null default '',
  carrier text not null default '',
  status text not null default 'fulfilled',
  created_at timestamptz not null default now()
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  amount numeric(12,2) not null,
  reason text not null default '',
  restock boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Discounts & gift cards
-- ---------------------------------------------------------------------------
create table discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type discount_type not null,
  value numeric(12,2) not null default 0,
  min_purchase numeric(12,2),
  usage_limit int,
  used_count int not null default 0,
  once_per_customer boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status discount_status not null default 'active',
  created_at timestamptz not null default now()
);

create table gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  initial_value numeric(12,2) not null,
  balance numeric(12,2) not null,
  customer_id uuid references customers (id) on delete set null,
  note text not null default '',
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Files (Content > Files)
-- ---------------------------------------------------------------------------
create table files (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  filename text not null,
  mime_type text not null default '',
  size bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger products_updated_at before update on products
  for each row execute function set_updated_at();
create trigger shop_settings_updated_at before update on shop_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Customer aggregates kept in sync from orders
-- ---------------------------------------------------------------------------
create or replace function refresh_customer_stats() returns trigger as $$
declare
  cid uuid;
begin
  cid := coalesce(new.customer_id, old.customer_id);
  if cid is not null then
    update customers c set
      total_spent = coalesce((select sum(o.total) from orders o
        where o.customer_id = cid and not o.is_draft and o.payment_status in ('paid','partially_refunded')), 0),
      orders_count = coalesce((select count(*) from orders o
        where o.customer_id = cid and not o.is_draft), 0)
    where c.id = cid;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger orders_refresh_customer_stats
  after insert or update or delete on orders
  for each row execute function refresh_customer_stats();

-- ---------------------------------------------------------------------------
-- RLS: authenticated staff only, on every table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_roles','shop_settings','locations','products','product_images',
    'product_options','product_variants','collections','product_collections',
    'inventory_levels','customers','segments','orders','order_items',
    'fulfillments','refunds','discounts','gift_cards','files'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_staff_all', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),
  ('files', 'files', true),
  ('brand', 'brand', true)
on conflict (id) do nothing;

create policy "staff write product-images" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-images','files','brand'))
  with check (bucket_id in ('product-images','files','brand'));

create policy "public read buckets" on storage.objects
  for select to public
  using (bucket_id in ('product-images','files','brand'));

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
insert into shop_settings (id) values (1) on conflict do nothing;
insert into locations (name, is_default, address)
  values ('Main warehouse', true, '{"city":"Toronto","country":"Canada"}'::jsonb);

-- Make the first user who signs up an owner automatically
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function grant_first_owner();
