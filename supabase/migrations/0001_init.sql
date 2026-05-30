-- ============================================================================
-- deputations.github.io — vacancies ingestion pipeline
-- Migration 0001: schema, RLS, storage
--
-- Run this in Supabase Studio → SQL Editor (or `supabase db push`).
-- Idempotent-ish: safe to re-run on a fresh project.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Admin allow-list. Only emails in this table can ingest / review / approve.
-- Add yourself:  insert into admins(email) values ('you@example.com');
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);

-- Helper: is the current authenticated user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------------
-- ingest_jobs — one row per upload (an EN issue, a notification PDF, a URL).
-- Lets the review UI group "all drafts that came from this source".
-- ---------------------------------------------------------------------------
create table if not exists public.ingest_jobs (
  id              uuid primary key default gen_random_uuid(),
  source_type     text not null check (source_type in ('employment_news','notification','url')),
  source_file_url text,            -- signed/Storage path of the uploaded PDF (if any)
  source_url      text,            -- the URL the admin pasted (if source_type='url')
  source_label    text,            -- human label, e.g. "Employment News 28 Mar 2026"
  status          text not null default 'pending'
                    check (status in ('pending','processing','done','error')),
  rows_extracted  int  not null default 0,
  error           text,
  created_by      text,            -- admin email
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vacancies — the dataset. Column names are snake_case (Postgres convention);
-- the frontend enrich.js maps them to the Title_Case keys app.js expects.
-- Stays well under 5,000 rows; expired rows retire automatically by date.
-- ---------------------------------------------------------------------------
create table if not exists public.vacancies (
  id                       uuid primary key default gen_random_uuid(),

  -- ---- core fields (mirror the existing JSON schema) ----
  vacancy_id               text,
  ministry                 text,
  min_code                 text,
  department               text,
  organisation             text,
  organisation_type        text,
  post_name                text,
  level                    text,
  level_text               text,
  location_city            text,
  location_state           text,
  region                   text,
  req_level1               text,
  min_years_experience     text,
  req_level2               text,
  min_years_experience2    text,
  tags_keywords            text,
  eligible_service         text,
  essential_qualification  text,
  no_of_posts              text,
  deputation_period_years  text,
  deputation_type          text,
  notification_date        text,   -- ISO 'YYYY-MM-DD' (kept as text to match current data)
  last_date_to_apply       text,   -- ISO 'YYYY-MM-DD'
  official_notification_link text,
  application_form_link    text,
  source_website           text,
  functional_area          text,
  mode_of_application       text,

  -- ---- pipeline / provenance fields ----
  status                   text not null default 'draft'
                             check (status in ('draft','approved','rejected')),
  confidence               text,            -- model-reported: high|medium|low
  source_type              text,            -- employment_news|notification|url
  source_category          text,            -- e.g. "Employment News 28 Mar 2026"
  source_file_url          text,            -- link to the source PDF in Storage
  ingest_job_id            uuid references public.ingest_jobs(id) on delete set null,
  raw_extraction           jsonb,           -- exact model output, for audit
  reviewer_notes           text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists vacancies_status_idx     on public.vacancies (status);
create index if not exists vacancies_job_idx         on public.vacancies (ingest_job_id);
create index if not exists vacancies_lastdate_idx    on public.vacancies (last_date_to_apply);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_vac_touch on public.vacancies;
create trigger trg_vac_touch before update on public.vacancies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_job_touch on public.ingest_jobs;
create trigger trg_job_touch before update on public.ingest_jobs
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security
--   • public/anon  → may SELECT only approved vacancies. Nothing else.
--   • admin (authed, in admins table) → full read/write on both tables.
--   • service_role (Edge Function) → bypasses RLS automatically.
-- ============================================================================
alter table public.vacancies   enable row level security;
alter table public.ingest_jobs enable row level security;
alter table public.admins      enable row level security;

-- vacancies: public read of approved rows only
drop policy if exists vac_public_read_approved on public.vacancies;
create policy vac_public_read_approved on public.vacancies
  for select to anon, authenticated
  using (status = 'approved' or public.is_admin());

-- vacancies: admin full write
drop policy if exists vac_admin_write on public.vacancies;
create policy vac_admin_write on public.vacancies
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ingest_jobs: admin only (no public read)
drop policy if exists job_admin_all on public.ingest_jobs;
create policy job_admin_all on public.ingest_jobs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admins: a logged-in user may read the table only to check their own row
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

-- ============================================================================
-- Storage bucket for uploaded source PDFs (private).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;

-- admins may upload/read/delete in the 'sources' bucket
drop policy if exists sources_admin_all on storage.objects;
create policy sources_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'sources' and public.is_admin())
  with check (bucket_id = 'sources' and public.is_admin());

-- ============================================================================
-- DONE. Next: add yourself as admin, e.g.
--   insert into public.admins(email) values ('deputations.goi@gmail.com');
-- ============================================================================
