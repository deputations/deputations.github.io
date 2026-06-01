-- ============================================================================
-- Migration 0005: vacancy_flags — community-reported issues on vacancies
--
-- A reader who spots a problem with a published vacancy (broken/wrong link,
-- wrong pay level, already-closed, wrong location, duplicate, …) files a flag.
-- Others can ENDORSE an existing flag ("me too") instead of re-reporting, so
-- the same issue isn't logged many times. Admins review flags on the
-- admin-ingest console and fix the vacancy manually, marking the flag
-- approved (valid) or dismissed (invalid).
--
-- Writes happen ONLY through the `submit` Edge Function (service role); the
-- anon/public role may read open flags (to show + endorse them) but cannot
-- write directly. Mirrors the vacancies / feedback security model.
-- ============================================================================

create table if not exists public.vacancy_flags (
  id              uuid primary key default gen_random_uuid(),

  vacancy_id      text not null,            -- public Vacancy_ID being flagged
  field           text,                     -- which part: 'official_notification_link'
                                            -- | 'application_form_link' | 'level'
                                            -- | 'last_date_to_apply' | 'location'
                                            -- | 'post_name' | 'whole' | 'other'
  issue_type      text not null,            -- 'broken_link' | 'wrong_link'
                                            -- | 'wrong_pay_level' | 'wrong_deadline'
                                            -- | 'closed_already' | 'wrong_location'
                                            -- | 'duplicate' | 'other'
  note            text,                     -- free-text detail (capped in the function)
  suggested_value text,                     -- the reporter's proposed correction

  endorsements    int  not null default 0,  -- community "me too" count
  reporter_name   text,                     -- optional
  reporter_email  text,                     -- optional

  status          text not null default 'open'
                    check (status in ('open','approved','dismissed')),
  admin_note      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists vacancy_flags_vid_idx    on public.vacancy_flags (vacancy_id);
create index if not exists vacancy_flags_status_idx  on public.vacancy_flags (status);

-- keep updated_at fresh (reuses the helper defined in 0001)
drop trigger if exists trg_flag_touch on public.vacancy_flags;
create trigger trg_flag_touch before update on public.vacancy_flags
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic endorsement increment. SECURITY DEFINER so the Edge Function (service
-- role) can call it; only bumps OPEN flags and returns the new count.
-- ---------------------------------------------------------------------------
create or replace function public.endorse_flag(flag_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update public.vacancy_flags
     set endorsements = endorsements + 1
   where id = flag_id and status = 'open'
  returning endorsements;
$$;

-- ============================================================================
-- Row Level Security
--   • anon / authenticated  → may SELECT only OPEN flags (to list + endorse).
--   • admin (in admins table) → full read/write.
--   • service_role (Edge Function) → bypasses RLS automatically.
-- ============================================================================
alter table public.vacancy_flags enable row level security;

drop policy if exists flags_public_read_open on public.vacancy_flags;
create policy flags_public_read_open on public.vacancy_flags
  for select to anon, authenticated
  using (status = 'open' or public.is_admin());

drop policy if exists flags_admin_write on public.vacancy_flags;
create policy flags_admin_write on public.vacancy_flags
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE. Next: redeploy the `submit` Edge Function (adds action:flag /
-- action:endorse). The public modal lists open flags and lets readers endorse;
-- the admin console reviews them.
-- ============================================================================
