# sb-proxy — Cloudflare Worker reverse proxy for Supabase

## Why

Primary users of alldeputations.com are Indian government officers behind the
**NIC (National Informatics Centre)** government firewall. NIC's outbound
proxy is an SSL-inspecting middlebox that **cannot complete the TLS 1.3 +
post-quantum + ECH handshake** that Cloudflare-hosted Supabase requires. The
browser gets `net::ERR_SSL_PROTOCOL_ERROR` for every direct fetch to
`*.supabase.co`.

NIC's firewall DOES, however, allow egress to **`alldeputations.com`** (the
static site is hosted there). The fix is to point Supabase traffic at a
proxy that lives inside that allowed domain.

## What this does

Accepts every request at `https://api.alldeputations.com/*` and forwards it
to `https://djaxutkmhazufsxeobal.supabase.co/*`. Pass-through: the apikey,
Authorization header, body, query string are all unchanged. CORS headers are
layered on top so the browser doesn't see a missing Access-Control-Allow-Origin
on the proxy response (matters for Edge Functions).

Handles every Supabase surface the dashboard uses:

| Surface | Path | Method |
|---|---|---|
| REST tables | `/rest/v1/*` | GET/POST/PATCH/DELETE |
| RPC | `/rest/v1/rpc/<name>` | POST |
| Edge Functions | `/functions/v1/*` | POST |
| Realtime | `/realtime/v1/websocket?apikey=...` | GET (Upgrade: websocket) |

## Deploy status (2026-08-02)

Worker deployed at `https://sb-proxy.ncrsarkarishaadi.workers.dev` and
verified end-to-end:

```bash
curl -sS -H "apikey: <anon>" \
  "https://sb-proxy.ncrsarkarishaadi.workers.dev/rest/v1/vacancies?select=vacancy_id&limit=2"
# → [{"vacancy_id":"AAFW-2026-L7-041"}, {"vacancy_id":"AAFW-2026-L7-042"}]
```

`config.js` points `SUPABASE_URL` at the workers.dev host when the page
is loaded from `alldeputations.com`. Anywhere else (github.io, localhost,
dev) keeps the direct Supabase URL.

## Custom domain (NOT planned — blocked at the zone level)

The original plan was `api.alldeputations.com` as a Cloudflare custom
domain. **Status: blocked, not just pending.** Worker's Custom Domains
functionality requires the host to be on a Cloudflare-managed zone. The
apex `alldeputations.com` is currently registered on **Wix DNS**
(`ns10.wixdns.net`, `ns11.wixdns.net`) — not on this Cloudflare account.
Verified via Cloudflare REST API
(`/zones?name=alldeputations.com` → `total_count: 0`).

This means **no token scope alone can fix it.** A new API token with
`Zone:DNS:Edit` + `Workers Routes:Edit` is necessary but not sufficient
— the zone itself has to be on Cloudflare first. Cloudflare's
"partial CNAME setup" on the free plan only delegates the apex to CF;
subdomains on a non-CF apex still aren't reachable from CF's edge
without the apex NS there.

The only paths forward are:

1. **Full zone migration** (move NS from Wix → Cloudflare). High-risk —
   touches the apex of a production site. Out of scope for P3-7.
2. **Skip the custom domain** — current state. The workers.dev URL is
   the canonical proxy host and works end-to-end on the production
   hostname via the `config.js` rewrite.

If path (1) is taken later:

1. Migrate `alldeputations.com` to this Cloudflare account.
2. Uncomment the `routes` block in `wrangler.toml` and `wrangler deploy`.
3. Update `config.js` to point at `https://api.alldeputations.com`.

Until then the workers.dev URL is the canonical proxy host and is
working in production.

## Cost

- **Currently on Workers Free** (downgraded 2026-08-03 from Paid). The
  dashboard's REST + RPC + Edge Function traffic fits comfortably in the
  100,000 requests/day free-tier quota (~38k visitors/month, ~1.3k/day
  peak).
- WebSocket support is NOT included on Free. The realtime-toast live-push
  feature (Supabase `/realtime/v1/websocket`) is dormant — visitors get
  new-vacancy data via the 60-s polling fallback in `realtime-toast.js`.
  This was a deliberate trade-off: the polling fallback already runs and
  covers the gap; the WebSocket code path in `worker.js` is retained
  behind an `Upgrade: websocket` header check so flipping back to Paid
  is a one-click plan change with no re-deploy required.
- Bandwidth egress is unmetered.
- Cold starts are <5 ms; warm requests are sub-ms.

## Observability

`wrangler tail` streams logs. With `[observability] enabled = true` in
`wrangler.toml`, request-level traces appear in Cloudflare dashboard →
Workers → sb-proxy → Logs.

The Worker does **not** log the apikey header. Everything else is fair game.

## Smoke verification

After deploy, run from any NIC network:

```bash
curl -sI -H "apikey: $ANON" https://api.alldeputations.com/rest/v1/
# Expected: HTTP/2 200 (Supabase's 200 for an empty body on a HEAD probe
# with no query), even on NIC.
```

If that returns 200 inside NIC, the dashboard loads end-to-end: AI search,
visitor counter, sentiment, realtime toasts all work.

## Security

- The apikey is in the request body / header, not in env / secrets. Anyone
  who can reach `api.alldeputations.com` can read the public anon key from
  the static-site bundle anyway — it's `window.SUPABASE_ANON_KEY`. Forwarding
  it through the Worker adds nothing.
- The Worker is read-only as far as secrets go: nothing is added, nothing
  is removed, the request is forwarded verbatim.
- CORS is `Access-Control-Allow-Origin: *` to match Supabase's policy on
  the anon key. The apikey restricts per-row via RLS, so the wildcard is
  safe.
- No rate limiting at the Worker — Cloudflare's WAF is disabled by default
  but can be layered on via Dashboard → Security → WAF → Custom Rules.
