-- ============================================================================
-- Migration 0008: make dedup_key / match_key 13A-aware
--
-- The GoI pay matrix has the exceptional level "13A" (between 13 and 14).
-- The generated keys from 0002 (dedup_key) and 0006 (match_key) normalised the
-- level with regexp_replace(level, '[^0-9]') — so a Level-13 post and a
-- Level-13A post with the same org/name/city/date collided into one key and
-- the second silently merged into the first.
--
-- This recreates both keys keeping the A (lowercased inside the existing
-- lower() wrapper):   regexp_replace(level, '[^0-9Aa]', '', 'g')
-- The client mirrors this exactly (normLevel in admin-ingest.js and
-- extract/index.ts) — keep them byte-identical if either ever changes.
--
-- Safe: the new normalisation is strictly more discriminating, so existing
-- unique keys stay unique (if two new keys were equal, stripping the A would
-- make the old keys equal too — impossible under the old unique constraint).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. dedup_key (from 0002): org | post | city | level | notification_date
-- ---------------------------------------------------------------------------
alter table public.vacancies drop constraint if exists vac_dedup_uniq;
alter table public.vacancies drop column if exists dedup_key;
alter table public.vacancies
  add column dedup_key text generated always as (
    lower(
      btrim(regexp_replace(coalesce(organisation, ''), '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(post_name, ''),    '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(location_city, ''),'[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      regexp_replace(coalesce(level, ''), '[^0-9Aa]', '', 'g') || '|' ||
      coalesce(notification_date, '')
    )
  ) stored;

alter table public.vacancies add constraint vac_dedup_uniq unique (dedup_key);

-- ---------------------------------------------------------------------------
-- 2. match_key (from 0006): same, minus the date
-- ---------------------------------------------------------------------------
alter table public.vacancies drop column if exists match_key;
alter table public.vacancies
  add column match_key text generated always as (
    lower(
      btrim(regexp_replace(coalesce(organisation, ''), '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(post_name, ''),    '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(location_city, ''),'[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      regexp_replace(coalesce(level, ''), '[^0-9Aa]', '', 'g')
    )
  ) stored;

create index if not exists vacancies_match_key_idx on public.vacancies (match_key);

-- ============================================================================
-- DONE. Deploy order: run this BEFORE (or together with) redeploying the
-- extract/submit Edge Functions, whose client-side key replication now keeps
-- the A as well.
-- ============================================================================
