-- ============================================================================
-- V² (V Square) company roadmap
-- Migration 0013: upcoming_projects — the cards shown on upcoming-projects.html,
-- managed from the admin console ("🚀 Projects" tab).
--
-- Run this in Supabase Studio → SQL Editor.  Idempotent-ish.
-- The public page reads published rows with the anon key; only an admin
-- (email in public.admins) can add / edit / delete, via the same is_admin()
-- RLS pattern used by public.vacancies (see 0001_init.sql).
-- ============================================================================

create table if not exists public.upcoming_projects (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,             -- stable vote key "project:<slug>"; don't change once live
  title        text not null,
  blurb        text,
  status       text not null default 'concept'
                 check (status in ('concept','design','planned')),
  tags         text[] not null default '{}',     -- short chips
  icon         text,                             -- placeholder-art glyph key (bell, calculator, users, folder, file, spark)
  image_url    text,                             -- optional hosted image; falls back to gradient + icon art
  sort_order   int  not null default 0,          -- ascending; lower shows first
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists upcoming_projects_pub_idx
  on public.upcoming_projects (is_published, sort_order);

-- keep updated_at fresh (touch_updated_at() defined in 0001)
drop trigger if exists trg_upcoming_touch on public.upcoming_projects;
create trigger trg_upcoming_touch before update on public.upcoming_projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   • anon / authenticated → SELECT published rows only (admin sees all)
--   • admin (authed, in admins table) → full read/write
--   • service_role → bypasses RLS automatically
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Seed: editable starters. Slugs match the page's previous hardcoded ideas so
-- any existing project:<slug> votes carry over, plus the V² PDF Reader.
-- Edit / add / remove these from the admin Projects tab.
-- ---------------------------------------------------------------------------
insert into public.upcoming_projects (slug, title, blurb, status, tags, icon, sort_order) values
  ('v2-pdf-reader', 'V² PDF Reader',
   'A fast, distraction-free Windows PDF reader from V² — read, annotate, edit, convert and protect documents in one clean, modern workspace.',
   'design', ARRAY['Desktop','Windows','Productivity'], 'file', 10),
  ('health-fitness', 'Health & Fitness App',
   'Health isn''t the same as fitness — you can look great while your blood report flags low Vitamin D, low B12 or high triglycerides. Upload that report and AI turns the correctable red markers into a time-boxed, clinician-reviewable protocol — supplements, diet and lifestyle tweaks — with reminders and one-tap logging, then prompts a re-test that proves your numbers came back to normal: a plan you''ll actually finish, with proof it worked. Once your health is on track it expands into a full fitness layer — gym and diet plans for your goal (bulk, cut, lose 15 kg), built around the equipment you actually have.',
   'concept', ARRAY['Blood report → plan','Retest proof','Reminders & logging','Workouts & diet'], 'pulse', 15),
  ('deputation-alerts', 'Deputation Alert Bot',
   'Get an instant ping the moment a vacancy matches your pay level, ministry and location preferences — on WhatsApp or Telegram — so you never miss a closing date.',
   'design', ARRAY['Alerts','WhatsApp / Telegram','Automation'], 'bell', 20),
  ('pay-pension-estimator', 'Pay & Pension Estimator',
   'Model how a deputation move changes your take-home — deputation (duty) allowance, pay protection, HRA — and a rough pension impact, all before you apply.',
   'concept', ARRAY['Calculator','7th CPC','Finance'], 'calculator', 30),
  ('cadre-connect', 'Cadre Connect',
   'An anonymous space to ask officers who''ve actually been on deputation to a ministry or CCA what it''s really like — vigilance, NOC, workload, and coming back to the parent cadre.',
   'planned', ARRAY['Community','Mentorship','Q&A'], 'users', 40),
  ('document-vault', 'Document Vault & Reminders',
   'A private checklist for the paperwork deputation needs — NOC, vigilance clearance, APAR dossiers, cadre clearance — with deadline reminders so nothing stalls your application.',
   'concept', ARRAY['Tracker','Documents','Reminders'], 'folder', 50)
on conflict (slug) do nothing;

-- ============================================================================
-- DONE.  The admin Projects tab and the public page work against this table.
-- ============================================================================
