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
