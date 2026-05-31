-- ============================================================================
-- Migration 0004: eligibility_tiers (level + years-of-experience)
--
-- A deputation post is open to officers from one or more feeder grades, each
-- with its own minimum service. The legacy schema stored at most two flat
-- tiers (req_level1/min_years_experience + req_level2/min_years_experience2).
-- This migration adds a single jsonb column that holds an unbounded list:
--
--   eligibility_tiers = [
--     { "level": 11, "min_years": 0 },   -- analogous grade
--     { "level": 10, "min_years": 3 },
--     { "level": 8,  "min_years": 5 }
--   ]
--
-- The legacy columns are kept (the frontend enrich.js still backfills tiers
-- from them when eligibility_tiers is empty), so this change is additive and
-- safe to run on a live table.
-- ============================================================================

alter table public.vacancies
  add column if not exists eligibility_tiers jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Backfill existing rows from the legacy flat columns.
-- Only touches rows that don't already have tiers, so it's idempotent.
-- Builds 0–2 tiers, dropping any with a null/non-numeric level, and coercing
-- a missing/blank min_years to 0.
-- ---------------------------------------------------------------------------
update public.vacancies v
set eligibility_tiers = sub.tiers
from (
  select
    id,
    coalesce(
      jsonb_agg(t.tier order by t.lvl desc) filter (where t.tier is not null),
      '[]'::jsonb
    ) as tiers
  from public.vacancies
  cross join lateral (
    values
      (
        nullif(regexp_replace(coalesce(req_level1, ''), '\D', '', 'g'), ''),
        nullif(regexp_replace(coalesce(min_years_experience, ''), '\D', '', 'g'), '')
      ),
      (
        nullif(regexp_replace(coalesce(req_level2, ''), '\D', '', 'g'), ''),
        nullif(regexp_replace(coalesce(min_years_experience2, ''), '\D', '', 'g'), '')
      )
  ) as raw(lvl_text, yrs_text)
  cross join lateral (
    select
      (raw.lvl_text)::int as lvl,
      case
        when raw.lvl_text is null then null
        else jsonb_build_object(
          'level', (raw.lvl_text)::int,
          'min_years', coalesce((raw.yrs_text)::int, 0)
        )
      end as tier
  ) as t
  group by id
) as sub
where v.id = sub.id
  and (v.eligibility_tiers is null or v.eligibility_tiers = '[]'::jsonb);

-- Optional GIN index — handy if we later query "posts open to level N" in SQL.
create index if not exists vacancies_elig_tiers_idx
  on public.vacancies using gin (eligibility_tiers);

-- ============================================================================
-- DONE. New ingestion (extract Edge Function / admin grid / report form) will
-- populate eligibility_tiers directly in a later phase; until then the legacy
-- req_level* columns remain the write path and the frontend derives tiers.
-- ============================================================================
