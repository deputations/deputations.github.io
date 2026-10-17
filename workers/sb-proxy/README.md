# Protected AI search proxy

Production flow (verified 18 October 2026 IST):

`browser -> api.alldeputations.com (Oracle/Caddy) -> sb-proxy Worker -> semantic-search`

The Oracle A record stays in place for government-network compatibility. Only
`/functions/v1/semantic-search` uses the Worker. Other backend features continue
through Oracle to Supabase. Public listings come from GitHub Pages snapshots.
Do not point the browser directly at workers.dev: NIC networks have blocked it.

The Worker enforces 60 searches/minute/network/Cloudflare location. This is an
abuse throttle, not an organization-wide egress cap. The server-only
PUBLIC_PROXY_SECRET is shared with the guarded Edge Function and the protected
Caddy snippet. Caddy overwrites the token and client-address headers; the Worker
accepts that address only with a valid token, otherwise uses CF-Connecting-IP.
Neither credential nor raw client address is logged or sent to the browser.
The client-address header is stripped before Supabase. Do not trust a public
X-Forwarded-For header as a limiter key.

Configure the verified account in wrangler.toml. Use the pinned project-local
Wrangler, test, then dry-run and deploy with a protected secrets file (not a
command-line token). Preserve dashboard variables. See EGRESS-RECOVERY.md for
rollout order, version IDs and limitations. Oracle templates are in
../oracle-proxy/. Keep its rendered secret snippet out of Git.

BLOCK_PUBLIC_VACANCIES returns 410 for recognizable anonymous bulk table calls
sent directly to the Worker. The live database enforces the final access boundary
for all routes. DISABLE_PUBLIC_LIVE pauses Worker search/counters, but production
counters bypass this Worker and require a separate ingress change to pause.

Missing secret or limiter fails search closed. Keyword search and static vacancy
browsing remain available during quota or upstream failures. Publicly displayed
listings can still be copied; private database columns and draft records are not
part of the public snapshots.

Structured logs contain path, method, status and response content length only.
Inspect persisted request/invocation metadata separately when investigating
abuse; never enable credential/header/body logging.

Validation: `npm test`, then project-local `wrangler deploy --dry-run`. Production
validation must check the Oracle route, direct function rejection and limiter
behavior. A provider-quota 503 after passing the proxy is not a routing failure.
