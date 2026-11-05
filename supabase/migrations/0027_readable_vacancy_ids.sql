-- 0027_readable_vacancy_ids.sql
--
-- Why: the local intake automation (D:\My documents\deputation-automation,
-- integrated_app/connections.py) has been minting opaque public vacancy_ids
-- of the form "AUTO-<uuid5-fragment>" ("AUTO-2d86cef2-136") and hard-coding
-- min_code='DEP' on every row it delivers. The owner wants the readable
-- legacy scheme back ("MHA-2026-L10-004") and, on option 2, wants the
-- already-live rows fixed too — with old links kept working.
--
-- This migration (run in Supabase → SQL Editor, or `supabase db push`):
--   1. creates public.vacancy_id_aliases (old_id → new_id), auto-maintained
--      by a trigger so ANY future vacancy_id rename (incl. the 0024
--      "~N" renumbering) is recorded;
--   2. renames EVERY row whose vacancy_id still starts with 'AUTO-' (live
--      AND draft — not just the published snapshot) back to
--      "<min_code>-<year>-L<level>-<NNN>", continuing each prefix's
--      sequence past its current maximum so the 0024 uniqueness trigger
--      never has to fire;
--   3. repairs the min_code the app hard-coded to 'DEP' wherever the
--      row's own ministry names one of the canonical 53 ministries
--      (same table as MINISTRIES in admin-ingest.js);
--   4. follows the renames into the side tables that store the public id
--      (push_log, vacancy_flags, vacancy_embeddings);
--   5. scrubs pending vacancy_updates proposals/diffs so the "possible
--      duplicate" queue can no longer clobber a live row's vacancy_id or
--      min_code when an admin applies or merges them.
--
-- The website ships the same old→new mapping as data/vacancy-aliases.json
-- (published by scripts/build_data.py from this table); public-data.js v3
-- and app.js resolve old ?v= ids / stored watchlists through it.
--
-- Idempotent: the backfill loop only touches ids still matching 'AUTO-%',
-- the alias trigger is create-or-replace, and the side-table follows use
-- not-exists guards. Safe to re-run.
--
-- ORDER: apply this BEFORE the next "publish verified vacancy snapshot"
-- run so the rebuilt static artifacts (data/vacancies.json, feed.xml,
-- sitemap.xml, link_previews.json) already carry the new ids.
begin;

-- ─── 1. Alias table + auto-maintenance trigger ─────────────────────────────
create table if not exists public.vacancy_id_aliases (
  old_id     text not null primary key,   -- a retired vacancy_id
  new_id     text not null,               -- where that vacancy now lives
  created_at timestamptz not null default now()
);
create index if not exists vacancy_id_aliases_new_idx
  on public.vacancy_id_aliases (new_id);

create or replace function public.vacancy_id_alias_record()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(old.vacancy_id, '') <> ''
     and coalesce(new.vacancy_id, '') <> ''
     and old.vacancy_id is distinct from new.vacancy_id then
    insert into public.vacancy_id_aliases(old_id, new_id)
      values (old.vacancy_id, new.vacancy_id)
      on conflict (old_id) do update set new_id = excluded.new_id;
  end if;
  if tg_op = 'DELETE' and coalesce(old.vacancy_id, '') <> '' then
    delete from public.vacancy_id_aliases where new_id = old.vacancy_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists vacancies_alias_record on public.vacancies;
create trigger vacancies_alias_record
  after insert or update of vacancy_id or delete on public.vacancies
  for each row execute function public.vacancy_id_alias_record();

alter table public.vacancy_id_aliases enable row level security;
-- No anon access on purpose: the public site resolves old ids through the
-- published data/vacancy-aliases.json (build_data.py), not the live table.
-- service_role bypasses RLS (exporter + Edge Functions); admins read/write.
drop policy if exists vacancy_alias_admin_read on public.vacancy_id_aliases;
create policy vacancy_alias_admin_read on public.vacancy_id_aliases
  for select to authenticated using (public.is_admin());
