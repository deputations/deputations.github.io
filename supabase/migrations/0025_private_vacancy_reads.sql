-- Apply ONLY AFTER the static snapshot and static-only clients are verified
-- on production, and the server-only exporter credential has been configured.
begin;
alter table public.vacancies enable row level security;
revoke all privileges on table public.vacancies from public, anon;
-- Table-level REVOKE does not remove any prior column-specific SELECT grants.
do $$
declare col record;
begin
  for col in select attname from pg_attribute
    where attrelid = 'public.vacancies'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke select (%I) on public.vacancies from public, anon', col.attname);
  end loop;
end $$;

drop policy if exists vac_public_read_approved on public.vacancies;
drop policy if exists vac_admin_read on public.vacancies;
create policy vac_admin_read on public.vacancies for select to authenticated
  using (public.is_admin());
-- Guard against other permissive authenticated policies, including future ones.
drop policy if exists vac_admin_guard on public.vacancies;
create policy vac_admin_guard on public.vacancies as restrictive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.vacancies to authenticated;

-- RLS is also the protection against inherited grants: anon never gets rows
-- even if a group role unexpectedly retains SELECT.
drop policy if exists vac_anon_deny on public.vacancies;
create policy vac_anon_deny on public.vacancies as restrictive for all to anon
  using (false) with check (false);

-- The semantic-search Edge Function already calls this with service_role.
-- Remove direct public execution of its SECURITY DEFINER database function.
do $$
declare fn record;
begin
  for fn in select oid::regprocedure as signature from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'search_vacancies'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end $$;
commit;
