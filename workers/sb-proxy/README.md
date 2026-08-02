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

## Deploy

```bash
cd workers/sb-proxy
npm install -g wrangler          # one-time
wrangler login                    # one-time
wrangler deploy
```

After deploy, Cloudflare prints a `*.workers.dev` URL. To wire it into
production:

1. **Custom domain** — Workers dashboard → sb-proxy → Settings → Triggers
   → Custom Domains → add `api.alldeputations.com`. Cloudflare auto-issues
   a TLS cert via the existing zone's Universal SSL setup.
2. **`config.js`** — already wired: when the static site is loaded from
   `alldeputations.com` (or `www.alldeputations.com`), `SUPABASE_URL` is
   rewritten to `https://api.alldeputations.com` at boot. Any other
   hostname (github.io, localhost, dev) keeps the direct URL.

No changes are needed at any call site — `fetchVacancies()`, the four
RPC sites in `site-widgets.js`, `realtime-toast.js`'s WebSocket, and
`runSemanticSearch()` all read `window.SUPABASE_URL`.

## Cost

- **Free plan**: 100,000 requests/day + **no WebSocket egress**. WebSocket
  support requires Workers Paid ($5/mo, includes 1M requests + persistent
  connections). Given the dashboard sees ~38k visitors/month (~1.3k/day) on
  good days, Workers Paid is needed.
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
