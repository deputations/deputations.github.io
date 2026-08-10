-- 0017_admin_verified.sql
-- Two-stage approval: "published" and "checked by a human" stop being the same
-- act.
--
-- Until now, approving a draft did both at once, so the only way to publish was
-- to read every row one by one. That made the queue the bottleneck. Bulk
-- approve now publishes WITHOUT claiming the row was eyeballed, and the new
-- Verify tab is where that second pass happens.
--
--   admin_verified = false  → live on the site, not yet checked (yellow)
--   admin_verified = true   → live and checked by an admin (green)
--
-- Only meaningful for status='approved'. Drafts and rejected rows carry the
-- default and are ignored.
--
-- Inherits the table's existing RLS (public read of approved rows, admin
-- write). The column is deliberately readable by anon: the public dashboard
-- shows a "pending verification" hint on unverified rows, so the flag has to
-- travel with the row.

alter table public.vacancies
  add column if not exists admin_verified boolean not null default false;

alter table public.vacancies
  add column if not exists verified_at timestamptz;

-- Grandfather everything already approved. Those rows were approved one at a
-- time under the old flow — which was exactly the careful path — so recording
-- them as verified is historically accurate, and it keeps the Verify queue
-- empty on day one instead of dumping the whole back catalogue into it.
--
-- Guarded by `verified_at is null` so re-running this migration can never
-- overwrite a real verification timestamp.
update public.vacancies
   set admin_verified = true,
       verified_at    = coalesce(verified_at, now())
 where status = 'approved'
   and admin_verified = false
   and verified_at is null;

-- The Verify tab's only query is "approved AND not yet verified". Partial
-- index because that set is small and drains over time, while the bulk of the
-- table is verified or draft.
create index if not exists vacancies_pending_verification_idx
  on public.vacancies (status, admin_verified)
  where status = 'approved' and admin_verified = false;
