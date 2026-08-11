-- 0021_requeue_date_deviants.sql
-- 6 vacancies have dates the auto-ingest could not disambiguate: 5 are
-- "which column is the inverted one" deadlocks (e.g. 4 May / 7 Apr — both
-- could be day/month-swapped, only the operator can tell from the source PDF),
-- and 1 (E-2026-L13-014) is so far out of order (303 days early) that no swap
-- recovers a sensible date. All 6 need a human to look at the original
-- notification and re-enter the correct pair.
--
-- The fix for the other 67 day/month-swapped rows was an in-place edit of
-- data/vacancies.json (the parsed ISO columns were inverted relative to the
-- source PDF; the *Display strings were also a derived field, not operator-
-- entered input, so they were re-derived from the corrected ISO). Those 67
-- stay admin_verified = true.
--
-- For these 6, we flip admin_verified back to false so they reappear in the
-- admin Verify tab (status='approved' AND admin_verified=false). The Verify
-- tab is the canonical place for "AI bulk-approved but a human still needs to
-- read this", which is exactly what these rows are now.
--
-- Why not just delete them? The rows are live and need dates repaired, not
-- removed. Re-verifying after fix is the same workflow as if they had just
-- been bulk-published.
--
-- Pre-condition: 0017_admin_verified.sql has already run (admin_verified,
-- verified_at columns exist).

update public.vacancies
   set admin_verified = false,
       verified_at    = null
 where status = 'approved'
   and admin_verified = true
   and vacancy_id in (
     'E-2026-L13-014',
     'HAFW-2026-L7-069',
     'JS-2026-L11-063',
     'JS-2026-L12-064',
     'JS-2026-L13-061',
     'JS-2026-L8-065'
   );
