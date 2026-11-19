# OpenAI search with Gemini backup

The semantic search function prefers OpenAI `text-embedding-3-small` at 768
dimensions when its separate index is complete. It uses the existing Gemini
index and free-tier guard if the OpenAI key, index, API, or search RPC is
unavailable. Keyword search remains the final website fallback. Neither the
OpenAI nor Gemini secret belongs in public code.

Deployment requires an OpenAI project key from the V2 Flash organization in
both the GitHub Actions secret `OPENAI_API_KEY` and the Supabase Edge Function
secret of the same name. The website's Supabase project is `cwygwxhvpcthaejvlfqv`.
The CLI must be signed in to an account with permission to manage that project.
Never put a key in this file, shell history, a commit, or chat.

Deployment order:

1. Apply only `supabase/migrations/0028_openai_semantic_search.sql` to the
   website's project and verify the new table and service-only function grants.
2. Configure the OpenAI key as a server-side secret in Supabase and GitHub
   Actions. Check that the OpenAI project allows embeddings and set appropriate
   usage limits. Do not enable paid auto-recharge unless intended.
3. Deploy the updated `semantic-search` Edge Function without changing its
   existing JWT/proxy configuration. Before the OpenAI index is complete,
   requests continue through Gemini.
4. Publish the workflow and scripts from this branch and run the data build.
   Its OpenAI step fills the new index incrementally. It marks the index ready
   only after every active vacancy has been indexed. A failed build leaves
   Gemini in use, and later builds can resume.
5. Verify actual searches through the website, verify OpenAI usage in the
   correct organization, and exercise Gemini fallback in a controlled test.

The Git repository ignores new `.py` files under `scripts/` and `tests/`, so
the two new OpenAI Python files must be force-added when preparing a commit.
