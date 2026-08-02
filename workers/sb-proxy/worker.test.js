/* ============================================================================
 * Worker unit tests — runs under `node --test worker.test.js`.
 *
 * Exercises every code path in worker.js without contacting real Supabase:
 * the global `fetch` is stubbed per-test to assert the upstream URL the
 * Worker builds, plus the response shape it returns to the caller.
 *
 * No wrangler/miniflare dependency — keeps the test as a single-file
 * Node test that runs in CI with zero `npm install` overhead.
 *
 * Run:
 *   node --test workers/sb-proxy/worker.test.js
 *   # or
 *   cd workers/sb-proxy && npm test
 * ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

/** Build a minimal `ctx` object. */
function ctx() {
  return { waitUntil: () => {}, passThroughOnException: () => {} };
}

/** Stub the global fetch so the Worker sees a deterministic upstream. */
function stubFetch(impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = orig; };
}

test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const restore = stubFetch(() => {
    throw new Error("preflight should not call upstream");
  });
  try {
    const req = new Request("https://api.alldeputations.com/rest/v1/rpc/bump_visit", {
      method: "OPTIONS",
      headers: {
        Origin: "https://alldeputations.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.status, 204);
    assert.equal(resp.headers.get("Access-Control-Allow-Origin"), "*");
    assert.match(resp.headers.get("Access-Control-Allow-Methods"), /POST/);
    assert.match(
      resp.headers.get("Access-Control-Allow-Headers"),
      /Authorization|apikey/,
    );
  } finally { restore(); }
});

test("forwards GET to upstream with path + query unchanged", async () => {
  let captured;
  const restore = stubFetch(async (url, init) => {
    captured = { url: typeof url === "string" ? url : url.url, init };
    return new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const req = new Request(
      "https://api.alldeputations.com/rest/v1/vacancies?status=eq.approved&limit=5",
      { method: "GET", headers: { apikey: "test-key", Authorization: "Bearer test-key" } },
    );
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.status, 200);
    assert.match(
      captured.url,
      /^https:\/\/djaxutkmhazufsxeobal\.supabase\.co\/rest\/v1\/vacancies\?status=eq\.approved&limit=5$/,
    );
    assert.equal(captured.init.method, "GET");
    assert.equal(captured.init.headers.get("apikey"), "test-key");
    assert.equal(captured.init.headers.get("authorization"), "Bearer test-key");
    assert.equal(captured.init.headers.get("host"), null);
    const body = await resp.json();
    assert.deepEqual(body, [{ id: 1 }]);
    assert.equal(resp.headers.get("Access-Control-Allow-Origin"), "*");
  } finally { restore(); }
});

test("forwards POST body to upstream (RPC)", async () => {
  let capturedUrl;
  let capturedBodyText;
  const restore = stubFetch(async (url, init) => {
    capturedUrl = typeof url === "string" ? url : url.url;
    // init.body is a ReadableStream in Node; consume it as text for the
    // assertion. Empty / null body → null.
    if (init && init.body) {
      capturedBodyText = await new Response(init.body).text();
    } else {
      capturedBodyText = null;
    }
    return new Response(JSON.stringify({ ok: true, total: 42 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const req = new Request(
      "https://api.alldeputations.com/rest/v1/rpc/bump_visit",
      {
        method: "POST",
        headers: {
          apikey: "test-key",
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.status, 200);
    assert.match(
      capturedUrl,
      /^https:\/\/djaxutkmhazufsxeobal\.supabase\.co\/rest\/v1\/rpc\/bump_visit$/,
    );
    assert.equal(capturedBodyText, "{}");
  } finally { restore(); }
});

test("upstream failure returns 502 with CORS (never a network rejection)", async () => {
  const restore = stubFetch(async () => {
    throw new Error("TLS handshake failed");
  });
  try {
    const req = new Request("https://api.alldeputations.com/rest/v1/", { method: "HEAD" });
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.status, 502);
    assert.equal(resp.headers.get("Access-Control-Allow-Origin"), "*");
    const body = await resp.json();
    assert.equal(body.error, "upstream_unreachable");
  } finally { restore(); }
});

test("strips cf-* / forwarded / host on the way to upstream", async () => {
  let captured;
  const restore = stubFetch(async (url, init) => {
    captured = { init };
    return new Response("ok", { status: 200 });
  });
  try {
    const req = new Request("https://api.alldeputations.com/rest/v1/vacancies", {
      method: "GET",
      headers: {
        apikey: "k",
        "CF-Connecting-IP": "1.2.3.4",
        "CF-Ray": "abc",
        "X-Forwarded-For": "1.2.3.4",
        Host: "api.alldeputations.com",
      },
    });
    await worker.fetch(req, {}, ctx());
    assert.equal(captured.init.headers.get("cf-connecting-ip"), null);
    assert.equal(captured.init.headers.get("cf-ray"), null);
    assert.equal(captured.init.headers.get("x-forwarded-for"), null);
    assert.equal(captured.init.headers.get("host"), null);
    assert.equal(captured.init.headers.get("apikey"), "k");
  } finally { restore(); }
});

test("strips set-cookie + hsts on the way back to caller; layers CORS", async () => {
  const restore = stubFetch(async () => {
    return new Response("ok", {
      status: 200,
      headers: {
        "Set-Cookie": "session=secret",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Total-Count": "42",
      },
    });
  });
  try {
    const req = new Request("https://api.alldeputations.com/rest/v1/vacancies", { method: "GET" });
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.headers.get("Set-Cookie"), null);
    assert.equal(resp.headers.get("Strict-Transport-Security"), null);
    assert.equal(resp.headers.get("X-Total-Count"), "42");
    assert.equal(resp.headers.get("Access-Control-Allow-Origin"), "*");
  } finally { restore(); }
});

test("websocket upgrade: passes Upgrade header through, returns upstream response", async () => {
  let captured;
  const restore = stubFetch(async (arg) => {
    // The WS branch calls `fetch(upstreamReq)` with a single Request arg.
    captured = arg instanceof Request ? arg : new Request(arg);
    // Node's Response constructor rejects 101 (out of range 200-599); the
    // Worker doesn't care about the upstream status code here — it just
    // returns the response verbatim so the browser sees the 101 we set
    // when reaching real Cloudflare. Return a 200 from the stub to keep
    // the test exercising the Worker code path without going outside 200-599.
    return new Response("ws-tunnel", {
      status: 200,
      headers: { Upgrade: "websocket" },
    });
  });
  try {
    const req = new Request(
      "https://api.alldeputations.com/realtime/v1/websocket?apikey=k&vsn=1.0.0",
      {
        method: "GET",
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      },
    );
    const resp = await worker.fetch(req, {}, ctx());
    assert.equal(resp.status, 200);
    assert.match(
      captured.url,
      /^https:\/\/djaxutkmhazufsxeobal\.supabase\.co\/realtime\/v1\/websocket/,
    );
    assert.equal(captured.headers.get("upgrade"), "websocket");
  } finally { restore(); }
});
