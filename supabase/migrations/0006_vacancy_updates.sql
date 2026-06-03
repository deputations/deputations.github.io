-- ============================================================================
-- Migration 0006: smart duplicate-merge on ingest
--
-- Two pieces:
--   1. match_key — a generated key like dedup_key but WITHOUT notification_date
--      (organisation | post | city | pay-level). Lets ingest find the "same"
--      vacancy across sources/cycles even when the date differs, for a
--      hybrid match: exact (dedup_key) → auto-merge; loose (match_key only) →
--      a possible-duplicate suggestion an admin resolves.
--   2. vacancy_updates — pending merges into already-approved (live) rows and
--      possible-duplicate suggestions, reviewed on the admin console before
--      they touch live data. Mirrors the vacancy_flags security model.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Loose match key (same normalisation as dedup_key in 0002, minus the date)
-- ---------------------------------------------------------------------------
alter table public.vacancies drop column if exists match_key;
alter table public.vacancies
  add column match_key text generated always as (
    lower(
      btrim(regexp_replace(coalesce(organisation, ''), '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(post_name, ''),    '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(location_city, ''),'[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      regexp_replace(coalesce(level, ''), '[^0-9]', '', 'g')
    )
  ) stored;

create index if not exists vacancies_match_key_idx on public.vacancies (match_key);

-- ---------------------------------------------------------------------------
-- 2. Pending updates / duplicate suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.vacancy_updates (
  id                 uuid primary key default gen_random_uuid(),

  target_id          uuid not null
                       references public.vacancies(id) on delete cascade,
  kind               text not null
                       check (kind in ('update','duplicate')),
  -- 'update'    → exact match on an APPROVED row; `proposed` is the merged record.
  -- 'duplicate' → loose match only (different date); `proposed` is the incoming
  --               candidate; admin picks merge-into-existing vs create-as-new.
  proposed           jsonb not null,         -- full row to write on apply
  diff               jsonb,                  -- {field:{old,new}} for display

  source_type        text,
  source_category    text,
  source_file_url    text,
  confidence         text,
  ingest_job_id      uuid,

  status             text not null default 'pending'
                       check (status in ('pending','applied','discarded')),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists vacancy_updates_target_idx on public.vacancy_updates (target_id);
create index if not exists vacancy_updates_status_idx on public.vacancy_updates (status);

-- keep updated_at fresh (reuses the helper defined in 0001)
drop trigger if exists trg_vac_update_touch on public.vacancy_updates;
create trigger trg_vac_update_touch before update on public.vacancy_updates
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security — admin-only (these are internal review artifacts).
--   • anon / authenticated (non-admin) → no access.
--   • admin (in admins table)          → full read/write.
--   • service_role (extract function)  → bypasses RLS automatically (inserts).
-- ============================================================================
alter table public.vacancy_updates enable row level security;

drop policy if exists vac_updates_admin_all on public.vacancy_updates;
create policy vac_updates_admin_all on public.vacancy_updates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE. Next: redeploy the `extract` Edge Function (batched match/merge) and
-- ship the admin-ingest "Updates" tab.
-- ============================================================================
