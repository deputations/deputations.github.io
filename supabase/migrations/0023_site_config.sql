-- ============================================================================
-- Migration 0023: site_config — site-wide boolean toggles managed from the
-- admin console. Anon key can read; admin key can write.
-- ============================================================================

create table if not exists public.site_config (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- seed defaults
insert into public.site_config (key, value) values
  ('projects_page_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- drop trigger + function if they exist (idempotent re-run)
drop trigger if exists trg_site_config_touch on public.site_config;
drop function if exists public.touch_site_config();

create function public.touch_site_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_site_config_touch
  before update on public.site_config
  for each row execute function public.touch_site_config();

-- read: anon (public) can SELECT
-- write: admin only
alter table public.site_config enable row level security;

drop policy if exists site_config_admin on public.site_config;
create policy site_config_admin on public.site_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy site_config_public_read on public.site_config
  for select to anon using (true);

-- RPC: get one config value (defaults to true if missing). Returns a JSONB
-- object to avoid PostgREST wrapping ambiguity with scalar types.
create or replace function public.get_site_config(p_key text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('enabled', (value::text = 'true'))
     from public.site_config where key = left(p_key, 100)),
    jsonb_build_object('enabled', true));
$$;

-- RPC: set one config value (admin only)
create or replace function public.set_site_config(p_key text, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  insert into public.site_config (key, value) values (left(p_key, 100), to_jsonb(p_value))
  on conflict (key) do update set value = to_jsonb(p_value);
end;
$$;

grant execute on function public.get_site_config(text) to anon, authenticated;
grant execute on function public.set_site_config(text, boolean) to authenticated;
