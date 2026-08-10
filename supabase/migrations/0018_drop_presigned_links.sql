-- 0018_drop_presigned_links.sql
-- Clear pre-signed S3 links out of the vacancy data.
--
-- Eleven MMRCL notification links were stored as AWS pre-signed URLs, e.g.
--   https://mmrcl-private.s3.amazonaws.com/…/Assistant_Manager_Architect.pdf
--     ?X-Amz-Algorithm=…&X-Amz-Credential=AKIA…&X-Amz-Expires=10800&X-Amz-Signature=…
--
-- Two problems, either one sufficient on its own:
--
--   1. They are dead. `X-Amz-Expires=10800` is a three-hour window, and these
--      were signed on 2026-06-13 — they stopped working the same afternoon.
--      The bucket is private, so trimming the query string leaves a 403 rather
--      than a usable link. There is nothing to salvage.
--
--   2. They break the publishing pipeline. GitHub push protection reads the
--      embedded `AKIA…` as a leaked AWS key and REJECTS the data commit, so a
--      single such link stops EVERY future data build from publishing. On
--      2026-08-10 that silently froze the dataset: the workflow's push retries
--      swallowed the rejection and the run still reported success.
--
-- The key ID belongs to the publishing organisation, not to us, and an access
-- key ID is not usable on its own (the secret half never appears in the URL).
-- No credential of ours is exposed. Clearing these is about serving working
-- links and keeping the dataset publishable.
--
-- `scripts/build_data.py` now also strips pre-signed links at build time, so a
-- fresh one arriving tomorrow cannot wedge the pipeline again. This migration
-- fixes the stored rows so the admin UI stops showing dead links too.
--
-- Idempotent: re-running matches nothing once the links are cleared.

update public.vacancies
   set official_notification_link = null
 where official_notification_link ilike '%X-Amz-Signature=%'
    or official_notification_link ilike '%X-Amz-Credential=%';

update public.vacancies
   set application_form_link = null
 where application_form_link ilike '%X-Amz-Signature=%'
    or application_form_link ilike '%X-Amz-Credential=%';

-- Verify: both counts should be 0 afterwards.
-- select count(*) from public.vacancies
--  where official_notification_link ilike '%X-Amz-%'
--     or application_form_link ilike '%X-Amz-%';
