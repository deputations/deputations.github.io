-- ============================================================================
-- Migration 0011: discrete page pointer + admin triage status on feedback.
--   page / page_label : machine-readable page the feedback is about, plus the
--                       human label (the contact form now asks "which page?").
--                       related_page (the composed string) is left untouched.
--   status            : 'new' | 'resolved' — lets the admin Feedback tab triage,
--                       mirroring the vacancy_flags open/resolved lifecycle.
-- The existing feedback_admin_read policy (0003) already covers reading the new
-- columns; inserts remain service-role via the Edge Function. Admins also need
-- UPDATE to mark items resolved / re-open.
-- ============================================================================
alter table public.feedback add column if not exists page       text;
alter table public.feedback add column if not exists page_label text;
alter table public.feedback add column if not exists status     text not null default 'new';

-- Index the triage status: the Feedback tab's default view and badge filter on
-- status = 'new', and most rows will end up 'resolved'.
create index if not exists feedback_status_idx
  on public.feedback (status) where status = 'new';

-- Admins may update (mark resolved / re-open); reads already allowed via 0003.
drop policy if exists feedback_admin_write on public.feedback;
create policy feedback_admin_write on public.feedback
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
