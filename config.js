/* Shared frontend config for alldeputations.com (canonical) /
 * deputations.github.io (GitHub Pages repo URL, still works but not shared).
 *
 * The Supabase `submit` Edge Function is the single backend for all form
 * submissions and the visitor counter (RPC). Previously an Apps Script
 * fallback existed as a runtime "second line"; P3-5 retired it (2026-07-30).
 * If this file fails to load, every form shows an "endpoint not configured"
 * notice — failures surface immediately instead of being silently masked. */

/* Supabase — public vacancies backend.
 * The anon key is SAFE to expose in the browser: Row Level Security limits the
 * anon role to reading only approved vacancies. */
window.SUPABASE_URL = "https://djaxutkmhazufsxeobal.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqYXh1dGttaGF6dWZzeGVvYmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjgzNTksImV4cCI6MjA5NTcwNDM1OX0.AHfWNpMS69KhxGX6Px1fS9dVddo9lUiXvc96hM5UTbU";

/* Cloudflare Worker reverse proxy (P3-7 PR 2).
 *
 * The NIC (National Informatics Centre) government's SSL-inspecting
 * middlebox returns ERR_SSL_PROTOCOL_ERROR for direct browser→Supabase
 * connections — TLS 1.3 + post-quantum + ECH, which NIC's middlebox can't
 * complete.
 *
 * The Cloudflare Worker that used to sit here
 * (`sb-proxy.ncrsarkarishaadi.workers.dev`) never actually worked on NIC,
 * and the reason was NOT TLS: NIC's resolver **DNS-hijacks the whole
 * `*.workers.dev` zone**. Measured from an NIC machine on 2026-08-10 —
 * `dns.nic.in` answers that name with `10.40.124.9` (`e.wg.restricted.in`,
 * the walled garden), so the request never leaves the building. A CNAME
 * would inherit exactly the same fate, which is why the replacement had to
 * be an A record to a bare IP: there is no third-party name left for NIC
 * to intercept.
 *
 * Replacement: an Oracle Cloud Always Free VM in ap-mumbai-1 running Caddy
 * as a transparent reverse proxy to Supabase, reached over an A record.
 * Verified end to end from inside NIC on 2026-08-10:
 *   - `dns.nic.in` resolves api.alldeputations.com → the real IP (no hijack)
 *   - TLS 1.3 completes and the certificate arrives UNMODIFIED, i.e. NIC is
 *     not MITM-ing this host (a self-signed probe came back byte-identical)
 *   - a real REST query through the proxy returned HTTP 200
 * The middlebox's problem was always Cloudflare's exotic handshake, not TLS
 * itself; Caddy + Let's Encrypt negotiate an ordinary one.
 *
 * Wire-up: on production hostname `alldeputations.com` (or its www
 * variant), point SUPABASE_URL at the proxy. Anywhere else (github.io,
 * localhost, dev) keep the direct Supabase URL.
 *
 * See the `deputation-oracle-proxy-vm` note for the VM, SSH key and the
 * two traps (both firewalls must be opened; A record never CNAME).
 */
(function () {
  try {
    var h = (typeof location !== "undefined" && location.hostname) || "";
    if (h === "alldeputations.com" || h === "www.alldeputations.com") {
      window.SUPABASE_URL = "https://api.alldeputations.com";
    }
  } catch (e) { /* SSR / tests: keep the direct URL */ }
})();
window.SUPABASE_READY = function () {
  return /^https:\/\/[a-z0-9.-]+$/.test(window.SUPABASE_URL || "") &&
    (window.SUPABASE_ANON_KEY || "").length > 20 &&
    !/YOUR_/.test(window.SUPABASE_ANON_KEY || "");
};

/* NIC detection (P3-7 PR 1) — a one-time probe so every Supabase consumer
 * can short-circuit on networks where TLS to Supabase fails (e.g. NIC's
 * SSL-inspecting middlebox returns ERR_SSL_PROTOCOL_ERROR before HTTP).
 *
 * State machine:
 *   null  → not probed yet (probe is in flight or hasn't been kicked off)
 *   true  → TLS to Supabase succeeded at least once this session
 *   false → TLS to Supabase failed; stop trying until the page reloads
 *
 * Probe is a HEAD request to /rest/v1/ with the apikey header. Any HTTP
 * response (even 401) means the TLS handshake completed. A fetch rejection
 * (SSL error, DNS failure, abort) means Supabase is unreachable from this
 * network. 2-second timeout so a slow-but-OK Supabase doesn't block the
 * page indefinitely.
 */
window.SUPABASE_AVAILABLE = null;
window.ensureSupabaseAvailable = function () {
  if (window.SUPABASE_AVAILABLE !== null) return Promise.resolve(window.SUPABASE_AVAILABLE);
  if (!window.SUPABASE_READY || !window.SUPABASE_READY()) {
    window.SUPABASE_AVAILABLE = false;
    return Promise.resolve(false);
  }
  if (window.__supabaseProbeInFlight) return window.__supabaseProbeInFlight;
  var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
  var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, 2000);
  window.__supabaseProbeInFlight = fetch(window.SUPABASE_URL + "/rest/v1/", {
    method: "HEAD",
    headers: { apikey: window.SUPABASE_ANON_KEY },
    signal: ctrl ? ctrl.signal : undefined,
    mode: "cors",
  })
    .then(function () {
      window.SUPABASE_AVAILABLE = true;
      return true;
    })
    .catch(function () {
      window.SUPABASE_AVAILABLE = false;
      document.body && document.body.classList.add("is-supabase-down");
      return false;
    })
    .then(function (v) {
      clearTimeout(timer);
      window.__supabaseProbeInFlight = null;
      return v;
    });
  return window.__supabaseProbeInFlight;
};

/* Web Push (vacancy alerts). The VAPID PUBLIC key is safe to expose — it only
 * identifies this server to the browser's push service; the matching PRIVATE
 * key lives only in the Supabase `push-notify` function's secrets. Push stays
 * disabled until this is a real key and the push-subscribe function is live. */
window.VAPID_PUBLIC_KEY = "BFwXP5B3Vt7GEck0voyf0cYBoibKwxJuwDk94AlHcBIwI0w2aUVr9u5G051v1KdN8st9Fqm2EPtxiTNHdTEiETI";
window.PUSH_READY = function () {
  return window.SUPABASE_READY() &&
    typeof window.VAPID_PUBLIC_KEY === "string" &&
    window.VAPID_PUBLIC_KEY.length > 80;
};
