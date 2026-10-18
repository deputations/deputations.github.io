# Public data containment and recovery

Implemented on `codex/reduce-supabase-egress`. Deployment and account-side
configuration are separate steps. Never interpret a passing local test as a
production change.

## Verified rollout status — 18 October 2026 IST

Production now uses the Free mirror `cwygwxhvpcthaejvlfqv` in organization
`lkffkyhuhnfqbfdjtxqr`; the restricted original `djaxutkmhazufsxeobal` is retained.
See MIRROR-MIGRATION-2026-10-18.md before any rollback or credential change.
The historical containment checks below describe the original rollout.

- PR #30 merged; full CI passed (184 Python/browser checks, one intentional
  hostname skip, Node security/data/Worker checks and authenticated admin checks).
- Public static clients are live at alldeputations.com. The production export
  published and verified 1,600 records using 1,448,601 received response bytes.
- Migration 0025 applied to the live project djaxutkmhazufsxeobal. Direct anonymous
  table requests through both the Supabase URL and api.alldeputations.com return
  permission denied (PostgREST code 42501). No database rows were removed.
- Live read-only role checks passed: authenticated non-admin sees zero rows;
  a configured admin reads all rows; service_role reads approved rows and retains
  search RPC access. No production admin mutations were performed for testing.
- Production homepage and archived deep link tested after restriction: listings
  and detail modals work, archived link loads one static shard, zero table requests
  and zero page errors on the tested homepage.
- Guarded semantic-search and sb-proxy are deployed in the correct accounts.
  Worker version: f1208a68-da74-4cba-84d0-9f7f744e327a. The website's actual
  ingress is Oracle/Caddy at api.alldeputations.com, not a Worker custom domain.
  Only its semantic-search path now forwards through the Worker. The A record and
  other backend routes remain in place for government-network compatibility.
- Caddy overwrites the server token and client-address headers. The Worker trusts
  that address only with a valid server token; direct callers use Cloudflare's
  client address. Client addresses and tokens are stripped before forwarding.
  Live forged-header tests could not rotate the limiter key: HTTP 429 with
  Retry-After: 60. Direct Edge Function calls, including forged tokens, get 403.
- Website-route validation reaches the function. A real AI query returned the
  existing disabled/free-tier safeguard, until 18 October 2026 00:00 UTC
  (05:30 IST). This timer does not guarantee provider quota recovery. Keyword
  search remains available; do not clear the flag to bypass provider limits.
- Worker logs/traces redact URL query strings. Live desktop browsing and mobile
  browsing with simulated backend HTTP 402 both showed 472 active listings,
  without vacancy-table/archive requests or page errors.
- Backups/usage-alert configuration remain separate setup tasks.

## Deployment order

1. Check `SUPABASE_URL` and the existing server-only `SUPABASE_SERVICE_ROLE_KEY`
   GitHub secrets. Secret names could not be verified with the current CLI token
   (403). Never place the service key in HTML, config.js, snapshots or logs.
2. Merge the static-client/publication changes. The committed bootstrap snapshot
   was freshly read from the currently public approved dataset. It contains
   1,494 records, with extraction audit objects, reviewer notes, confidence and
   ingestion identifiers removed. Generation timestamps are in the manifest.
3. Run Build deputation data. It now uses an explicit field list and gzip, exact
   row counts, a 10 MB transfer ceiling per run, and no spreadsheet fallback.
   Failures preserve the last manifest. A >25% record drop fails until inspected;
   intentional mass removals can be run with ALLOW_LARGE_SNAPSHOT_CHANGE=true.
4. Publication explicitly requests a legacy GitHub Pages build and checks the
   actual `https://alldeputations.com` manifest and every referenced shard.
   Pages was verified via the API to serve `main` from `/` using a legacy build.
   Confirm the build-request token permission on the first production run.
5. Check the deployed site on desktop and mobile: no `/rest/v1/vacancies`
   request, archive loads only on demand, saved/archived deep links work.
6. Apply `supabase/migrations/0025_private_vacancy_reads.sql` only after steps
   1–5. It removes public base-table access and limits authenticated access to
   admins, including a restrictive RLS guard against accidental permissive
   policies. It also removes direct public execution of `search_vacancies`.
   Test real anonymous, non-admin, admin and service-role sessions afterward.
   Local PostgreSQL role/RLS tests passed, but do not establish live schema parity.
7. Configure the same randomly generated (at least 32 characters) PUBLIC_PROXY_SECRET
   as a protected Supabase function secret and a Wrangler Worker secret. Never
   put it in config.js, browser requests, source files or logs. Provision the same
   token in Oracle's root:caddy 0640 private Caddy snippet, using the templates in
   workers/oracle-proxy/. Preserve Oracle's A record: workers.dev is not reachable
   from all government networks. Deploy Worker first, validate/reload the Caddy
   route, then deploy only semantic-search, preserving its existing gateway JWT
   setting. Missing configuration disables AI
   search safely; keyword search remains available. Test direct invocation rejects
   before accessing the database/Gemini, while the website proxy succeeds.
8. Deploy the proxy safeguards with its rate-limit binding. BLOCK_PUBLIC_VACANCIES
   stops recognizable anonymous bulk reads cheaply; the database enforces access
   even for forged headers or direct requests. The semantic-search binding allows
   60 requests/minute per network per Cloudflare location. It is an abuse throttle,
   not a global budget or exact unique-person counter. Review shared-office impact.

