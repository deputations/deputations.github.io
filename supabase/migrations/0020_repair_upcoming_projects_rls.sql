-- 0020_repair_upcoming_projects_rls.sql
-- Re-assert the RLS policies on public.upcoming_projects.
--
-- Symptom that led here: in the admin Projects tab, ▲▼ / Publish / Unpublish /
-- Edit appeared to do nothing at all, while the list still rendered fine.
--
-- That shape points at the write policy specifically, because READ has a second
-- route: `up_public_read` allows anon to see any published row, so the list
-- renders whether or not the session is recognised as an admin. Only the writes
-- depend on `up_admin_write`.
--
-- An UPDATE that RLS filters out is NOT an error — PostgREST reports 204 and
-- zero rows changed, which the admin UI used to treat as success (fixed in
-- v7.4.4: it now asks for the row back and fails loudly when nothing changed).
--
-- Diagnose first — run this and see what comes back:
--
--   select policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'public' and tablename = 'upcoming_projects';
--
-- Expect exactly two: up_public_read (SELECT) and up_admin_write (ALL). If
-- up_admin_write is missing, that is the bug and the block below restores it.
--
-- Also confirm the signed-in admin is on the allow-list — is_admin() matches
-- the JWT email against public.admins, case-insensitively:
--
--   select email from public.admins;
--
-- If your address is absent:
--   insert into public.admins (email) values ('you@example.com');
--
-- Idempotent: drop-then-create, identical to migration 0013. Safe to re-run.

alter table public.upcoming_projects enable row level security;

drop policy if exists up_public_read on public.upcoming_projects;
create policy up_public_read on public.upcoming_projects
  for select to anon, authenticated
  using (is_published = true or public.is_admin());

drop policy if exists up_admin_write on public.upcoming_projects;
create policy up_admin_write on public.upcoming_projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
