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
      jsonb_agg(jsonb_build_object('level', lvl, 'min_years', yrs) order by lvl desc),
      '[]'::jsonb
    ) as tiers
  from (
    -- one row per (id, distinct level), keeping the smallest min_years
    select id, lvl, min(yrs) as yrs
    from (
      select id,
             nullif(regexp_replace(coalesce(req_level1, ''), '\D', '', 'g'), '')::int as lvl,
             coalesce(nullif(regexp_replace(coalesce(min_years_experience, ''), '\D', '', 'g'), '')::int, 0) as yrs
      from public.vacancies
      union all
      select id,
             nullif(regexp_replace(coalesce(req_level2, ''), '\D', '', 'g'), '')::int as lvl,
             coalesce(nullif(regexp_replace(coalesce(min_years_experience2, ''), '\D', '', 'g'), '')::int, 0) as yrs
      from public.vacancies
    ) raw
    where lvl is not null
    group by id, lvl
  ) d
  group by id
) as sub
where v.id = sub.id
  and (v.eligibility_tiers is null or v.eligibility_tiers = '[]'::jsonb);

-- ---------------------------------------------------------------------------
-- Clean up any rows already backfilled with duplicate-level tiers (e.g. a
-- post whose req_level1 = req_level2). Deduplicates the stored jsonb in place,
-- keeping the lowest min_years per level. Safe & idempotent: rows with no
-- duplicates are rewritten to the identical value; manual 3+ tier edits are
-- preserved because it reads the existing array, not the legacy columns.
-- ---------------------------------------------------------------------------
update public.vacancies v
set eligibility_tiers = sub.tiers
from (
  select id,
         coalesce(
           jsonb_agg(jsonb_build_object('level', lvl, 'min_years', yrs) order by lvl desc),
           '[]'::jsonb
         ) as tiers
  from (
    select id,
           (elem->>'level')::int as lvl,
           min((elem->>'min_years')::int) as yrs
    from public.vacancies,
         lateral jsonb_array_elements(eligibility_tiers) as elem
    where jsonb_typeof(eligibility_tiers) = 'array'
      and (elem->>'level') ~ '^\d+$'
    group by id, (elem->>'level')::int
  ) d
  group by id
) as sub
where v.id = sub.id
  and jsonb_typeof(v.eligibility_tiers) = 'array'
  and jsonb_array_length(v.eligibility_tiers) > 0;

-- Optional GIN index — handy if we later query "posts open to level N" in SQL.
create index if not exists vacancies_elig_tiers_idx
  on public.vacancies using gin (eligibility_tiers);

-- ============================================================================
-- DONE. New ingestion (extract Edge Function / admin grid / report form) will
-- populate eligibility_tiers directly in a later phase; until then the legacy
-- req_level* columns remain the write path and the frontend derives tiers.
-- ============================================================================
