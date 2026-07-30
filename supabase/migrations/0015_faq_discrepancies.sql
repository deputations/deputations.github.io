-- ============================================================================
-- Migration 0015: faq_discrepancies — community-reported "this answer is wrong"
--
-- A reader who spots a problem with an FAQ answer files a discrepancy report.
-- Others can vote it up ("Valid discrepancy") or down ("FAQ is correct").
-- Mirrors the security + RLS model of vacancy_flags (0005):
--   • service role writes (Edge Function does all INSERTs)
--   • anon may SELECT only OPEN reports (to list + render the public card list)
--   • admin (in admins table) may read/write everything
--   • vote rows themselves are admin-only — the only public surface is the
--     faq_vote() RPC which returns aggregated counts (not the row).
--
-- The corresponding Edge Function branches live in
-- supabase/functions/submit/index.ts under action:"faq_report" and
-- action:"faq_vote".
-- ============================================================================

create table if not exists public.faq_reports (
  id           uuid primary key default gen_random_uuid(),

  qnum         text not null,             -- bare FAQ question number ("07", "12", "13a" etc.)
  qtext        text,                      -- question text cached at submit time so the
                                          -- public list keeps rendering even if the FAQ
                                          -- is later re-numbered or re-worded
  report       text not null,             -- the discrepancy text from the reporter (≥10 chars enforced client + server)
  name         text,                      -- optional reporter name; rendered as "Anonymous" when null/blank
  user_agent   text,                      -- for the admin console

  agree        int  not null default 0,   -- aggregated vote counts (kept in sync by faq_vote())
  disagree     int  not null default 0,

  status       text not null default 'open'
                    check (status in ('open','approved','dismissed')),
  admin_note   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists faq_reports_qnum_idx   on public.faq_reports (qnum);
create index if not exists faq_reports_status_idx on public.faq_reports (status);

drop trigger if exists trg_faq_report_touch on public.faq_reports;
create trigger trg_faq_report_touch before update on public.faq_reports
  for each row execute function public.touch_updated_at();

-- Per-voter row so we never double-count even if the same device posts twice.
-- We don't expose this table to anon — faq_vote() does the increment via RPC
-- and returns the new totals only.
create table if not exists public.faq_report_votes (
  report_id   uuid not null references public.faq_reports(id) on delete cascade,
  voter       text not null,              -- client-provided anon id (uuid stored in localStorage)
  side        text not null check (side in ('agree','disagree')),
  created_at  timestamptz not null default now(),
  primary key (report_id, voter)
);

create index if not exists faq_report_votes_report_idx on public.faq_report_votes (report_id);

-- ---------------------------------------------------------------------------
-- Atomic vote: UPSERT (report_id, voter) and return the new totals. If the
-- report is no longer open, returns NULL so the Edge Function can 4xx with a
-- useful message ("That report is no longer open.") — mirrors endorse_flag().
-- ---------------------------------------------------------------------------
create or replace function public.faq_vote(p_id uuid, p_voter text, p_side text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  a int; d int;
begin
  if p_id is null then return null; end if;
  if p_voter is null or length(p_voter) < 6 or length(p_voter) > 64 then return null; end if;
  if p_side not in ('agree','disagree') then return null; end if;

  -- Block votes on reports that are no longer open (mirrors endorse_flag's
  -- "where id = flag_id and status = 'open'" guard).
  if not exists (select 1 from public.faq_reports where id = p_id and status = 'open') then
    return null;
  end if;

  insert into public.faq_report_votes (report_id, voter, side)
    values (p_id, p_voter, p_side)
    on conflict (report_id, voter) do update set side = excluded.side;

  select
    count(*) filter (where side = 'agree')::int,
    count(*) filter (where side = 'disagree')::int
    into a, d
    from public.faq_report_votes
    where report_id = p_id;

  -- Mirror the new totals into faq_reports for the public SELECT (avoids a
  -- join on every read).
  update public.faq_reports set agree = a, disagree = d where id = p_id;

  return json_build_object('agree', a, 'disagree', d);
end;
$$;

grant execute on function public.faq_vote(uuid, text, text) to anon, authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.faq_reports enable row level security;
alter table public.faq_report_votes enable row level security;

-- Anon + authenticated may SELECT only OPEN reports (or everything if admin).
drop policy if exists faq_reports_public_read_open on public.faq_reports;
create policy faq_reports_public_read_open on public.faq_reports
  for select to anon, authenticated
  using (status = 'open' or public.is_admin());

-- Admin may SELECT / INSERT / UPDATE / DELETE everything.
drop policy if exists faq_reports_admin_write on public.faq_reports;
create policy faq_reports_admin_write on public.faq_reports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Votes are admin-only — anon interaction goes through faq_vote() RPC.
drop policy if exists faq_report_votes_admin on public.faq_report_votes;
create policy faq_report_votes_admin on public.faq_report_votes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE. After this migration runs, deploy the updated `submit` Edge Function
-- which adds action:"faq_report" and action:"faq_vote". The page change
-- (faq.html reading SUPABASE_URL + /functions/v1/submit) is a separate PR.
-- ============================================================================