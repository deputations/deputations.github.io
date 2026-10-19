-- Employment News carries every kind of government recruitment. A row from
-- that source may be approved only when its reviewed data explicitly identifies
-- it as a deputation post. This is a database guard, so bulk approval and any
-- future intake client cannot bypass it.
begin;

create or replace function public.require_employment_news_deputation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_type = 'employment_news' and new.status = 'approved' then
    if coalesce(new.deputation_type, '') !~* '\mdeputation\M' then
      raise exception 'Employment News vacancies require an explicit deputation basis before approval';
    end if;
    if coalesce(new.raw_extraction ->> 'is_deputation', 'true') = 'false' then
      raise exception 'Employment News vacancies marked non-deputation cannot be approved';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vacancies_require_employment_news_deputation on public.vacancies;
create trigger vacancies_require_employment_news_deputation
  before insert or update of status, source_type, deputation_type, raw_extraction
  on public.vacancies
  for each row execute function public.require_employment_news_deputation();

commit;
