-- ============================================================================
-- Migration 0023: India Map — geography fields
-- Adds state_abbr + district to vacancies for the India Map visualisation.
-- Backfills from the one-time generated data/vacancies-enriched.json
-- (run scripts/backfill-map-geography.mjs after this migration lands).
-- ============================================================================

-- ---- Columns -------------------------------------------------------------
alter table public.vacancies
  add column if not exists state_abbr     text,
  add column if not exists district       text,
  add column if not exists location_scope text
    check (location_scope is null or location_scope in ('district','multi_state','nationwide')),
  add column if not exists location_label text;

create index if not exists vacancies_state_abbr_idx on public.vacancies (state_abbr);
create index if not exists vacancies_state_dist_idx
  on public.vacancies (state_abbr, district)
  where state_abbr is not null and district is not null;
create index if not exists vacancies_location_scope_idx
  on public.vacancies (location_scope);

-- ---- RPC: aggregated state counts for the choropleth --------------------
-- Bucket classification for the national overview tier.
create or replace function public.get_map_state_counts(
  p_central_only boolean default false
)
returns table (
  state_abbr     text,
  total          bigint,
  active         bigint,
  district_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select v.*
    from public.vacancies v
    where v.status = 'approved'
      and v.state_abbr is not null
      and (p_central_only = false or v.location_scope = 'district')
  ),
  agg as (
    select
      state_abbr,
      count(*)                                          as total,
      count(*) filter (where coalesce(v.last_date_to_apply,'9999') >= to_char(now(), 'YYYY-MM-DD')) as active,
      count(distinct district)                          as district_count
    from eligible
    group by state_abbr
  )
  select
    s.abbr as state_abbr,
    coalesce(a.total, 0)          as total,
    coalesce(a.active, 0)         as active,
    coalesce(a.district_count, 0) as district_count
  from (values
    ('AN'),('AP'),('AR'),('AS'),('BR'),('CG'),('CH'),('DL'),('DN'),('GA'),
    ('GJ'),('HR'),('HP'),('JK'),('JH'),('KA'),('KL'),('LA'),('LD'),('MH'),
    ('ML'),('MN'),('MP'),('MZ'),('NL'),('OD'),('PB'),('PY'),('RJ'),('SK'),
    ('TN'),('TR'),('TS'),('UK'),('UP'),('WB')
  ) as s(abbr)
  left join agg a using (state_abbr)
  order by s.abbr;
$$;

-- ---- RPC: listings for a single state ----------------------------------
create or replace function public.get_map_state_listings(p_state_abbr text)
returns setof public.vacancies
language sql
stable
security invoker
set search_path = public
as $$
  select v.*
  from public.vacancies v
  where v.status = 'approved'
    and v.state_abbr = p_state_abbr
  order by
    coalesce(v.last_date_to_apply, '9999') asc,
    v.created_at desc;
$$;

-- ---- RPC: listings for a single district --------------------------------
create or replace function public.get_map_district_listings(
  p_state_abbr text,
  p_district   text
)
returns setof public.vacancies
language sql
stable
security invoker
set search_path = public
as $$
  select v.*
  from public.vacancies v
  where v.status = 'approved'
    and v.state_abbr = p_state_abbr
    and v.district   = p_district
  order by
    coalesce(v.last_date_to_apply, '9999') asc,
    v.created_at desc;
$$;

-- ---- RPC: nationwide bucket counts (rendered as overlay, not on map) ----
create or replace function public.get_map_bucket_counts()
returns table (
  nationwide  bigint,
  multi_state bigint,
  district    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where location_scope = 'nationwide')  as nationwide,
    count(*) filter (where location_scope = 'multi_state') as multi_state,
    count(*) filter (where location_scope = 'district')    as district
  from public.vacancies
  where status = 'approved';
$$;

grant execute on function public.get_map_state_counts(boolean)         to anon, authenticated;
grant execute on function public.get_map_state_listings(text)           to anon, authenticated;
grant execute on function public.get_map_district_listings(text, text)  to anon, authenticated;
grant execute on function public.get_map_bucket_counts()                to anon, authenticated;
