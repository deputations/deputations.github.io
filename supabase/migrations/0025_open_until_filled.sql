-- 0025_open_until_filled.sql
-- Vacancies whose notification sets no last date — applications stay open
-- until the posts are filled.
--
-- The site needs a last_date_to_apply to treat a vacancy as open (Active
-- filter, counts, sorting), but a placeholder date must not read as a real
-- deadline. So:
--   * open_until_filled = true marks the row;
--   * last_date_to_apply holds an indicative date (31 Dec 2026 here);
--   * the website shows it as "31 Dec 2026*" with "Open till filled*" instead
--     of a countdown, and the vacancy's detail view explains the asterisk and
--     links the source notification.
--
-- First use: the Goods and Services Tax Appellate Tribunal (GSTAT) deputation
-- notification (https://dor.gov.in/files/inline-documents/GSTAT.pdf, notified
-- 14 Aug 2025) — 224 approved posts with no closing date, plus one already
-- given 31 Dec 2026 by hand; all open until filled.
--
-- Safe to re-run. Run once in Supabase → SQL Editor (or `supabase db push`);
-- the change reaches the site with the next "Build deputation data" run.

alter table public.vacancies
  add column if not exists open_until_filled boolean not null default false;

update public.vacancies
   set open_until_filled  = true,
       last_date_to_apply = '2026-12-31'
 where status <> 'rejected'
   and official_notification_link = 'https://dor.gov.in/files/inline-documents/GSTAT.pdf'
   and (coalesce(last_date_to_apply, '') = ''
        -- one GSTAT post was already given this placeholder by hand
        or last_date_to_apply = '2026-12-31');

-- Check: expect the GSTAT posts (225 approved at the time of writing).
-- select status, count(*) from public.vacancies
--  where open_until_filled group by status;
--
-- Later, to mark another "open until filled" vacancy:
-- update public.vacancies
--    set open_until_filled = true, last_date_to_apply = '2026-12-31'
--  where vacancy_id = '<ID>';
