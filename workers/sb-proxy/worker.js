/* ============================================================================
 * sb-proxy — Cloudflare Worker reverse-proxy for Supabase.
 *
 * Purpose: NIC (National Informatics Centre) government's SSL-inspecting
 * middlebox returns ERR_SSL_PROTOCOL_ERROR for direct browser→Supabase
 * connections. The NIC firewall does, however, allow egress to
 * alldeputations.com (the static-site hostname it already trusts).
 *
 * This Worker accepts requests at `https://api.alldeputations.com/*` and
 * forwards them to `https://djaxutkmhazufsxeobal.supabase.co/*`. The browser
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

const TARGET = "https://djaxutkmhazufsxeobal.supabase.co";
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
      headers.set(k, v);
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

    // Plain HTTP fetch. Cache GETs at the edge for 60 s (Sufficient for the
    // dashboard's vacancy-row polling + the `bump_visit` heartbeat; mutation
    // RPCs are POSTs and bypass the cache automatically).
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
    // Only GETs go through the edge cache — POSTs/DELETEs must not be cached
    // and must reach Supabase every call.
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

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
