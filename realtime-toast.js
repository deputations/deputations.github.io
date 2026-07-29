/* ============================================================================
   realtime-toast.js — P3-1: "N new vacancies since you opened"

   Two layers feed one toast queue:
   1. Supabase Realtime (WebSocket) — instant on home network when Supabase
      is reachable. Best-effort, fail-silent on errors (NIC networks, WS
      blocked, RLS doesn't grant the anon key realtime SELECT, etc.).
   2. Polling fallback — fetches data/vacancies.json every 60s, diffs
      Vacancy_IDs against the "seen" set. Works on every network
      including NIC because it's same-origin over GitHub Pages TLS.

   Both layers add new Vacancy_IDs to an internal Set. The toast only
   fires once per ID. Click → scrolls to top + triggers a refresh.

   Self-contained: doesn't touch app.js state. Doesn't ship supabase-js.
   Reuses window.showHomeToast() from app.js for the actual toast UI.
   Loads as `defer` after app.js on index.html only.
   ============================================================================ */
(function () {
  "use strict";
  if (window.__realtime_toast_loaded) return; window.__realtime_toast_loaded = true;

  var SB_URL  = (window.SUPABASE_URL || "").replace(/\/+$/, "");
  var SB_KEY  = window.SUPABASE_ANON_KEY || "";
  var HOST    = (window.location.hostname || "").toLowerCase();
  var SUPABASE_HOST_RE = /\.supabase\.co$/i;

  /* ---- state ---- */
  var seenIds      = new Set();          // Vacancy_IDs already in the dataset
  var pendingIds   = new Set();          // new IDs queued for toast
  var pendingMeta  = {};                 // id -> { post_name, days_left }
  var lastToastAt  = 0;                  // debounce ms
  var pollTimer    = null;
  var ws           = null;
  var wsInitedAt   = 0;

  /* ---- bootstrap: fetch /data/vacancies.json to populate seenIds ---- */
  function bootstrap() {
    return fetch("data/vacancies.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        (rows || []).forEach(function (r) {
          if (r && r.Vacancy_ID) seenIds.add(String(r.Vacancy_ID));
        });
      })
      .catch(function () { /* ignored — polling will retry */ });
  }

  /* ---- common: append a new id to the queue, show toast if due ---- */
  function enqueue(id, meta) {
    if (!id) return;
    id = String(id);
    if (seenIds.has(id) || pendingIds.has(id)) return;
    pendingIds.add(id);
    if (meta) pendingMeta[id] = meta;
    scheduleToast();
  }
  function scheduleToast() {
    if (Date.now() - lastToastAt < 1000) return; // 1s debounce — batch multiple events
    lastToastAt = Date.now();
    // Give app.js a beat to render in case the toast and the row arrive at the same time
    setTimeout(showToast, 80);
  }
  function showToast() {
    if (typeof window.showHomeToast !== "function") return;
    var count = pendingIds.size;
    if (!count) return;
    var html;
    if (count === 1) {
      var id = pendingIds.values().next().value;
      var meta = pendingMeta[id] || {};
      var post = String(meta.post_name || "New vacancy").replace(/[<>]/g, "");
      var days = (typeof meta.days_left === "number") ? formatDays(meta.days_left) : "";
      var html2 = days ? post + " · " + days : post;
      html = "<strong>1 new vacancy:</strong> " + escapeHtml(html2) +
              ' <a href="#" data-rt-reload="1">View</a>';
    } else {
      html = "<strong>" + count + " new vacancies</strong> since you opened" +
              ' <a href="#" data-rt-reload="1">View them</a>';
    }
    // The toast helper auto-dismisses after a while; pendingIds survives so
    // a later "1 more new" toast can still fire even if the user dismisses.
    window.showHomeToast(html);
  }
  function formatDays(n) {
    if (n < 0) return "expired";
    if (n === 0) return "closes today";
    if (n === 1) return "closes tomorrow";
    return "closes in " + n + " days";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /* ---- global click handler: any [data-rt-reload] reloads + scrolls ---- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-rt-reload]");
    if (!a) return;
    e.preventDefault();
    pendingIds.clear();
    pendingMeta = {};
    var path = window.location.pathname;
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Force a refresh of the dataset by appending a cache-bust qs
    window.location.href = path + "?refresh=" + Date.now();
  });

  /* ---- layer 1: polling /data/vacancies.json every 60s ---- */
  function startPolling() {
    pollTimer = setInterval(function () {
      fetch("data/vacancies.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          (rows || []).forEach(function (r) {
            if (!r || !r.Vacancy_ID) return;
            var id = String(r.Vacancy_ID);
            if (seenIds.has(id)) return;
            // Only enqueue if not already pending
            if (pendingIds.has(id)) return;
            // Compute days_left if Status wasn't yet recomputed by app
            var days = null;
            var lda = String(r.Last_Date_To_Apply || "");
            if (lda) {
              var d = new Date(lda + "T00:00:00");
              var t = new Date(); t.setHours(0,0,0,0);
              if (!isNaN(d.getTime())) days = Math.round((d - t) / 86400000);
            }
            enqueue(id, { post_name: r.Post_Name, days_left: days });
          });
        })
        .catch(function () {});
    }, 60 * 1000);
  }

  /* ---- layer 2: Supabase Realtime (Phoenix protocol over WebSocket) ---- */
  /* This is best-effort. Failure modes:
     - browser blocks WS (rare, but iOS Safari requires HTTPS only)
     - Supabase project doesn't have 'vacancies' in the supabase_realtime publication
     - RLS doesn't grant anon key realtime SELECT on vacancies
     - any network error
     In any case, the polling layer still works. */
  function startRealtime() {
    if (!window.WebSocket) return;
    if (!SB_URL || !SUPABASE_HOST_RE.test(SB_URL)) return;
    var wsUrl = "wss://" + SB_URL.replace(/^https?:\/\//, "") +
                "/realtime/v1/websocket?apikey=" + encodeURIComponent(SB_KEY) +
                "&vsn=1.0.0";
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) { return; }
    wsInitedAt = Date.now();
    var refCounter = 1;
    function send(topic, event, payload) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ topic: topic, event: event, payload: payload || {}, ref: String(refCounter++) }));
    }
    ws.addEventListener("open", function () {
      send("vacancies", "phx_join", {
        config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "INSERT", schema: "public", table: "vacancies" }] },
        postgres_changes: { event: "INSERT", schema: "public", table: "vacancies" }
      });
    });
    ws.addEventListener("message", function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.event === "postgres_changes" && m.payload && m.payload.eventType === "INSERT") {
        var row = m.payload.new || {};
        var id = row.vacancy_id || row.Vacancy_ID;
        if (!id) return;
        enqueue(String(id), {
          post_name: row.post_name || row.Post_Name,
          days_left: typeof row.days_left === "number" ? row.days_left : null
        });
      }
    });
    ws.addEventListener("error", function () { /* polling still works */ });
    ws.addEventListener("close", function () { ws = null; });
  }

  /* ---- heartbeat the websocket ---- */
  setInterval(function () {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(Date.now()) })); } catch (e) {}
    }
  }, 25 * 1000);

  /* ---- boot ---- */
  function init() {
    bootstrap().then(function () {
      startPolling();
      startRealtime();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
