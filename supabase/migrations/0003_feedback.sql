-- ============================================================================
-- Migration 0003: feedback table (public contact form → Supabase)
-- Written only by the service-role Edge Function `submit`; readable by admins.
-- ============================================================================
create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  category      text,
  subject       text,
  message       text,
  name          text,
  email         text,
  related_page  text,
  related_link  text,
  page_context  text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- only admins may read; nobody (anon/auth) may write directly — the Edge
-- Function inserts with the service role, which bypasses RLS.
drop policy if exists feedback_admin_read on public.feedback;
create policy feedback_admin_read on public.feedback
  for select to authenticated using (public.is_admin());
