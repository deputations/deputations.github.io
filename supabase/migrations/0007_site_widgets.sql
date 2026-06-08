-- ============================================================================
-- Migration 0007: site widgets — visitor counter + per-page feedback sentiment
--
-- Powers two public, site-wide widgets:
--   • Visitor counter (Total / Today / Online now)
--   • Feedback (👍/👎) with a visible thumbs-up count per page
--
-- Anonymous visitors never touch these tables directly. All writes/reads from
-- the browser go through SECURITY DEFINER RPCs granted to `anon` (same model as
-- public.endorse_flag in 0005). RLS keeps the raw tables admin-only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Visits — a single-row running counter with a daily rollover.
-- ---------------------------------------------------------------------------
create table if not exists public.site_counter (
  id     int  primary key default 1,
  total  bigint not null default 0,
  day    date   not null default current_date,
  today  bigint not null default 0,
  constraint site_counter_singleton check (id = 1)
);
insert into public.site_counter (id, total, day, today)
  values (1, 0, current_date, 0)
  on conflict (id) do nothing;

-- bump once per visit (the browser guards with sessionStorage). Returns the
-- fresh totals so the widget can render immediately.
create or replace function public.bump_visit()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare r public.site_counter;
begin
  update public.site_counter
     set total = total + 1,
         today = case when day = current_date then today + 1 else 1 end,
         day   = current_date
   where id = 1
  returning * into r;
  return json_build_object('total', r.total, 'today', r.today);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Presence — "online now" via short-lived heartbeats.
-- ---------------------------------------------------------------------------
create table if not exists public.presence (
  session_id text primary key,
  last_seen  timestamptz not null default now()
);
create index if not exists presence_last_seen_idx on public.presence (last_seen);

-- upsert this session's heartbeat, prune stale rows, return the live count.
create or replace function public.heartbeat(p_session text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if p_session is null or length(p_session) < 6 or length(p_session) > 64 then
    return 0;
  end if;
  insert into public.presence (session_id, last_seen)
    values (p_session, now())
    on conflict (session_id) do update set last_seen = now();
  -- opportunistic cleanup so the table stays tiny
  delete from public.presence where last_seen < now() - interval '10 minutes';
  select count(*) into n from public.presence
   where last_seen > now() - interval '75 seconds';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Per-page feedback sentiment (👍 / 👎).
-- ---------------------------------------------------------------------------
create table if not exists public.page_feedback (
  page       text primary key,
  ups        bigint not null default 0,
  downs      bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- record a vote ('up'|'down') and return the new counts. The browser guards
-- one vote per page per device (localStorage); this is a vanity/sentiment
-- signal, not an audited ballot.
create or replace function public.record_sentiment(p_page text, p_vote text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare r public.page_feedback;
begin
  if p_page is null or length(p_page) = 0 or length(p_page) > 200 then
    return json_build_object('ups', 0, 'downs', 0);
  end if;
  p_page := left(p_page, 200);
  insert into public.page_feedback (page, ups, downs)
    values (p_page,
            case when p_vote = 'up'   then 1 else 0 end,
            case when p_vote = 'down' then 1 else 0 end)
    on conflict (page) do update
       set ups        = public.page_feedback.ups   + case when p_vote = 'up'   then 1 else 0 end,
           downs      = public.page_feedback.downs + case when p_vote = 'down' then 1 else 0 end,
           updated_at = now()
  returning * into r;
  return json_build_object('ups', r.ups, 'downs', r.downs);
end;
$$;

-- read-only: current counts for a page (so the widget shows the likes on load).
create or replace function public.get_sentiment(p_page text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
           'ups',   coalesce((select ups   from public.page_feedback where page = left(p_page,200)), 0),
           'downs', coalesce((select downs from public.page_feedback where page = left(p_page,200)), 0)
         );
$$;

-- ============================================================================
-- Row Level Security: raw tables are admin-read only; no anon table access.
-- (All public interaction is via the SECURITY DEFINER RPCs below.)
-- ============================================================================
alter table public.site_counter enable row level security;
alter table public.presence      enable row level security;
alter table public.page_feedback enable row level security;

drop policy if exists site_counter_admin on public.site_counter;
create policy site_counter_admin on public.site_counter
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists presence_admin on public.presence;
create policy presence_admin on public.presence
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists page_feedback_admin on public.page_feedback;
create policy page_feedback_admin on public.page_feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- Grants: anon (public site) may EXECUTE the RPCs only.
-- ============================================================================
grant execute on function public.bump_visit()                       to anon, authenticated;
grant execute on function public.heartbeat(text)                    to anon, authenticated;
grant execute on function public.record_sentiment(text, text)       to anon, authenticated;
grant execute on function public.get_sentiment(text)                to anon, authenticated;

-- ============================================================================
-- DONE. Browser calls (anon key) e.g.:
--   POST /rest/v1/rpc/bump_visit            {}
--   POST /rest/v1/rpc/heartbeat             { "p_session": "<uuid>" }
--   POST /rest/v1/rpc/record_sentiment      { "p_page": "/index.html", "p_vote": "up" }
--   POST /rest/v1/rpc/get_sentiment         { "p_page": "/index.html" }
-- ============================================================================
