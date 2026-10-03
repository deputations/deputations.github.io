-- 0024_unique_vacancy_id.sql
-- Make vacancies.vacancy_id unique — repair the existing duplicates, renumber
-- any future clash automatically, and enforce it with a unique index.
--
-- Why: vacancy_id is the public ID used in ?v= links, bookmarks, push alerts,
-- "Report an issue", link previews and AI search — but nothing kept it unique.
-- Both generators number rows by their position within ONE upload
-- (<ministry>-<year>-L<level>-<i+1>: supabase/functions/extract/index.ts and
-- admin-ingest.js mapPasted), so two uploads can mint the same ID. As of
-- 2026-10-03 two pairs had collided:
--   HAFW-2026-L11-046  Executive Engineer (AC and R) [expired] / Executive Engineer (Civil) [active]
--   AAFW-2026-L6-035   Office Superintendent / Stenographer Grade-I
-- and clicking or linking the active one opened the other.
--
-- Naming rule — identical to the website's disambiguateDuplicateIds() (app.js),
-- so every "<ID>~2" link the site handed out before this ran keeps opening the
-- same vacancy afterwards:
--   within a group sharing an ID, the row that keeps the plain ID is
--     1. approved (public) before draft/rejected,
--     2. then still open (last_date_to_apply >= today) before closed,
--     3. then the newest notification_date,
--     4. then the latest last_date_to_apply,
--     5. then the most recently created;
--   the rest become "<ID>~2", "<ID>~3", … in that order.
-- Going forward, a row inserted (or edited) with an ID another row already
-- has keeps the existing row's ID untouched and itself gets the next free
-- "<ID>~N" — so links already shared never change meaning.
--
-- Safe to re-run: the repair only touches IDs that are still duplicated, the
-- function/trigger are create-or-replace, the index is "if not exists".
-- No other table needs rewriting: vacancy_flags / push_log stay with the ID
-- that keeps its name, and vacancy_embeddings (keyed by vacancy_id) only holds
-- ACTIVE rows and is refreshed by the daily build's content-hash check.
--
-- Run once in Supabase → SQL Editor (or `supabase db push`).

-- ─── 1. Repair existing duplicates ──────────────────────────────────────────
do $$
declare
  grp  record;
  r    record;
  n    int;
  cand text;
  today text := to_char(current_date, 'YYYY-MM-DD');
begin
  for grp in
    select vacancy_id
      from public.vacancies
     where coalesce(vacancy_id, '') <> ''
     group by vacancy_id
    having count(*) > 1
  loop
    n := 1;
    for r in
      select id
        from public.vacancies
       where vacancy_id = grp.vacancy_id
       order by (status = 'approved') desc,
                (coalesce(last_date_to_apply, '') ~ '^\d{4}-\d{2}-\d{2}$'
                   and last_date_to_apply >= today) desc,
                notification_date desc nulls last,
                last_date_to_apply desc nulls last,
                created_at desc
    loop
      if n > 1 then
        -- next "<ID>~N" not already taken (normally just ~n)
        cand := grp.vacancy_id || '~' || n;
        while exists (select 1 from public.vacancies where vacancy_id = cand) loop
          n := n + 1;
          cand := grp.vacancy_id || '~' || n;
        end loop;
        update public.vacancies set vacancy_id = cand where id = r.id;
        raise notice 'vacancy % : % -> %', r.id, grp.vacancy_id, cand;
      end if;
      n := n + 1;
    end loop;
  end loop;
end $$;

-- ─── 2. Renumber future clashes on insert / ID edit ─────────────────────────
create or replace function public.vacancies_unique_vacancy_id()
returns trigger
language plpgsql
as $$
declare
  base text;
  n    int := 2;
  cand text;
begin
  if coalesce(new.vacancy_id, '') = '' then
    return new;
  end if;
  if not exists (select 1 from public.vacancies
                  where vacancy_id = new.vacancy_id and id <> new.id) then
    return new;
  end if;
  -- Serialise concurrent clashes on the same ID within this transaction.
  base := new.vacancy_id;
  perform pg_advisory_xact_lock(hashtext('vacancy_id:' || base));
  cand := base || '~' || n;
  while exists (select 1 from public.vacancies where vacancy_id = cand and id <> new.id) loop
    n := n + 1;
    cand := base || '~' || n;
  end loop;
  new.vacancy_id := cand;
  return new;
end $$;

drop trigger if exists vacancies_unique_vacancy_id on public.vacancies;
create trigger vacancies_unique_vacancy_id
  before insert or update of vacancy_id on public.vacancies
  for each row execute function public.vacancies_unique_vacancy_id();

-- ─── 3. Enforce it ──────────────────────────────────────────────────────────
create unique index if not exists vacancies_vacancy_id_uniq
  on public.vacancies (vacancy_id)
  where coalesce(vacancy_id, '') <> '';

-- ─── Check (should return no rows) ──────────────────────────────────────────
-- select vacancy_id, count(*) from public.vacancies
--  where coalesce(vacancy_id, '') <> '' group by vacancy_id having count(*) > 1;
-- See what was renamed:
-- select vacancy_id, post_name, status, notification_date, last_date_to_apply
--   from public.vacancies where vacancy_id like '%~%' order by vacancy_id;
