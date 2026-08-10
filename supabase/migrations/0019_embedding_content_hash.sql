-- 0019_embedding_content_hash.sql
-- Make the daily embedding build incremental.
--
-- build_embeddings.py re-embedded EVERY active vacancy on every run. That was
-- fine at the ~67 rows the original comment assumed, but the set grows with
-- each approval — it hit 96 on 2026-08-10 and tripped Gemini's free-tier
-- limit, which disabled semantic search for the rest of the day. The work was
-- almost entirely wasted: on a typical day nothing about a vacancy's text
-- changes, so the same input was re-embedded into the same vector.
--
-- Storing a hash of the exact text we embedded lets the build skip a row whose
-- text is unchanged. Daily request count drops from "every active row" to
-- "only what actually changed" — usually zero.
--
-- The hash covers the MODEL TAG as well as the text, so switching embedding
-- models (or task type) invalidates every row automatically and forces a
-- clean re-embed. No separate migration needed for that case.
--
-- Nullable with no default and no backfill: a NULL hash simply means "unknown,
-- re-embed once", so the first run after this migration rebuilds the corpus
-- and fills the column in. That costs one full pass, once.

alter table public.vacancy_embeddings
  add column if not exists content_hash text;
