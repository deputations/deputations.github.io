# Supabase mirror migration — 18 October 2026 IST

Source: `djaxutkmhazufsxeobal`, organization `xwhanecbrukilsrgtopz`, Seoul.
Destination: `cwygwxhvpcthaejvlfqv`, organization `lkffkyhuhnfqbfdjtxqr`, Mumbai.
Both projects remain on Free. The source project is retained for rollback.

## Restored and checked

- Full compressed source database backup created before restoring.
- All 17 public tables matched by row count and content checksum after restore.
- 1,974 vacancies, 87 ingestion jobs, three admin records and five Auth users with
  five identities preserved. Review history, feedback, counters, embeddings and
  push subscriptions were retained. Existing login sessions are replaced by fresh
  logins; old signing keys are not reused.
- Three private source PDFs restored under their original object paths, totaling
  88,653,763 bytes. Local file SHA-256 hashes exactly matched the recorded paths.
- Storage bucket settings and admin-only Storage policy restored.
- Seven deployed function sources recovered from production and deployed with
  their existing gateway JWT settings. The mirror uses ES256 user sessions;
  real admin access and function authorization were checked.
- Migration 0025 reapplied after restore to remove grants inherited from the
  destination's default privileges. Anonymous base-table reads return 401/42501.
  Direct semantic-search calls return 403/proxy_required.
- Real admin session can read all 1,974 vacancies. Admin magic-link email request
  accepted (HTTP 200). Real AI query through the production proxy returned three
  matches (HTTP 200).
- Empty jobs created by validation were identified against source IDs and removed.

## Production connections

- Browser config uses the mirror URL and its public anon key; all config imports
  are version sb7. Production still uses api.alldeputations.com for NIC access.
- Oracle/Caddy points other API paths to the mirror, while semantic-search stays
  behind the rate-limited Worker. The public A record is retained.
- Worker version 03f82a60-9a52-41b4-971c-9834f4c432ed targets the mirror and keeps
  its existing server-only token, limiter and query-string redaction.
- GitHub SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY updated.
  Push workflow reads the endpoint from SUPABASE_URL rather than a fixed project.
- Local intake app's public key, direct-host allowlist and protected portal session
  updated. Read-only admin connectivity checked successfully through the proxy.
- Public listings continue to use static snapshots and lazy archives. No public
  database-table loading is restored by this migration.

## Credentials and recovery

GEMINI_API_KEY and PUSH_CRON_KEY recovered through a one-time encrypted CI artifact;
both values matched the source's stored digests. Existing VAPID_PUBLIC,
VAPID_PRIVATE and VAPID_SUBJECT recovered from the owner's protected deployment
record and verified against source digests. PUBLIC_PROXY_SECRET preserved from
the existing protected Caddy configuration. Provider values and full-control
account tokens are never committed.

Four older fallback values cannot be revealed by Supabase: MISTRAL_API_KEY,
OPENROUTER_API_KEY, SERPER_API_KEY and APPS_SCRIPT_URL. They need the owner's
original local values to reproduce those fallback paths. Primary Gemini search,
extraction, push and core site operation use the recovered credentials.

Migration material is kept outside Git in the owner's protected directory:
`C:/Users/vivek/.codex/tmp/deputation-mirror-migration-20261018/`.
Oracle's previous route is backed up as
`/etc/caddy/Caddyfile.pre-mirror-20261018`. Previous Worker version was
`f1208a68-da74-4cba-84d0-9f7f744e327a`.

Rollback must reconcile any records written after cutover before repointing to
the original. The original's quota restriction still applies; routine recovery
should repair the mirror rather than restore anonymous bulk reads.
