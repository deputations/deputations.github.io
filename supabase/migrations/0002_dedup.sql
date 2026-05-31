-- ============================================================================
-- Migration 0002: hard duplicate guard for vacancies
-- A normalised, generated key (organisation | post | city | pay-level) with a
-- UNIQUE constraint, so the database itself can never store two identical
-- vacancies — regardless of which ingest path created them.
-- ============================================================================

-- key = organisation | post | city | pay-level | notification_date
-- (notification_date lets a genuine re-advertisement in a later cycle count as
-- new, while same-cycle duplicates — incl. deadline extensions — still merge.)
alter table public.vacancies drop constraint if exists vac_dedup_uniq;
alter table public.vacancies drop column if exists dedup_key;
alter table public.vacancies
  add column dedup_key text generated always as (
    lower(
      btrim(regexp_replace(coalesce(organisation, ''), '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(post_name, ''),    '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      btrim(regexp_replace(coalesce(location_city, ''),'[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
      regexp_replace(coalesce(level, ''), '[^0-9]', '', 'g') || '|' ||
      coalesce(notification_date, '')
    )
  ) stored;

alter table public.vacancies add constraint vac_dedup_uniq unique (dedup_key);