drop policy if exists vacancy_alias_admin_write on public.vacancy_id_aliases;
create policy vacancy_alias_admin_write on public.vacancy_id_aliases
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── 2. Canonical min_code lookup (shared by the backfill and the queue
--     scrub below; MUST stay in sync with MIN_CODE_BY_NAME in
--     admin-ingest.js and ministry_codes.py in the intake app) ─────────────
create or replace function public.vacancy_min_code_for(ministry text)
returns text
language sql
stable
as $$
  select (case k.mkey
        when 'ayush' then 'MoA'
        when 'agricultureandfarmerswelfare' then 'MoAFW'
        when 'chemicalsandfertilizers' then 'MoCF'
        when 'civilaviation' then 'MoCA'
        when 'coal' then 'COAL'
        when 'commerceandindustry' then 'MoCI'
        when 'communications' then 'MoC'
        when 'consumeraffairsfoodandpublicdistribution' then 'MoCAFP'
        when 'cooperation' then 'COOP'
        when 'corporateaffairs' then 'MCA'
        when 'culture' then 'CULT'
        when 'defence' then 'MoD'
        when 'developmentofnortheasternregion' then 'MDONER'
        when 'earthsciences' then 'MoES'
        when 'education' then 'MoE'
        when 'electronicsandinformationtechnology' then 'MeitY'
        when 'environmentforestandclimatechange' then 'MoEFCC'
        when 'externalaffairs' then 'MEA'
        when 'finance' then 'MoF'
        when 'fisheriesanimalhusbandryanddairying' then 'MoFAHD'
        when 'foodprocessingindustries' then 'MoFPI'
        when 'healthandfamilywelfare' then 'MoHFW'
        when 'heavyindustries' then 'MoHI'
        when 'homeaffairs' then 'MHA'
        when 'housingandurbanaffairs' then 'MoHUA'
        when 'informationandbroadcasting' then 'MIB'
        when 'jalshakti' then 'MoJS'
        when 'labourandemployment' then 'MoLE'
        when 'lawandjustice' then 'MoLJ'
        when 'microsmallandmediumenterprises' then 'MSME'
        when 'mines' then 'MoM'
        when 'minorityaffairs' then 'MoMA'
        when 'newandrenewableenergy' then 'MNRE'
        when 'panchayatiraj' then 'MoPR'
        when 'parliamentaryaffairs' then 'MPA'
        when 'personnelpublicgrievancesandpensions' then 'MoPPGP'
        when 'petroleumandnaturalgas' then 'MoPNG'
        when 'planning' then 'MoP'
        when 'portsshippingandwaterways' then 'MoPSW'
        when 'power' then 'POWER'
        when 'railways' then 'MoR'
        when 'roadtransportandhighways' then 'MoRTH'
        when 'ruraldevelopment' then 'MoRD'
        when 'scienceandtechnology' then 'MST'
        when 'skilldevelopmentandentrepreneurship' then 'MSDE'
        when 'socialjusticeandempowerment' then 'MoSJE'
        when 'statisticsandprogrammeimplementation' then 'MoSPI'
        when 'steel' then 'MoS'
        when 'textiles' then 'MoT'
        when 'tourism' then 'TOUR'
        when 'tribalaffairs' then 'MoTA'
        when 'womenandchilddevelopment' then 'MoWCD'
        when 'youthaffairsandsports' then 'MoYAS'
        else null end)
    from (
      select regexp_replace(
               regexp_replace(
                 lower(replace(coalesce(ministry, ''), '&', 'and')),
                 'ministry of|department of|dept\.? of|govt\.? of india|government of india',
                 '', 'gi'),
               '[^a-z]', '', 'g') as mkey
    ) k
$$;

-- ─── 3. Backfill: AUTO- ids → readable ids (min_code repair included) ─────
-- The readable prefix follows the LEGACY scheme (supabase/functions/extract's
-- minCodeFromMinistry: ministry initials, "Development of North Eastern
-- Region" → DONER), NOT the admin 53-pair table — the user's existing ?v=
-- links are in that form. The min_code column is repaired separately via the
-- table, matching what the admin UI curates (MDONER, MHA, …).
create or replace function public.vacancy_id_code_for(ministry text)
returns text
language sql
stable
as $$
  select coalesce(
    left(upper(string_agg(w.init, '')), 5),
    'DEP')
  from (
    select left(upper(t), 1) as init
      from regexp_split_to_table(
        trim(
          regexp_replace(
            replace(coalesce(ministry, ''), '&', ' '),
            'ministry of|department of|govt\.? of india|government of india',
            '', 'gi')),
        '\s+') as t
     where t <> ''
  ) w
$$;

do $$
declare
  r     record;
  pfx   text;
  keep  text;
  lvl   text;
  yr    text;
  base  text;
  seq   int;
  new_id text;
begin
  for r in
    select id, vacancy_id, ministry, min_code, level, notification_date
      from public.vacancies
     where vacancy_id like 'AUTO-%'
     order by id
  loop
    pfx := public.vacancy_id_code_for(r.ministry);
    -- min_code: canonical table code when the ministry names a known
    -- department; otherwise keep whatever the row already carries.
    keep := coalesce(public.vacancy_min_code_for(r.ministry),
                     coalesce(nullif(btrim(coalesce(r.min_code, '')), ''), 'DEP'));

    lvl := btrim(coalesce(r.level, ''));
    if lvl = '' then
      lvl := 'X';
    elsif lvl ~ '^[0-9]+$' then
      lvl := coalesce(nullif(ltrim(lvl, '0'), ''), 'X');   -- "09" → "9"
    end if;

    yr := left(coalesce(r.notification_date, ''), 4);
    if not (yr ~ '^[0-9]{4}$') then
      yr := '2026';
    end if;

    base := pfx || '-' || yr || '-L' || lvl || '-';
    -- Continue the prefix's existing sequence (the 0024 uniqueness trigger
    -- is the last-resort guard and should never fire here).
    select coalesce(max(substring(vacancy_id from '-([0-9]+)(~[0-9]+)?$')::int), 0) + 1
      into seq
      from public.vacancies
     where vacancy_id like base || '%';
    new_id := base || lpad(seq::text, 3, '0');

    if new_id is distinct from r.vacancy_id then
      update public.vacancies
         set min_code   = keep,
             vacancy_id = new_id
       where id = r.id;
    end if;
  end loop;
