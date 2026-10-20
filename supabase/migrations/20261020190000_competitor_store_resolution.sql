alter table public.competitor_watchlist
  add column if not exists facebook_page_url text not null default '',
  add column if not exists resolution_status text not null default 'legacy_name_search',
  add column if not exists brand_data jsonb not null default '{}'::jsonb;

update public.competitor_watchlist
set resolution_status = 'legacy_name_search'
where resolution_status is null or resolution_status = '';
