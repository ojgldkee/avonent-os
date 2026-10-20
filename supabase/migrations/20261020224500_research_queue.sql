alter table public.competitor_watchlist
  add column if not exists scan_requested_at timestamptz,
  add column if not exists scan_request_status text not null default '';

update public.competitor_watchlist
set scan_request_status = ''
where scan_request_status is null;