end $$;

-- ─── 4. Follow the renames into the side tables that store the public id ──
update public.push_log pl
   set vacancy_id = a.new_id
  from public.vacancy_id_aliases a
 where pl.vacancy_id = a.old_id
   and not exists (select 1 from public.push_log x
                   where x.endpoint = pl.endpoint and x.vacancy_id = a.new_id);

update public.vacancy_flags vf
   set vacancy_id = a.new_id
  from public.vacancy_id_aliases a
 where vf.vacancy_id = a.old_id;

update public.vacancy_embeddings ve
   set vacancy_id = a.new_id
  from public.vacancy_id_aliases a
 where ve.vacancy_id = a.old_id
   and not exists (select 1 from public.vacancy_embeddings y
                   where y.vacancy_id = a.new_id);

-- ─── 4. Scrub pending review queues so Apply/Merge can't clobber live rows ─
-- Two payload shapes exist in vacancy_updates:
--  • kind='update'  — a merge patch onto an approved row. It must never
--    rewrite the live row's public vacancy_id (the intake app leaked its
--    opaque AUTO id there), and its 'DEP' min_code must not overwrite a
--    curated one. Strip both.
--  • kind='duplicate' — the full candidate. "Create as new" makes a draft
--    from it: keep its vacancy_id (the section-2 loop re-names any
--    leftover AUTO- id on a re-run — self-healing) but repair the
--    placeholder min_code from the candidate's own ministry when it names
--    a known department; drop the stale min_code diff.
do $$
declare
  u      record;
  tgt    record;
  p_new  jsonb;
  d_new  jsonb;
  cand_code text;
begin
  for u in
    select id, kind, proposed, diff, target_id
      from public.vacancy_updates
     where status = 'pending'
     order by id
  loop
    p_new := u.proposed;
    d_new := coalesce(u.diff, '{}'::jsonb);
    if u.kind = 'update' then
      p_new := p_new - 'vacancy_id';
      d_new := d_new - 'vacancy_id';
      if coalesce(p_new->>'min_code', '') in ('', 'DEP') then
        p_new := p_new - 'min_code';
        d_new := d_new - 'min_code';
      end if;
    else
      select public.vacancy_min_code_for(p_new->>'ministry') into cand_code;
      if cand_code is not null then
        p_new := jsonb_set(p_new, '{min_code}', to_jsonb(cand_code));
        d_new := d_new - 'min_code';   -- the DEP diff was generated from the placeholder
      end if;
    end if;
    select * into tgt from public.vacancies where id = u.target_id;
    if tgt is not null and coalesce(tgt.min_code, '') not in ('', 'DEP')
       and coalesce(p_new->>'min_code', '') in ('', 'DEP') then
      p_new := p_new - 'min_code';
      d_new := d_new - 'min_code';
    end if;
    update public.vacancy_updates
       set proposed = p_new, diff = d_new
     where id = u.id;
  end loop;
end $$;

commit;

-- ─── Checks (run after apply) ──────────────────────────────────────────────
-- Ids still in AUTO- form (expect 0):
--   select count(*) from public.vacancies where vacancy_id like 'AUTO-%';
-- Aliases recorded by the backfill:
--   select count(*) from public.vacancy_id_aliases where old_id like 'AUTO-%';
-- Sample of the renames:
--   select a.old_id, a.new_id, v.status, v.post_name
--     from public.vacancy_id_aliases a
--     join public.vacancies v on v.vacancy_id = a.new_id
--    where a.old_id like 'AUTO-%' order by a.new_id limit 20;
-- min_code left as 'DEP' only when no ministry is known:
--   select count(*) from public.vacancies
--    where min_code = 'DEP' and coalesce(btrim(ministry), '') <> '';
