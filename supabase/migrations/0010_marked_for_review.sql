-- 0010_marked_for_review.sql
-- Admin-only "marked for review" flag on vacancies. Lets an admin tag any
-- vacancy (draft OR approved) from the Review queue or the Manage tab and
-- find it later via Manage → Source filter → "🚩 Marked for review". Purely
-- internal metadata; inherits the table's existing RLS (public read of
-- approved rows, admin write). Partial index because the vast majority of
-- rows will never be marked.

alter table public.vacancies
  add column if not exists marked_for_review boolean not null default false;

create index if not exists vacancies_marked_for_review_idx
  on public.vacancies (marked_for_review) where marked_for_review = true;
