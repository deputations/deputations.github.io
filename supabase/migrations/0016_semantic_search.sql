-- ============================================================================
-- Migration 0016: semantic_search — Gemini-powered pgvector similarity search
--
-- Visitors to the home page can toggle a "✨ AI" chip that re-routes their
-- search query through the `semantic-search` Edge Function. That function
-- embeds the query with gemini-embedding-001 and matches it against the
-- ACTIVE-vacancy embeddings stored here.
--
-- Cost: ~67 ACTIVE vacancies × ~500 tokens = ~33K tokens per build, well
-- under Gemini's free tier (1,500 requests/day, 100 req/min). Build runs
-- daily from .github/workflows/build-data.yml.
--
-- ACTIVE-only is enforced in TWO places:
--   1. scripts/build_embeddings.py filters data/vacancies.json by
--      Status='Active' before embedding
--   2. search_vacancies() RPC filters the JOIN by status in ('Active','approved')
--      so even if stale embeddings exist for closed rows, they're never returned.
--
-- Free-tier safety:
--   • semantic_search_state.disabled_until is a soft-disable flag the Edge
--     Function checks on every request; if set, returns 503 without calling
--     Gemini.
--   • scripts/build_embeddings.py writes this flag on 429, exits cleanly.
--   • Next day's successful build clears it.
--
-- ============================================================================

-- pgvector is required. Supabase has it on all plans (free tier included).
-- If the migration fails on `create extension`, enable it manually in
-- Dashboard → Database → Extensions before re-running.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- One row per vacancy. Embedding is the 768-dim truncation of
-- gemini-embedding-001's native 3072-dim output (set via outputDimensionality
-- in the API call). Model name is stored so we can re-embed everything if
-- we ever switch models.
-- ---------------------------------------------------------------------------
create table if not exists public.vacancy_embeddings (
  vacancy_id   uuid primary key references public.vacancies(vacancy_id) on delete cascade,
  embedding    vector(768) not null,
  model        text not null,
  updated_at   timestamptz not null default now()
);

-- HNSW index for cosine distance lookups. m=16, ef_construction=64 are
-- pgvector defaults; with ~67 rows the index is overkill (sequential scan
-- would be fine) but it costs ~50 KB and future-proofs against growth.
create index if not exists vacancy_embeddings_vec_hnsw
  on public.vacancy_embeddings using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Soft-disable flag + build bookkeeping. Key/value to keep the schema small
-- and to make it trivial to add new flags (e.g. "last_error_message") later
-- without another migration.
-- ---------------------------------------------------------------------------
create table if not exists public.semantic_search_state (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

insert into public.semantic_search_state (key, value) values
  ('disabled_until',    null),
  ('last_build_at',     null),
  ('last_build_count',  '0'),
  ('last_build_status', 'never')
on conflict (key) do nothing;

drop trigger if exists trg_semantic_search_state_touch on public.semantic_search_state;
create trigger trg_semantic_search_state_touch before update on public.semantic_search_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Top-K similarity RPC. SECURITY DEFINER + anon grant, mirrors the
-- search_vacancies pattern from earlier migrations (faq_vote, endorse_flag).
-- Returns (vacancy_id, distance); the Edge Function does the JOIN with the
-- vacancies table to assemble the public response.
-- ---------------------------------------------------------------------------
create or replace function public.search_vacancies(
  query_embedding   vector(768),
  match_count       int    default 10,
  filter_ministry   text   default null,
  filter_level      text   default null
)
returns table (vacancy_id uuid, distance float)
language sql
security definer
set search_path = public
as $$
  select
    ve.vacancy_id,
    (ve.embedding <=> query_embedding)::float as distance
  from public.vacancy_embeddings ve
  join public.vacancies v on v.vacancy_id = ve.vacancy_id
  where v.status in ('Active', 'approved')
    and (filter_ministry is null or v.ministry = filter_ministry)
    and (filter_level    is null or v.level    = filter_level)
  order by ve.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.search_vacancies(vector, int, text, text) to anon, authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.vacancy_embeddings     enable row level security;
alter table public.semantic_search_state  enable row level security;

-- Both tables are service-role-only:
--   • vacancy_embeddings is written by scripts/build_embeddings.py via the
--     service role (PostgREST with the secret key bypasses RLS)
--   • semantic_search_state is written by the Edge Function on 429; reads
--     happen via direct SELECT inside the Edge Function using the admin
--     client (also bypasses RLS)
-- No anon policies — the public surface for both is the RPC / Edge Function.

-- ============================================================================
-- Deploy order (matches the handover notes):
--   1. This migration runs first (`supabase db push`).
--   2. scripts/build_embeddings.py runs from build-data.yml — populates
--      vacancy_embeddings and clears any stale disabled_until.
--   3. The `semantic-search` Edge Function (separate PR) reads via the
--      search_vacancies() RPC.
-- ============================================================================