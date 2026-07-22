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
  ('health-fitness', 'AI Health Companion App',
   'From blood reports to workouts, sleep, nutrition and recovery — your whole health journey in **one AI companion**. Your labs, daily habits and fitness goals usually live in apps that never talk to each other; this **connects them**. Upload a blood report and AI explains every abnormal marker in plain English and builds a personalised plan — lifestyle, nutrition, supplements, reminders — while also planning workouts, adapting when equipment isn''t available, and tracking sleep, hydration, activity and weight. The real innovation is **the link between them**: your labs shape your fitness plan, your habits shape your health plan, and the plan evolves automatically as you improve. Months later it prompts a fresh blood report and compares it with the last — showing exactly what changed, and **proving your effort worked**.',
   'concept', ARRAY['Blood reports → plan','Workouts & nutrition','Sleep & recovery','Retest proof'], 'pulse', 15),
  ('govtshaadi', 'GovtShaadi',
   'A matrimony platform built only for government professionals permanently based in Delhi. Most sites match on age, education, religion, community or horoscope, yet ignore what really decides long-term stability for serving officers: whether two careers can stay in the same city. In transferable services, couples are posted apart for years, straining housing, children and family support, and many officers value staying together over higher pay. GovtShaadi makes **career compatibility a primary matching factor**, not a stray profile field, for CSS, CSSS and Delhi Government services. Every profile is **fully identity-verified**, privacy is granular by design, and the service is **completely free**.',
   'concept', ARRAY['Career compatibility','Verified profiles','Delhi-based','Completely free'], 'heart', 16),
  ('govmarket', 'GovMarket',
   'A buy-and-sell marketplace open only to verified government employees. Ordinary classifieds are full of anonymous listings, payment scams and fraudsters who impersonate government and defence personnel to win trust. GovMarket removes that risk with a **verified, government-only community** where every member is who they claim to be. It is built for transfer season, when an outgoing officer can sell furniture and appliances to an incoming one, often in the same colony, so big items change hands locally instead of travelling hundreds of kilometres. You meet within familiar office premises or government quarters, making each deal **safer by default**, with no listing fees, commissions or subscriptions.',
   'concept', ARRAY['Verified members','Transfer season','Hyperlocal','Completely free'], 'tag', 17),
  ('govconnect', 'GovConnect',
   'A practical hyperlocal utility for the colony, complex or neighbourhood where government families actually live. Thousands share the same streets and nearby offices, yet rarely tap the help sitting a few doors away. GovConnect is built **only for verified government employees**, so you can find a reliable carpool partner, a trusted plumber, tutor or maid, and the local recommendations that usually take years to learn. Run lost-and-found, blood-donation requests, share-an-auto coordination and everyday logistics where **every exchange stays inside a verified community**. It is the working layer of neighbourhood life: who to call, what to share, how to get things done, and **completely free**.',
   'concept', ARRAY['Verified neighbours','Carpool & services','Hyperlocal','Completely free'], 'home', 18),
  ('officers-club', 'The Officers'' Club',
   'A social home for verified government officers and their families, organised as local chapters wherever you are posted. You can serve for decades and still barely know the colleagues in your own colony; this is the belonging that lifelong service was always meant to have. Join your **chapter** and find people nearby for badminton, cricket, cycling, trekking, book clubs, music evenings and festival celebrations. It is built **for families too**, with friendships between spouses, play groups for children and parents swapping school notes. Membership is exclusive, safe and verified, and **completely free**. Not another feed to scroll, but a real community to belong to.',
   'concept', ARRAY['Verified officers','Local chapter','Clubs & activities','Families too'], 'shield', 19),
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
