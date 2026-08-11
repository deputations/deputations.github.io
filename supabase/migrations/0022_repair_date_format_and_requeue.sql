-- 0022_repair_date_format_and_requeue.sql
-- Two distinct data-quality issues surfaced by the 2026-08-11 audit:
--
-- 1) 17 approved rows have notification_date stored as 'DD-MM-YYYY' text
--    (e.g. '30-05-2026') instead of the canonical 'YYYY-MM-DD'. PostgreSQL
--    accepted it because notification_date is text, not date. The
--    "last_date_to_apply < notification_date" comparison then matched via
--    string sort and they appeared deviant — but the fix is just a format
--    conversion, not a real date inversion.
--
--    Confirmed by manual review: 14 CAFAP-2026-L7-* rows all came from the
--    same bulk-paste session (one form submission, one copy-paste mistake),
--    plus E-2026-L10-019 with the same pattern.
--
-- 2) 22 approved rows have last_date_to_apply = NULL. The admin entered a
--    notification date but left the closing date blank. These need a human
--    to fill in from the source PDF.
--
-- Auto-fix (1) and re-queue (2) the same way 0021 did.
--
-- 0021 covers 6 day/month-swapped rows that were already in
-- data/vacancies.json. None of these 39 IDs overlap with 0021.
--
-- Pre-condition: 0017_admin_verified.sql has run (admin_verified, verified_at
-- exist). 0021 has run for the 6 day/month-swap rows.

-- ─── 1. Normalise DD-MM-YYYY notification_date to ISO date ──────────────────
update public.vacancies
   set notification_date = to_char(
         to_date(notification_date, 'DD-MM-YYYY'),
         'YYYY-MM-DD'
       )
 where status = 'approved'
   and notification_date ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$'
   and vacancy_id in (
     'CAFAP-2026-L7-072',
     'CAFAP-2026-L7-074',
     'CAFAP-2026-L7-075',
     'CAFAP-2026-L7-076',
     'CAFAP-2026-L7-077',
     'CAFAP-2026-L7-078',
     'CAFAP-2026-L7-079',
     'CAFAP-2026-L7-080',
     'CAFAP-2026-L7-081',
     'CAFAP-2026-L7-082',
     'CAFAP-2026-L7-083',
     'CAFAP-2026-L7-084',
     'CAFAP-2026-L7-085',
     'CAFAP-2026-L7-086',
     'CAFAP-2026-L7-087',
     'CAFAP-2026-L7-088',
     'E-2026-L10-019'
   );

-- ─── 2. Re-queue the 22 rows with missing last_date_to_apply ────────────────
-- These show up in the admin Verify tab as "approved but not yet verified".
-- The admin re-enters the missing last date from the source PDF and verifies;
-- nothing else needs to change.
update public.vacancies
   set admin_verified = false,
       verified_at    = null
 where status = 'approved'
   and admin_verified = true
   and (last_date_to_apply is null or last_date_to_apply = '')
   and vacancy_id in (
     'A-2026-L6-0183',
     'C-2026-L2-079',
     'C-2026-L2-080',
     'CA-2026-L14-066',
     'DEP-2026-L2-0246',
     'EFACC-2026-LX-0252',
     'F-2026-L11-004',
     'F-2026-L13-003',
     'HA-2026-L10-0148',
     'HA-2026-L10-083',
     'HA-2026-L11-0123',
     'HA-2026-L13-093',
     'HA-2026-L14-0219',
     'HA-2026-L4-0153',
     'HA-2026-L6-0149',
     'HA-2026-L6-0150',
     'HA-2026-L6-0151',
     'HA-2026-L6-0152',
     'HA-2026-L7-082',
     'HA-2026-LX-0253',
     'IAB-2026-L7-036',
     'T-2026-L12-078'
   );

-- ─── 3. Re-queue the 17 day-format-fix rows ────────────────────────────────
-- They've been auto-corrected but the admin should still eyeball them before
-- they count as verified. The Verify tab is the canonical place for that.
update public.vacancies
   set admin_verified = false,
       verified_at    = null
 where status = 'approved'
   and admin_verified = true
   and vacancy_id in (
     'CAFAP-2026-L7-072',
     'CAFAP-2026-L7-074',
     'CAFAP-2026-L7-075',
     'CAFAP-2026-L7-076',
     'CAFAP-2026-L7-077',
     'CAFAP-2026-L7-078',
     'CAFAP-2026-L7-079',
     'CAFAP-2026-L7-080',
     'CAFAP-2026-L7-081',
     'CAFAP-2026-L7-082',
     'CAFAP-2026-L7-083',
     'CAFAP-2026-L7-084',
     'CAFAP-2026-L7-085',
     'CAFAP-2026-L7-086',
     'CAFAP-2026-L7-087',
     'CAFAP-2026-L7-088',
     'E-2026-L10-019'
   );
