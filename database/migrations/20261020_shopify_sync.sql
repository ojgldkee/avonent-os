alter table public.products add column if not exists shopify_product_id text;
alter table public.products add column if not exists shopify_data jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists shopify_synced_at timestamptz;
create unique index if not exists products_shopify_owner_unique on public.products(user_id,shopify_product_id) where shopify_product_id is not null;