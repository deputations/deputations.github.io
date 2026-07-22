-- ============================================================================
-- Web Push vacancy alerts (WEBSITE-REVIEW P1-3 / P1-4)
-- Migration 0014: push_subscriptions + push_log
--
-- Run in Supabase Studio -> SQL Editor.  Idempotent-ish.
--
-- No accounts: a subscription is keyed by the browser's opaque push endpoint.
-- ALL access is via service-role Edge Functions (push-subscribe writes here,
-- push-notify reads + sends), so there are NO anon policies — the tables are
-- invisible to the public anon key. Admins get read-only for debugging.
-- ============================================================================

create table if not exists public.push_subscriptions (
  endpoint    text primary key,               -- unique per browser+device; the opaque URL
  p256dh      text not null,                   -- subscription public key (encryption)
  auth        text not null,                   -- subscription auth secret
  pay_level   int,                             -- officer's pay level (from dep_profile_v1)
  ministries  text[] not null default '{}',    -- optional narrowing; empty = all ministries
  ua          text,                            -- coarse user-agent for debugging
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz                      -- last successful push (housekeeping)
);
create index if not exists push_subs_level_idx on public.push_subscriptions (pay_level);

-- One row per (subscription, vacancy) actually pushed — guarantees we never
-- notify the same device about the same vacancy twice, even across overlapping
-- daily runs.
create table if not exists public.push_log (
  endpoint    text not null,
  vacancy_id  text not null,
  sent_at     timestamptz not null default now(),
  primary key (endpoint, vacancy_id)
);
create index if not exists push_log_sent_idx on public.push_log (sent_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_log          enable row level security;

-- Admin-only read (debugging). Writes happen exclusively through the
-- service-role Edge Functions, which bypass RLS.
drop policy if exists push_subs_admin_read on public.push_subscriptions;
create policy push_subs_admin_read on public.push_subscriptions
  for select using (public.is_admin());

drop policy if exists push_log_admin_read on public.push_log;
create policy push_log_admin_read on public.push_log
  for select using (public.is_admin());
