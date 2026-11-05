/* Real PostgreSQL role/RLS regression test using an isolated PGlite database.
 * Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite package.
 * No production credentials or database connection are used. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Employment News extractor requires an explicit deputation verdict', () => {
  const source = fs.readFileSync(path.join('supabase', 'functions', 'extract', 'index.ts'), 'utf8');
  assert.match(source, /job\.source_type === "employment_news" && it\.is_deputation !== true/);
  assert.doesNotMatch(source, /it\.is_deputation === false/);
});

test('database blocks approval of Employment News rows without a deputation basis', async () => {
  const {PGlite} = require(process.env.PGLITE_MODULE || './sql/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.vacancies (
        id int primary key, status text, source_type text, deputation_type text,
        raw_extraction jsonb default '{}'::jsonb
      );
    `);
    await db.exec(fs.readFileSync('supabase/migrations/0026_require_employment_news_deputation.sql', 'utf8'));
    await db.exec(`insert into public.vacancies values (1,'draft','employment_news','', '{}'::jsonb)`);
    await assert.rejects(
      db.exec(`update public.vacancies set status='approved' where id=1`),
      /explicit deputation basis/
    );
    await db.exec(`insert into public.vacancies values (2,'approved','employment_news','Deputation', '{}'::jsonb)`);
    await assert.rejects(
      db.exec(`insert into public.vacancies values (3,'approved','employment_news','Deputation', '{"is_deputation": false}'::jsonb)`),
      /marked non-deputation/
    );
  } finally { await db.close(); }
});

test('0027 backfill renames AUTO- ids to readable ids and scrubs pending queues', async () => {
  const {PGlite} = require(process.env.PGLITE_MODULE || './sql/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create function public.is_admin() returns boolean language sql stable as
        $$ select coalesce(current_setting('request.jwt.claims', true),'{}')::jsonb->>'admin' = 'true' $$;
      create table public.vacancies (
        id uuid primary key default gen_random_uuid(),
        vacancy_id text, ministry text, min_code text, level text,
        notification_date text, status text default 'draft',
        raw_extraction jsonb default '{}'::jsonb
      );
      create table public.vacancy_updates (
        id uuid primary key, target_id uuid, kind text, proposed jsonb,
        diff jsonb, status text default 'pending'
      );
      create table public.vacancy_flags (id uuid primary key, vacancy_id text);
      create table public.push_log (endpoint text, vacancy_id text, primary key (endpoint, vacancy_id));
      create table public.vacancy_embeddings (vacancy_id text primary key);
      alter table public.vacancies enable row level security;
      alter table public.vacancy_updates enable row level security;
      create policy vac_admin on public.vacancies for all to authenticated using (public.is_admin()) with check (public.is_admin());
      create policy up_admin on public.vacancy_updates for all to authenticated using (public.is_admin()) with check (public.is_admin());
      insert into public.vacancies (vacancy_id, ministry, min_code, level, notification_date, status) values
        ('MHA-2026-L10-004', 'Home Affairs', 'MHA', '10', '2026-01-02', 'approved'),
        ('AUTO-2d86cef2-136', 'Home Affairs', 'DEP', '10', '2026-01-02', 'draft'),
        ('AUTO-7994b25f-5b6', '', 'DEP', '', '', 'approved'),
        ('AUTO-aceb2f85-0a2', 'Home Affairs', 'DEP', '13A', '2026-02-01', 'draft');
      insert into public.vacancy_updates (id, target_id, kind, proposed, diff, status)
        select gen_random_uuid(), (select id from public.vacancies where vacancy_id = 'MHA-2026-L10-004'),
          'duplicate',
          '{"post_name":"Research Officer","min_code":"DEP","vacancy_id":"AUTO-2d86cef2-136","ministry":"Home Affairs"}'::jsonb,
          '{"min_code":{"old":"MHA","new":"DEP"},"vacancy_id":{"old":"MHA-2026-L10-004","new":"AUTO-2d86cef2-136"}}'::jsonb,
          'pending';
      insert into public.vacancy_flags (id, vacancy_id) values (gen_random_uuid(), 'AUTO-7994b25f-5b6');
      insert into public.push_log values ('ep1', 'AUTO-7994b25f-5b6');
      insert into public.vacancy_embeddings values ('AUTO-7994b25f-5b6');
    `);
    const file = fs.readFileSync('supabase/migrations/0027_readable_vacancy_ids.sql', 'utf8');
    await db.exec(file);
    const rows = await db.query(`select vacancy_id, min_code, level from public.vacancies order by vacancy_id`);
    // Readable prefix = the legacy initials scheme (Home Affairs → HA), min_code
    // repaired to the admin table code (MHA); MHA-2026-L10-004 stays untouched.
    assert.deepEqual(rows.rows.map(r => r.vacancy_id), [
      'DEP-2026-LX-001', 'HA-2026-L10-001', 'HA-2026-L13A-001', 'MHA-2026-L10-004',
    ]);
    assert.equal(rows.rows[1].min_code, 'MHA');   // canonical code, not the app's DEP
    const alias = (await db.query(`select old_id, new_id from public.vacancy_id_aliases where old_id like 'AUTO-%' order by new_id`)).rows;
    assert.equal(alias.length, 3);
    assert.deepEqual(alias[0], {old_id: 'AUTO-7994b25f-5b6', new_id: 'DEP-2026-LX-001'});
    // side tables followed the rename
    assert.equal((await db.query(`select vacancy_id from public.push_log`)).rows[0].vacancy_id, 'DEP-2026-LX-001');
    assert.equal((await db.query(`select vacancy_id from public.vacancy_flags`)).rows[0].vacancy_id, 'DEP-2026-LX-001');
    assert.equal((await db.query(`select vacancy_id from public.vacancy_embeddings`)).rows[0].vacancy_id, 'DEP-2026-LX-001');
    // pending duplicate: opaque id kept (self-heals on re-run), DEP min_code repaired from the candidate's ministry
    const upd = (await db.query(`select proposed, diff from public.vacancy_updates`)).rows[0];
    assert.equal(upd.proposed.min_code, 'MHA');
    assert.equal(upd.proposed.vacancy_id, 'AUTO-2d86cef2-136');
    assert.equal(upd.diff.min_code, undefined);
    // idempotent: re-run leaves the dataset unchanged
    await db.exec(file);
    const rows2 = await db.query(`select vacancy_id from public.vacancies order by vacancy_id`);
    assert.deepEqual(rows2.rows.map(r => r.vacancy_id), rows.rows.map(r => r.vacancy_id));
    assert.equal((await db.query(`select count(*)::int as n from public.vacancies where vacancy_id like 'AUTO-%'`)).rows[0].n, 0);
  } finally { await db.close(); }
});

test('migration closes public and non-admin reads while preserving admin and exporter access', async () => {
  const {PGlite} = require(process.env.PGLITE_MODULE || './sql/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.vacancies (id int, status text, reviewer_notes text);
      insert into public.vacancies values (1,'approved','private');
      create function public.is_admin() returns boolean language sql stable as
        $$ select coalesce(current_setting('request.jwt.claims', true),'{}')::jsonb->>'admin' = 'true' $$;
      alter table public.vacancies enable row level security;
      grant select on public.vacancies to public, anon, authenticated, service_role;
      grant select(reviewer_notes) on public.vacancies to anon;
      create policy vac_public_read_approved on public.vacancies for select to anon, authenticated using (status='approved');
      create policy vac_admin_write on public.vacancies for all to authenticated using (public.is_admin()) with check(public.is_admin());
      create function public.search_vacancies() returns int language sql security definer as $$ select 1 $$;
    `);
    await db.exec(fs.readFileSync('supabase/migrations/0025_private_vacancy_reads.sql','utf8'));
    await db.exec('set role anon');
    await assert.rejects(db.query('select reviewer_notes from public.vacancies'),/permission denied/);
    await assert.rejects(db.query('select public.search_vacancies()'),/permission denied/);
    await db.exec(`reset role; set request.jwt.claims='{}'; set role authenticated`);
    assert.equal((await db.query('select * from public.vacancies')).rows.length,0);
    await assert.rejects(db.query('select public.search_vacancies()'),/permission denied/);
    await db.exec(`reset role; set request.jwt.claims='{"admin":true}'; set role authenticated`);
    assert.equal((await db.query('select * from public.vacancies')).rows.length,1);
    await db.exec(`update public.vacancies set reviewer_notes='admin edit'; reset role; set role service_role`);
    assert.equal((await db.query('select reviewer_notes from public.vacancies')).rows[0].reviewer_notes,'admin edit');
    assert.equal((await db.query('select public.search_vacancies() as result')).rows[0].result,1);
    // An inherited SELECT or another permissive policy must not reopen access.
    await db.exec(`reset role; create role legacy_reader; grant select on public.vacancies to legacy_reader; grant legacy_reader to anon;
      create policy accidental_public on public.vacancies for select to public using(true); set role anon;`);
    assert.equal((await db.query('select * from public.vacancies')).rows.length,0);
    await db.exec(`reset role; set request.jwt.claims='{}'; set role authenticated`);
    assert.equal((await db.query('select * from public.vacancies')).rows.length,0);
  } finally { await db.close(); }
});
