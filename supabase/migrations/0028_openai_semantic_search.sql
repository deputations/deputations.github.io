-- Keep OpenAI embeddings separate from the existing Gemini backup.
begin;
create table if not exists public.vacancy_openai_embeddings (
  vacancy_id text primary key,
  embedding vector(768) not null,
  model text not null,
  content_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.vacancy_openai_embeddings enable row level security;
revoke all on public.vacancy_openai_embeddings from public, anon, authenticated;
grant all on public.vacancy_openai_embeddings to service_role;
create index if not exists vacancy_openai_embeddings_vec_hnsw
  on public.vacancy_openai_embeddings using hnsw (embedding vector_cosine_ops);

create or replace function public.search_vacancies_openai(
  query_embedding vector(768), match_count int default 10,
  filter_ministry text default null, filter_level text default null
)
returns table (vacancy_id text, distance float)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.semantic_search_state
                 where key = 'openai_embedding_model' and value = 'text-embedding-3-small') then
    raise exception 'OpenAI index is not ready';
  end if;
  return query
  select ve.vacancy_id, (ve.embedding <=> query_embedding)::float
  from public.vacancy_openai_embeddings ve
  join public.vacancies v on v.vacancy_id = ve.vacancy_id
  where v.status in ('Active', 'approved')
    and (filter_ministry is null or v.ministry = filter_ministry)
    and (filter_level is null or v.level = filter_level)
  order by ve.embedding <=> query_embedding
  limit greatest(match_count, 1);
end;
$$;
revoke execute on function public.search_vacancies_openai(vector, int, text, text)
  from public, anon, authenticated;
grant execute on function public.search_vacancies_openai(vector, int, text, text) to service_role;
commit;
