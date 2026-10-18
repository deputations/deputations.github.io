/* ============================================================================
 * sb-proxy — Cloudflare Worker reverse-proxy for Supabase.
 *
 * Purpose: NIC (National Informatics Centre) government's SSL-inspecting
 * middlebox returns ERR_SSL_PROTOCOL_ERROR for direct browser→Supabase
 * connections. The NIC firewall does, however, allow egress to
 * alldeputations.com (the static-site hostname it already trusts).
 *
 * This Worker accepts requests at `https://api.alldeputations.com/*` and
 * forwards them to `https://cwygwxhvpcthaejvlfqv.supabase.co/*`. The browser
 * speaks TLS to alldeputations.com (allowed); the Worker speaks TLS to
 * Supabase (Cloudflare→Cloudflare, no middlebox in between).
 *
 * Handles every Supabase surface the dashboard uses:
 *   - REST  : GET/POST/DELETE  /rest/v1/*
 *   - RPC   : POST             /rest/v1/rpc/<fn>
 *   - Edge  : POST             /functions/v1/*
 *   - Realtime: WebSocket upgrade on /realtime/v1/websocket?apikey=...
 *
 * Auth: the apikey + Authorization: Bearer headers come from the browser
 * unchanged — the Worker is a transparent pass-through. We do not log them
 * to avoid leaking secrets into Cloudflare logs.
 *
 * CORS: Supabase's own responses already carry Access-Control-Allow-Origin
 * for any allowed origin. We pass them through. For preflight (OPTIONS) we
 * respond directly with permissive headers because the Worker script can
 * answer faster than a Supabase roundtrip, and Supabase's OPTIONS handler
 * occasionally returns 404 on path-not-found (404 doesn't carry CORS
 * headers, so the browser blocks the follow-up POST).
 *
 * Deploy: `wrangler deploy` from `workers/sb-proxy/`. Route is configured
 * in wrangler.toml.
 * ========================================================================== */

import { verifyProxyToken } from '../../supabase/functions/_shared/public-proxy.js';

