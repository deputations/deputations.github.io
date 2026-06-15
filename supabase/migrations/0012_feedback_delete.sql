-- ============================================================================
-- Migration 0012: allow admins to DELETE feedback rows.
--
-- The Feedback tab's "Delete" button issues a DELETE on public.feedback. 0003
-- granted admins SELECT and 0011 granted UPDATE, but no DELETE policy ever
-- existed — so with RLS enabled the delete matched zero rows: PostgREST returned
-- 204 (apparent success) while the row silently survived, reappearing on reload.
-- This adds the missing admin DELETE policy, mirroring feedback_admin_write.
-- ============================================================================
drop policy if exists feedback_admin_delete on public.feedback;
create policy feedback_admin_delete on public.feedback
  for delete to authenticated using (public.is_admin());