The guarded semantic-search function rejects direct calls without the server-only
proxy token, closing its limiter bypass. Other public features (submissions, votes,
push subscriptions) are separate endpoints with existing application checks; the
search limiter does not cover them. Their ongoing usage still needs monitoring.
No claim is made that public static files cannot be copied. Their advantage is that
bulk copying no longer requires a live database response.

## Quota outage

The stable `data/vacancies-manifest.json` points to immutable, checksum-verified
current/archive shards. Keep old shard directories for older clients. Current
includes undated/unknown records so normal client filters remain available;
expired records are split into 16 archive shards. A deep link fetches one shard.
Deadlines use Asia/Kolkata, including the owner's existing 60-day recent-undated
rule. No publication refresh is required to stop showing a passed deadline as active.

On an export failure, retain the last good manifest. Never substitute the legacy
Google Sheet or refresh the source-updated timestamp to disguise stale data.
The site uses its existing Updated date and warns after 48 hours. A missing manifest
falls back to the public compatibility JSON. The service worker preserves cached
snapshots, revalidates the manifest, and does not cache authenticated API responses.
Optional widget requests stop after three failures or a quota 402. Map realtime
and full-record polling have been retired; update checks fetch only the manifest.

Set Worker DISABLE_PUBLIC_LIVE=true to pause search during an incident. The switch
also pauses counters sent directly to that Worker; the production Oracle route
sends counters directly to Supabase, so those require a separate ingress change.
This leaves static keyword search and listings available; it does
not itself pause other direct Edge Function endpoints. A server-side usage restriction
still needs to be resolved separately. Existing submission forms retain their
input on failure and only show success after a confirmed successful response.

## Operating budget and measurements

Target <=2 GB of Supabase egress per billing cycle, not merely below 5 GB.
Review actual organization usage at 1.0, 1.4 and 1.7 GB and projected cycle-end
usage. Account-side automatic usage alerts are NOT configured by this change:
their available API/permissions were not established. Check daily until that is
connected; measure admin, embeddings, other functions and backups separately.

Measured optimized export: approximately 1.33 MB of compressed response bodies
per full export with exact-count validation and location-grouping identifiers. One daily run is
roughly 40 MB/month at today's dataset size. Repeated runs, growth and other
services are additional. The generated current shard compresses locally to about
183 KB; the full compatibility file to about 480 KB. Those public files are served
by static hosting, not Supabase. These are measurements/estimates, not a promise
of total monthly billed usage. Export logs record actual received bytes and fail
after 10 MB; they do not print credentials or record contents.

## Database recovery material

`database-backup.yml` is manual until configured and restore-tested. Supply
BACKUP_DATABASE_URL and exactly one BACKUP_RECIPIENT_PUBLIC_KEY; keep the matching
private key independently of Supabase/GitHub. The workflow takes a custom-format
public-schema dump and uploads only GPG-encrypted bytes with 14-day retention.
Use a pg_dump client at least as new as the server; version mismatch fails closed.
Never add unencrypted backup files to the repository or workflow artifacts.

This is an application-schema backup, including unpublished vacancies and review
history. It does not back up Auth identities, Storage PDF objects, project secrets
or external-provider configuration. Those require independent recovery material.
The backup preserves ACL statements; restore into an isolated compatible project
with expected roles, then decrypt locally and use pg_restore to load the dump.
Verify row counts, admin access and representative source references before
declaring a recovery test successful. `pg_restore --list` checks the archive
structure; it is not a substitute for a real restore. No live backup or restore
has been run by this implementation.

## Rollback

Repoint the stable manifest to a prior verified version and restore its metadata.
Retain the static-only browser path. Keep the full compatibility JSON for older
clients. If a database migration breaks admin access, repair the authenticated
admin grants/policy after inspecting actual role memberships. Do not restore
anonymous bulk-table reads as the default rollback. Proxy flags can be disabled
independently; a missing search limiter fails search closed rather than exposing
the upstream without a limit.

Oracle's pre-change Caddyfile is /etc/caddy/Caddyfile.pre-egress-20261018.
Restoring it alone bypasses the Worker but search then fails closed at the guarded
function. Prefer temporarily disabling AI search while repairing the protected
route. The prior Worker version is 01e34122-fc79-4ce8-bfa8-c2c3e74cad7b;
rolling it back also removes the limiter, so it is not a safe default search
recovery. Previous function source and database access metadata were saved in
the owner's local .codex/tmp/deputation-live-rollout directory. Do not restore
unprotected public search or anonymous table grants as routine recovery.

## Checks

- `node --test tests/test_public_data.js tests/test_public_proxy.cjs`
- `node tests/test_india_map_data.js`
- `npm ci --prefix tests/sql --ignore-scripts` then
  `node --test tests/test_vacancy_access.cjs`
- `python -m unittest discover -s tests -p test_public_snapshots.py`
- `python -m pytest tests/test_snapshot_browsing.py tests/test_watchlist.py tests/test_my_deputation.py`
- `node --test workers/sb-proxy/worker.test.js`
- `python scripts/verify_publication.py --base https://alldeputations.com`

The final command must be run after deployment. Running it before merging should
fail, because the new manifest has not been published yet.