const TARGET = "https://cwygwxhvpcthaejvlfqv.supabase.co";
const ALLOW_ORIGIN = "*"; // anon-key is public; same as Supabase's policy

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization,apikey,Content-Type,Range,x-client-info,X-Client-Info,x-supabase-api-version",
  "Access-Control-Expose-Headers":
    "Content-Range,X-Range,X-Total-Count,Content-Length,Content-Encoding,Date",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export default {
  async fetch(request, env, ctx) {
    // Preflight — answer directly. Keeps the hot path off Supabase.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    // This is an early bandwidth guard, not authentication. Supabase validates
    // every forwarded JWT and the database migration enforces the real boundary.
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const knownAnonymous = !token || token === request.headers.get('apikey');
    if (env.BLOCK_PUBLIC_VACANCIES === 'true' && url.pathname === '/rest/v1/vacancies' && knownAnonymous) {
      return Response.json({error:'public_listings_moved', message:'Use the published website snapshot.'},
        {status:410, headers:CORS_HEADERS});
    }
    const optionalPublic = url.pathname === '/functions/v1/semantic-search' ||
      /^\/rest\/v1\/rpc\/(heartbeat|bump_visit|get_sentiment)$/.test(url.pathname);
    if (optionalPublic && env.DISABLE_PUBLIC_LIVE === 'true') {
      return Response.json({error:'temporarily_unavailable'}, {status:503, headers:CORS_HEADERS});
    }
    if (url.pathname === '/functions/v1/semantic-search') {
      if (!env.PUBLIC_PROXY_SECRET || env.PUBLIC_PROXY_SECRET.length < 32) {
        return Response.json({error:'search_unavailable'}, {status:503, headers:CORS_HEADERS});
      }
      // Generous per-network ceiling for a small query endpoint. Keys are not
      // logged; shared office/mobile networks can still share this allowance.
      // The NIC-compatible Oracle ingress overwrites these two headers. Trust
      // its client address only with the server-only token; public callers
      // cannot rotate their limiter key by supplying a forwarded address.
      const ingressIp = request.headers.get('x-public-proxy-client-ip');
      const trustedIngress = ingressIp && ingressIp.length <= 64 &&
        await verifyProxyToken(request.headers.get('x-public-proxy-secret'), env.PUBLIC_PROXY_SECRET);
      const ip = trustedIngress ? ingressIp :
        (request.headers.get('CF-Connecting-IP') || 'unknown-network');
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      const key = Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2,'0')).join('');
      try {
        if (!env.SEARCH_RATE_LIMITER) throw new Error('Missing limiter binding');
        const result = await env.SEARCH_RATE_LIMITER.limit({key});
        if (!result.success) return Response.json({error:'rate_limited'},
          {status:429, headers:{...CORS_HEADERS, 'Retry-After':'60'}});
      } catch (_) {
        // Search can fail closed: keyword search and static listings still work.
        return Response.json({error:'search_unavailable'}, {status:503, headers:CORS_HEADERS});
      }
    }
    // Build the upstream URL by replacing the origin.
    const upstreamUrl = TARGET + url.pathname + url.search;

    // Copy the incoming request headers, but strip those that identify the
    // proxy and break on the upstream. Keep apikey + Authorization intact
    // (the anon key is safe to forward — see comment at top).
    const headers = new Headers();
    for (const [k, v] of request.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk === "host") continue;                  // set by fetch() to the upstream host
      if (lk === "cf-connecting-ip") continue;      // Cloudflare-specific
      if (lk === "cf-ray") continue;
      if (lk === "cf-worker") continue;
      if (lk === "x-forwarded-for") continue;
      if (lk.startsWith("cf-")) continue;
      if (lk === 'x-public-proxy-secret') continue;
      if (lk === 'x-public-proxy-client-ip') continue;
      headers.set(k, v);
    }
    if (url.pathname === '/functions/v1/semantic-search') {
      headers.set('x-public-proxy-secret', env.PUBLIC_PROXY_SECRET);
    }

    // WebSocket upgrade detection. The browser sends Upgrade: websocket +
    // Connection: Upgrade; fetch() with those headers switches to the
    // bidirectional stream and we pass the duplex half back to the caller.
    // `duplex: 'half'` is required when forwarding a streaming request body
    // (per the Fetch spec; without it, Node's undici refuses the Request).
    const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
    if (upgrade === "websocket") {
      const upstreamReq = new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        duplex: "half",
      });
      return fetch(upstreamReq);
    }

    // Pass-through for remaining API calls. Public listing data is served by
    // static hosting; authenticated responses are never shared-cache entries.
    const fetchInit = {
      method: request.method,
      headers,
      redirect: "follow",
    };
    // Forward the request body for non-GET/HEAD. `request.body` is a
    // ReadableStream that fetch() consumes on the way out; cloning is not
    // required here because the original Request is consumed by the Worker
    // and not used again. GET/HEAD requests have a null body, which fetch()
    // accepts as "no body".
    if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
      fetchInit.body = request.body;
    }
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, fetchInit);
    } catch (err) {
      // Upstream TLS or network failure. Return a 502 with CORS so the
      // browser's fetch() .then() sees a real response (not a network
      // rejection that would surface as ERR_SSL_PROTOCOL_ERROR on NIC).
      return new Response(
        JSON.stringify({ error: "upstream_unreachable", detail: String(err) }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // Build the response, copying headers but stripping those that don't
    // make sense on a cross-origin response from a proxy.
    const respHeaders = new Headers();
    for (const [k, v] of upstream.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk === "set-cookie") continue;  // Supabase refresh cookies; skip to avoid surprises
      if (lk === "strict-transport-security") continue;
      respHeaders.set(k, v);
    }
    // Layer CORS on top — if upstream already set Access-Control-Allow-Origin,
    // ours wins (browsers see our wildcard which is what Supabase itself sends).
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      respHeaders.set(k, v);
    }
    respHeaders.set('Cache-Control', 'no-store');
    // No URL query, IP, credentials, or response body in observability logs.
    console.log(JSON.stringify({event:'upstream_response', path:url.pathname,
      method:request.method, status:upstream.status,
      response_length:upstream.headers.get('Content-Length')}));

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
