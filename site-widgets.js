/* ============================================================================
   site-widgets.js  —  two self-contained, theme-aware floating widgets:
     1) Feedback (top-right): 👍 / 👎 with a live thumbs-up count; 👎 → "how can
        we improve" → Contact feedback form. Records sentiment in Supabase.
     2) Visitor counter (bottom-left): Total / Today / Online now (real, global).

   No dependencies. Injects its own styles (brand palette, dark/light aware via
   <html data-theme>). Talks to Supabase SECURITY DEFINER RPCs with the public
   anon key (migration 0007). Degrades gracefully if Supabase isn't configured.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__sw_loaded) return; window.__sw_loaded = true;

  /* ---- Supabase RPC helper (graceful no-op when unavailable) -------------
   * Circuit breaker: after SB_FAIL_THRESHOLD consecutive RPC failures (typical
   * on NIC networks where SSL-intercept middleboxes can't complete a TLS
   * handshake with Supabase), we set SB_OK=false and stop trying for this
   * session. This prevents the heartbeat from spamming the console with
   * ERR_SSL_PROTOCOL_ERROR every 35s. */
  var SB_URL = (window.SUPABASE_URL || "").replace(/\/+$/, "");
  var SB_KEY = window.SUPABASE_ANON_KEY || "";
  // P3-7 PR 2: SUPABASE_URL may be the Cloudflare Worker proxy
  // (sb-proxy.ncrsarkarishaadi.workers.dev) on the production hostname to
  // survive NIC's SSL-intercepting middlebox. The old hard-coded regex
  // required `.supabase.co` and silently disabled RPCs on alldeputations.com —
  // the heart click never reached the vote table. Delegate to config.js's
  // SUPABASE_READY() (already widened in PR 2) so the gate stays in lock-step
  // with the URL the rest of the app uses.
  var SB_OK  = !!(window.SUPABASE_READY && window.SUPABASE_READY());
  var SB_FAIL_THRESHOLD = 3;
  var sb_fail_count = 0;

  function rpc(fn, body) {
    if (!SB_OK) return Promise.resolve(null);
    return fetch(SB_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
      },
      body: JSON.stringify(body || {}),
    })
      .then(function (r) {
        if (!r.ok) { onRpcFail(); return null; }
        sb_fail_count = 0;
        return r.json();
      })
      .catch(function () { onRpcFail(); return null; });
  }
  function onRpcFail() {
    sb_fail_count++;
    // First failure: surface the offline state via the body class — other
    // CSS (the AI search bar's `.is-unavailable` dimming, etc.) hooks off
    // it. We don't synchronously fail-on-first-error — one transient
    // network blip shouldn't yank the live count.
    if (sb_fail_count === 1) {
      document.body && document.body.classList.add("is-supabase-down");
    }
    if (sb_fail_count >= SB_FAIL_THRESHOLD) {
      SB_OK = false;
      // Hide the visitor counter pill entirely once we know Supabase is
      // unreachable from this network (e.g. NIC). Avoids further heartbeat
      // fetches and the resulting console noise.
      var c = document.querySelector(".sw-counter");
      if (c) c.style.display = "none";
    }
  }

  /* ---- tiny utils -------------------------------------------------------- */
  function uid() {
    try { return crypto.randomUUID(); }
    catch (e) { return "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  }
  function pageKey() {
    var p = (location.pathname || "/").replace(/index\.html$/i, "").replace(/\/+$/, "");
    return p === "" ? "/" : p;
  }
  function fmt(n) { try { return Number(n).toLocaleString(); } catch (e) { return String(n); } }
  function ls(get, key, val) {
    try { return get ? localStorage.getItem(key) : localStorage.setItem(key, val); } catch (e) { return null; }
  }
  function ss(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : sessionStorage.setItem(key, val); } catch (e) { return null; }
  }
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function countUp(el, target) {
    target = Number(target) || 0;
    if (REDUCED) { el.textContent = fmt(target); return; }
    var dur = 1100, start = performance.now();
    function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.floor(eased * target));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
    }
    requestAnimationFrame(tick);
  }

  /* ---- styles (self-contained, themed) ----------------------------------- */
  /* Reader-speed typewriter pace shared between CSS and JS. 260 ms ≈ 230 wpm,
     which is literal reading pace (defex #manpower v7.3.11 — owner retuned
     from 55 ms → 110 ms → 260 ms across three rounds and settled here). */
  var TYPE_PACE_MS = 260;
  var CSS = "" +
  ":root{--sw-z:70}" +
  ".sw-counter,.sw-fb{position:fixed;z-index:var(--sw-z);" +
    "font-family:'Plus Jakarta Sans','Inter',system-ui,-apple-system,sans-serif;" +
    "-webkit-font-smoothing:antialiased;box-sizing:border-box}" +
  ".sw-counter *,.sw-fb *{box-sizing:border-box}" +

  /* palette (dark default) */
  ".sw-counter,.sw-fb,.sw-footer,.sw-modal,.sw-menu-btn,.sw-sheet{--sw-surface:rgba(15,23,42,.82);--sw-surface2:rgba(30,41,59,.9);" +
    "--sw-border:rgba(148,163,184,.18);--sw-text:#f8fafc;--sw-muted:#94a3b8;" +
    "--sw-primary:#22d3ee;--sw-accent:#a78bfa;--sw-good:#34d399;--sw-bad:#f87171;" +
    "--sw-gold:#fbbf24;--sw-shadow:0 14px 40px -12px rgba(0,0,0,.6)}" +
  "html[data-theme='light'] .sw-counter,html[data-theme='light'] .sw-fb,html[data-theme='light'] .sw-footer,html[data-theme='light'] .sw-modal,html[data-theme='light'] .sw-menu-btn,html[data-theme='light'] .sw-sheet{" +
    "--sw-surface:rgba(255,255,255,.92);--sw-surface2:rgba(248,250,252,.96);" +
    "--sw-border:rgba(15,23,42,.10);--sw-text:#0f172a;--sw-muted:#64748b;" +
    "--sw-primary:#0284c7;--sw-accent:#7c3aed;--sw-good:#16a34a;--sw-bad:#e11d48;" +
    "--sw-gold:#b8860b;--sw-shadow:0 16px 40px -14px rgba(15,23,42,.22)}" +

  /* ===== VISITOR COUNTER (bottom-left) — display only, never blocks clicks ===== */
  ".sw-counter{left:16px;bottom:16px;pointer-events:none}" +
  ".sw-counter .sw-c{display:inline-flex;align-items:stretch;gap:0;" +
    "background:var(--sw-surface);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);" +
    "border:1px solid var(--sw-border);border-radius:14px;padding:5px;box-shadow:var(--sw-shadow);color:var(--sw-text);" +
    "transform:translateY(8px);opacity:0;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .5s ease}" +
  ".sw-counter.sw-in .sw-c{transform:none;opacity:1}" +
  ".sw-c .cell{padding:5px 12px;text-align:center;position:relative}" +
  ".sw-c .cell+.cell::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:1px;background:var(--sw-border)}" +
  ".sw-c .num{font-family:'Sora','Plus Jakarta Sans',sans-serif;font-weight:700;font-size:.98rem;line-height:1;" +
    "font-variant-numeric:tabular-nums;letter-spacing:.3px;display:inline-flex;align-items:center}" +
  ".sw-c .cell.total .num{color:var(--sw-primary)}" +
  ".sw-c .cell.today .num{color:var(--sw-accent)}" +
  ".sw-c .cell.online .num{color:var(--sw-gold)}" +
  ".sw-c .lbl{display:block;margin-top:4px;font-size:.56rem;text-transform:uppercase;letter-spacing:.11em;color:var(--sw-muted);font-weight:600;white-space:nowrap}" +
  ".sw-c .dot{width:7px;height:7px;border-radius:50%;background:var(--sw-gold);margin-right:6px;box-shadow:0 0 0 0 var(--sw-gold);animation:swPulse 1.8s ease-in-out infinite}" +
  "@keyframes swPulse{0%,100%{opacity:1}50%{opacity:.3}}" +
  /* collapsed → tiny chip (used when the pill would cover page UI); hover to peek */
  ".sw-counter .sw-min{display:none;pointer-events:auto;align-items:center;gap:7px;" +
    "background:var(--sw-surface);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);" +
    "border:1px solid var(--sw-border);border-radius:999px;padding:6px 11px;box-shadow:var(--sw-shadow);" +
    "color:var(--sw-muted);font-size:.68rem;font-weight:700;letter-spacing:.05em;white-space:nowrap;cursor:default}" +
  ".sw-min .num{color:var(--sw-primary);font-variant-numeric:tabular-nums;font-weight:800}" +
  ".sw-counter.sw-collapsed .sw-c{display:none}" +
  ".sw-counter.sw-collapsed .sw-min{display:inline-flex}" +
  ".sw-counter.sw-collapsed:hover .sw-c{display:inline-flex;transform:none;opacity:1}" +
  ".sw-counter.sw-collapsed:hover .sw-min{display:none}" +

  /* ===== FEEDBACK (top-right): like (heart + count) + dislike (→ feedback) ===== */
  ".sw-fb{top:76px;right:16px;display:flex;flex-direction:row;align-items:center;gap:8px}" +
  ".sw-fb button{display:inline-flex;align-items:center;gap:7px;cursor:pointer;border:1px solid var(--sw-border);" +
    "background:var(--sw-surface);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);" +
    "color:var(--sw-text);border-radius:999px;padding:8px 13px;box-shadow:var(--sw-shadow);font:inherit;font-weight:700;font-size:.86rem;" +
    "transition:transform .18s ease,border-color .18s ease}" +
  ".sw-fb .dislike{padding:8px 11px}" +
  ".sw-fb .like:hover{transform:translateY(-1px);border-color:var(--sw-bad)}" +
  ".sw-fb .dislike:hover{transform:translateY(-1px);border-color:var(--sw-primary)}" +
  ".sw-fb button svg{width:20px;height:20px;transition:transform .2s cubic-bezier(.34,1.56,.64,1)}" +
  ".sw-fb .like .hp{fill:none;stroke:var(--sw-bad);stroke-width:1.9;stroke-linejoin:round;transition:fill .2s ease}" +
  ".sw-fb .like:hover .hp{fill:rgba(244,63,94,.14)}" +
  ".sw-fb .like:hover svg,.sw-fb .dislike:hover svg{transform:scale(1.1)}" +
  ".sw-fb .dislike svg{color:var(--sw-muted)}" +
  ".sw-fb .dislike:hover svg{color:var(--sw-primary)}" +
  ".sw-fb .like .cnt{font-variant-numeric:tabular-nums;color:var(--sw-text);min-width:.7em;text-align:center}" +
  ".sw-fb .like.on{border-color:var(--sw-bad)}" +
  ".sw-fb .like.on .hp{fill:url(#swHeartGrad);stroke:none}" +
  ".sw-fb .like.on svg{filter:drop-shadow(0 2px 6px rgba(225,29,72,.4));animation:swPop .45s cubic-bezier(.34,1.56,.64,1)}" +
  ".sw-fb.liked .dislike{display:none}" +
  "@keyframes swPop{0%{transform:scale(.6)}60%{transform:scale(1.3)}100%{transform:scale(1)}}" +

  /* ===== DISCLAIMER — footer link + modal ===== */
  ".sw-footer{position:relative;display:flex;justify-content:center;align-items:center;gap:9px;flex-wrap:wrap;text-align:center;" +
    "margin:34px auto 22px;padding:0 16px;font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;font-size:.8rem;color:var(--sw-muted)}" +
  ".sw-footer .sep{opacity:.45}" +
  ".sw-footer .src{opacity:.72}" +
  ".sw-footer .flink{color:var(--sw-primary);font-weight:700;text-decoration:none}" +
  ".sw-footer .flink:hover{color:var(--sw-accent)}" +
  ".sw-footer .sw-updated{position:absolute;right:16px;top:50%;transform:translateY(-50%);opacity:.7;white-space:nowrap}" +
  "@media (max-width:640px){.sw-footer .sw-updated{position:static;transform:none;opacity:.7;flex-basis:100%;margin-top:4px}}" +
  ".sw-footer .disc{cursor:pointer;font:inherit;font-weight:700;color:var(--sw-primary);background:none;border:none;" +
    "padding:4px 4px;border-radius:8px;text-decoration:underline;text-underline-offset:3px}" +
  ".sw-footer .disc:hover{color:var(--sw-accent)}" +

  /* ===== MOBILE NAV (hamburger + bottom sheet, <=768px) ===== */
  ".sw-menu-btn{display:none;align-items:center;justify-content:center;width:40px;height:40px;flex:0 0 auto;margin-left:6px;" +
    "border-radius:12px;border:1px solid var(--sw-border);background:var(--sw-surface);color:var(--sw-text);cursor:pointer}" +
  ".sw-menu-btn svg{width:20px;height:20px}" +
  "@media (max-width:768px){.sw-menu-btn{display:inline-flex}}" +
  ".sw-sheet{position:fixed;inset:0;z-index:3200;display:none;background:rgba(2,6,23,.6);" +
    "-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}" +
  ".sw-sheet.open{display:block}" +
  ".sw-sheet .panel{position:absolute;left:0;right:0;bottom:0;max-height:76vh;overflow:auto;" +
    "border-radius:20px 20px 0 0;background:var(--sw-surface2);border-top:1px solid var(--sw-border);" +
    "box-shadow:var(--sw-shadow);padding:12px 14px calc(20px + env(safe-area-inset-bottom,0px))}" +
  "@media (prefers-reduced-motion:no-preference){.sw-sheet.open .panel{animation:sw-sheet-up .28s cubic-bezier(.16,1,.3,1)}}" +
  "@keyframes sw-sheet-up{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}" +
  ".sw-sheet .hdr{display:flex;align-items:center;justify-content:space-between;padding:4px 6px 10px}" +
  ".sw-sheet .ttl{font-weight:800;color:var(--sw-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em}" +
  ".sw-sheet .x{width:36px;height:36px;border-radius:10px;border:1px solid var(--sw-border);background:var(--sw-surface);" +
    "color:var(--sw-text);font-size:1.05rem;cursor:pointer}" +
  ".sw-sheet nav{display:grid;gap:4px}" +
  ".sw-sheet nav a{display:flex;align-items:center;min-height:46px;padding:.55rem .9rem;border-radius:12px;" +
    "color:var(--sw-text);font-weight:700;text-decoration:none;font-size:.98rem}" +
  ".sw-sheet nav a:active{background:rgba(148,163,184,.14)}" +
  ".sw-sheet nav a.active{background:color-mix(in srgb,var(--sw-primary) 14%,transparent);color:var(--sw-primary)}" +
  ".sw-modal{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;padding:20px;" +
    "background:radial-gradient(circle at 20% 18%,rgba(34,211,238,.10),transparent 30%),radial-gradient(circle at 82% 82%,rgba(167,139,250,.12),transparent 28%),rgba(2,4,11,.82);" +
    "-webkit-backdrop-filter:blur(16px) saturate(120%);backdrop-filter:blur(16px) saturate(120%)}" +
  ".sw-modal.open{display:flex}" +
  "html[data-theme='light'] .sw-modal{background:radial-gradient(circle at 20% 18%,rgba(2,132,199,.10),transparent 30%),radial-gradient(circle at 82% 82%,rgba(124,58,237,.10),transparent 28%),rgba(226,232,240,.72)}" +
  ".sw-modal .card{position:relative;width:min(980px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;" +
    "background:var(--sw-surface);border:1px solid var(--sw-border);border-radius:22px;box-shadow:0 28px 80px -20px rgba(0,0,0,.6);color:var(--sw-text);" +
    "transform:translateY(12px) scale(.984);transition:transform .3s cubic-bezier(.16,1,.3,1)}" +
  ".sw-modal.open .card{transform:none}" +
  ".sw-modal .hd{display:flex;align-items:center;gap:13px;padding:22px 26px 15px;border-bottom:1px solid var(--sw-border)}" +
  ".sw-modal .hd .ic{width:40px;height:40px;flex:0 0 auto;border-radius:12px;display:flex;align-items:center;justify-content:center;" +
    "background:linear-gradient(135deg,var(--sw-primary),var(--sw-accent));color:#fff}" +
  ".sw-modal .hd .ic svg{width:21px;height:21px}" +
  ".sw-modal h3{font-family:'Sora','Plus Jakarta Sans',sans-serif;margin:0;font-size:1.26rem;font-weight:800;letter-spacing:-.02em}" +
  ".sw-modal .hd .sub{margin:3px 0 0;font-size:.76rem;color:var(--sw-muted);font-weight:600;letter-spacing:.01em}" +
  ".sw-modal .bd{overflow-y:auto;padding:18px 26px 24px;line-height:1.64;font-size:.93rem}" +
  ".sw-modal .bd p{margin:0 0 14px}" +
  ".sw-modal .bd p:last-child{margin-bottom:0}" +
  ".sw-modal .bd strong{color:var(--sw-text);font-weight:800}" +
  ".sw-modal .bd .lead{color:var(--sw-primary)}" +
  ".sw-modal .bd .sign{margin-top:4px;color:var(--sw-accent);font-weight:700}" +
  ".sw-modal .sw-sign{display:flex;align-items:center;gap:14px;margin-top:22px;padding-top:18px;border-top:1px solid var(--sw-border)}" +
  ".sw-sign-pic{width:66px;height:66px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;" +
    "color:#fff;background:linear-gradient(135deg,var(--sw-primary),var(--sw-accent));box-shadow:0 8px 20px -8px rgba(0,0,0,.45)}" +
  ".sw-sign-pic svg{width:40px;height:40px;opacity:.92}" +
  ".sw-sign-pic img{width:100%;height:100%;object-fit:cover}" +
  ".sw-sign-info{display:flex;flex-direction:column;gap:1px;line-height:1.45}" +
  ".sw-sign-info strong{font-family:'Sora','Plus Jakarta Sans',sans-serif;color:var(--sw-accent);font-size:1.02rem;font-weight:800}" +
  ".sw-sign-info span{font-size:.84rem;color:var(--sw-muted)}" +
  /* === about-project popup extensions ===================================== */
  /* Longer essay-like content: heading + serif prose + a pull quote +
     disclaimer block. Reuses .sw-modal/.sw-sign above; these rules only add
     what's specific to this popup so the disclaimer stays compact. */
  ".sw-modal .bd .sw-section{margin:22px 0 12px;padding-top:14px;border-top:1px solid var(--sw-border);font-family:'Sora','Plus Jakarta Sans',sans-serif;font-size:.96rem;font-weight:800;letter-spacing:-.01em;color:var(--sw-text);display:flex;align-items:center;gap:8px}" +
  ".sw-modal .bd .sw-section:first-child{margin-top:6px;padding-top:0;border-top:0}" +
  ".sw-modal .bd .sw-section::before{content:'';width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,var(--sw-primary),var(--sw-accent));box-shadow:0 0 8px rgba(34,211,238,.35);flex:0 0 auto}" +
  ".sw-modal .bd .sw-about-prose{margin:0 0 13px;font-family:'Lora','Iowan Old Style','Georgia',serif;font-size:.94rem;line-height:1.72;color:var(--sw-text);font-weight:500}" +
  ".sw-modal .bd .sw-about-prose strong{font-family:'Plus Jakarta Sans','Sora',sans-serif;font-weight:800;color:var(--sw-accent)}" +
  ".sw-modal .bd .sw-link{color:var(--sw-primary);text-decoration:none;border-bottom:1px dashed rgba(34,211,238,.55);padding-bottom:1px;font-weight:700;transition:color .18s,border-color .18s}" +
  ".sw-modal .bd .sw-link:hover{color:var(--sw-accent);border-bottom-color:var(--sw-accent)}" +
  ".sw-modal .bd .sw-quote{display:block;margin:14px 0 18px;padding:12px 16px;border-left:3px solid var(--sw-primary);background:rgba(34,211,238,.07);border-radius:0 10px 10px 0;font-family:'Lora',serif;font-style:italic;font-size:.98rem;color:var(--sw-text);line-height:1.6}" +
  ".sw-modal .bd .sw-about-disclaimer{margin-top:24px;padding:14px 16px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:.82rem;color:var(--sw-muted);line-height:1.55}" +
  ".sw-modal .bd .sw-about-disclaimer p{margin:0}" +
  ".sw-modal .bd .sw-about-disclaimer strong{color:#f5b301;font-weight:700}" +
  "@media(max-width:520px){.sw-modal .bd .sw-about-prose{font-size:.92rem}.sw-modal .bd .sw-quote{font-size:.94rem;padding:10px 14px}}" +
  /* === about-project typewriter (reader-speed reveal) =====================
     Each prose word is wrapped in <span class="sw-type-w" style="--w:N">
     at init time (see buildAboutProject). The bd carries a single
     data-typing attribute that toggles between "pending" (spans at opacity 0)
     and "run" (the staggered fade-in). One CSS transition with per-word
     delay (calc(var(--w) * var(--word-ms))) drives every word off a single
     class flip — no per-word timers, only opacity transitions. */
  ".sw-modal.sw-about .bd[data-typing='pending'] .sw-type-w{opacity:0}" +
  ".sw-modal.sw-about .bd[data-typing='run']{--word-ms:" + TYPE_PACE_MS + "ms}" +
  ".sw-modal.sw-about .bd[data-typing='run'] .sw-type-w{opacity:1;transition:opacity .2s linear;transition-delay:calc(var(--w,0)*var(--word-ms))}" +
  "@media(prefers-reduced-motion:reduce){.sw-modal.sw-about .bd[data-typing] .sw-type-w{opacity:1!important;transition:none!important}}" +
  ".sw-modal .cls{position:absolute;top:15px;right:17px;width:38px;height:38px;border-radius:50%;border:1px solid var(--sw-border);" +
    "background:var(--sw-surface2);color:var(--sw-text);cursor:pointer;font-size:1.25rem;line-height:1;display:flex;align-items:center;justify-content:center}" +
  ".sw-modal .cls:hover{border-color:var(--sw-primary);color:var(--sw-primary)}" +

  /* ===== mobile ===== */
  "@media (max-width:640px){" +
    /* counter sits at the very bottom of the page (in flow), not floating */
    ".sw-counter{position:static;left:auto;bottom:auto;margin:26px auto 14px;display:flex;justify-content:center}" +
    ".sw-c .cell{padding:6px 12px}.sw-c .num{font-size:1.05rem}.sw-c .lbl{font-size:.56rem;letter-spacing:.09em}" +
    ".sw-fb{right:10px}" +
    ".sw-fb .launch .cap{display:none}" +
    ".sw-footer{margin:16px auto 26px;font-size:.76rem}" +
    ".sw-modal{padding:0}.sw-modal .card{width:100%;max-height:100%;height:100%;border-radius:0}" +
    ".sw-modal .hd{padding:18px 18px 13px}.sw-modal h3{font-size:1.12rem}.sw-modal .bd{padding:16px 18px 26px;font-size:.92rem}" +
  "}" +

  /* ---- header title: typewriter on load → continuous gradient flow ---- */
  ".tw-caret{-webkit-text-fill-color:#6B66FF;color:#6B66FF;font-weight:400;margin-left:.02em}" +
  ".tw-caret.on{animation:tw-blink 1s steps(1) infinite}" +
  "@keyframes tw-blink{50%{opacity:0}}" +
  ".gradient-text.tw-flow,.ct-grad.tw-flow,.rv-grad.tw-flow{" +
    "background-image:linear-gradient(90deg,#FF6B6B,#6B66FF,#FF6B6B);background-size:200% auto;" +
    "-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;" +
    "animation:tw-flow 3.5s linear infinite}" +
  "@keyframes tw-flow{to{background-position:200% center}}" +
  "@media (prefers-reduced-motion: reduce){.tw-flow{animation:none!important}.tw-caret{display:none}}";

  function injectCSS() {
    var s = document.createElement("style");
    s.id = "sw-styles"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* SVG icons */
  var SVG_HEART = "<svg viewBox='0 0 24 24'>" +
    "<defs><linearGradient id='swHeartGrad' x1='3' y1='2.5' x2='20' y2='21' gradientUnits='userSpaceOnUse'>" +
      "<stop stop-color='#ff9eb6'/><stop offset='.5' stop-color='#fb5d77'/><stop offset='1' stop-color='#e11d48'/>" +
    "</linearGradient></defs>" +
    "<path class='hp' d='M12 21.3l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.49L12 21.3z'/>" +
  "</svg>";
  var SVG_UP   = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 10v11'/><path d='M15 5.9 14 10h5.6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.2 22H7V10l4-9a2.5 2.5 0 0 1 4 1.9z'/></svg>";
  var SVG_DOWN = "<svg viewBox='0 0 24 24' fill='currentColor'><path d='M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L11.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z'/></svg>";
  var SVG_CHECK= "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5'/></svg>";
  var SVG_ARROW= "<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12h14'/><path d='m13 6 6 6-6 6'/></svg>";
  var SVG_SHIELD = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/><path d='m9 12 2 2 4-4'/></svg>";

  /* path back to site root from this page (handles /Rules/faq.html) */
  function rootPrefix() {
    var depth = (location.pathname.replace(/\/+$/, "").split("/").length - 2);
    return depth > 0 ? "../".repeat(depth) : "";
  }

  /* ===================== VISITOR COUNTER ===================== */
  function buildCounter() {
    var wrap = document.createElement("div");
    wrap.className = "sw-counter";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Visitor statistics");
    wrap.innerHTML =
      "<div class='sw-c'>" +
        "<div class='cell total'><span class='num' data-k='total'>0</span><span class='lbl'>Total visits</span></div>" +
        "<div class='cell today'><span class='num' data-k='today'>0</span><span class='lbl'>Today</span></div>" +
        "<div class='cell online'><span class='num'><span class='dot'></span><span data-k='online'>0</span></span><span class='lbl'>Online now</span></div>" +
      "</div>" +
      "<div class='sw-min' title='Visitor stats — hover to expand'><span class='dot'></span><span class='num' data-k='total-min'>0</span><span>VISITS</span></div>";
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add("sw-in"); });

    // Collapse to the mini chip whenever the full pill would overlap real page
    // UI (filter sidebar, pagination, load-more). rAF-throttled; desktop only —
    // on <=640px the counter is static, in flow, at the page bottom.
    (function guardOverlap() {
      var ticking = false;
      function check() {
        ticking = false;
        if (window.innerWidth <= 640) { wrap.classList.remove("sw-collapsed"); return; }
        var pill = wrap.querySelector(".sw-c");
        var probe = (wrap.classList.contains("sw-collapsed") ? wrap : pill);
        if (!probe) return;
        // measure where the FULL pill would sit (fixed bottom-left)
        var w = pill ? pill.offsetWidth || 260 : 260;
        var h = pill ? pill.offsetHeight || 54 : 54;
        var rect = { left: 16, right: 16 + w, bottom: window.innerHeight - 16, top: window.innerHeight - 16 - h };
        var hit = false;
        document.querySelectorAll(".filters-sidebar, .pagination-bar, .load-more-bar").forEach(function (el) {
          if (hit || !el.offsetParent) return;
          var r = el.getBoundingClientRect();
          if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) hit = true;
        });
        wrap.classList.toggle("sw-collapsed", hit);
      }
      function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(check); } }
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      setTimeout(check, 400);
      setInterval(check, 2500); // catches layout changes (filters re-render etc.)
    })();

    var elTotal = wrap.querySelector("[data-k='total']");
    var elToday = wrap.querySelector("[data-k='today']");
    var elOnline = wrap.querySelector("[data-k='online']");
    var elTotalMin = wrap.querySelector("[data-k='total-min']");

    if (!SB_OK) { wrap.style.display = "none"; return; }

    function show(total, today) {
      countUp(elTotal, total);
      countUp(elToday, today);
      if (elTotalMin) elTotalMin.textContent = fmt(total);
    }

    // count one VISIT per browser session; cache so navigations don't re-bump.
    var cached = ss(true, "sw_visit");
    if (cached) {
      try { var c = JSON.parse(cached); show(c.total, c.today); } catch (e) {}
      // still reflect a possibly-grown total quietly via a fresh bump-less read? keep cached.
    } else {
      rpc("bump_visit").then(function (r) {
        if (r && r.total != null) { ss(false, "sw_visit", JSON.stringify(r)); show(r.total, r.today); }
        else wrap.style.display = "none";
      });
    }

    // ONLINE NOW — heartbeat every ~35s with a per-tab session id.
    var sid = ss(true, "sw_sid"); if (!sid) { sid = uid(); ss(false, "sw_sid", sid); }
    function beat() {
      rpc("heartbeat", { p_session: sid }).then(function (n) {
        if (n != null) elOnline.textContent = fmt(n);
      });
    }
    beat();
    var hb = setInterval(beat, 35000);
    window.addEventListener("pagehide", function () { clearInterval(hb); });
  }

  /* ===================== FEEDBACK ===================== */
  function buildFeedback() {
    var page = pageKey();        // originating page — used only for the feedback deep-link
    var FB_KEY = "site";         // sentiment is one site-wide tally ("liked the website")
    var votedKey = "sw_voted_site";
    var alreadyVoted = ls(true, votedKey);

    var wrap = document.createElement("div");
    wrap.className = "sw-fb";
    wrap.innerHTML =
      "<button class='like' title='Like the website' aria-label='Like the website'>" +
        SVG_HEART + "<span class='cnt'>—</span>" +
      "</button>" +
      "<button class='dislike' title='Disliked it — Help us improve' aria-label='Disliked it — Help us improve'>" +
        SVG_DOWN +
      "</button>";
    document.body.appendChild(wrap);

    var likeBtn = wrap.querySelector(".like");
    var dislikeBtn = wrap.querySelector(".dislike");
    var cntEl = wrap.querySelector(".cnt");

    // Pin to the very top-right corner. On desktop the nav links are centred, so
    // the right of the sticky navbar is empty — sit there (above the page's own
    // header buttons), z above the nav. On mobile the nav is full, so sit under it.
    (function () {
      var nav = document.querySelector(".top-nav, header.site, nav[class*='nav']");
      var r = nav ? nav.getBoundingClientRect() : null;
      if (window.innerWidth > 768 && r && r.height) {
        wrap.style.top = Math.max(6, Math.round(r.top + (r.height - 40) / 2)) + "px";
        wrap.style.zIndex = "90";
      } else {
        wrap.style.top = (r ? Math.round(r.bottom) + 8 : 64) + "px";
      }
    })();

    // The like count doubles as the heart's tooltip ("<N> liked the site").
    function setCount(ups) {
      cntEl.textContent = (ups == null) ? "—" : fmt(ups);
      likeBtn.title = (ups == null) ? "Like the website" : (fmt(ups) + " liked the site");
    }

    // load current like tally (site-wide)
    if (SB_OK) rpc("get_sentiment", { p_page: FB_KEY }).then(function (r) { setCount(r ? r.ups : null); });
    else setCount(null);

    // Once the page is LIKED, the dislike is no longer offered — just the heart +
    // count remains. (A dislike leaves both as-is, since it only routes to feedback.)
    if (alreadyVoted === "up") { likeBtn.classList.add("on"); wrap.classList.add("liked"); }

    // LIKE — records a site-wide thumbs-up, one per device; fills the heart.
    likeBtn.addEventListener("click", function () {
      likeBtn.classList.add("on");
      wrap.classList.add("liked");                     // hides the dislike button
      if (ls(true, votedKey)) return;                 // already voted — no double count
      ls(false, votedKey, "up");
      rpc("record_sentiment", { p_page: FB_KEY, p_vote: "up" }).then(function (r) { if (r) setCount(r.ups); });
      var cur = parseInt((cntEl.textContent || "0").replace(/[^0-9]/g, ""), 10) || 0; setCount(cur + 1);
    });

    // DISLIKE — never touches the count; routes straight to the feedback form,
    // deep-linked with the page the visitor came from.
    dislikeBtn.addEventListener("click", function () {
      location.href = rootPrefix() + "contact.html?ref=" + encodeURIComponent(page) + "#ctFormCard";
    });
  }

  /* ===================== INIT ===================== */
  /* ===================== DISCLAIMER (footer link + modal) ===================== */
  function buildDisclaimer() {
    var foot = document.createElement("div");
    foot.className = "sw-footer";
    foot.innerHTML =
      "<span>© alldeputations.com</span>" +
      "<span class='sep'>·</span>" +
      "<span class='src'>Source: Employment News &amp; official circulars</span>" +
      "<span class='sep'>·</span>" +
      "<span class='src'>Unofficial site — verify with the original notification</span>" +
      "<span class='sep'>·</span>" +
      "<button type='button' class='disc'>Disclaimer</button>" +
      "<span class='sep'>·</span>" +
      "<a class='flink' href='" + rootPrefix() + "contact.html'>Contact</a>";
    document.body.appendChild(foot);

    var paras = [
      "<strong>Deputations Portal</strong> is my independent initiative to assist Government officers and officials seeking Central Government deputation opportunities.",
      "The objective of this portal is to provide a <strong>holistic, organised, and user-focused</strong> platform for deputation-related vacancies, rules, references, guidance, and supporting tools, so that users can access relevant information with greater ease and clarity.",
      "<strong class='lead'>This is not an official website.</strong> Deputations is an independent, non-official information portal. It is not the website of the Government of India or of any Ministry, Department, Organisation, Cadre Controlling Authority or public authority, and it is not affiliated with, endorsed, sponsored or authorised by any of them. This website helps you locate and access official notification PDFs and source links; please refer to those original official documents for authoritative circulars, instructions, clarifications, approvals, and administrative directions.",
      "<strong class='lead'>What the portal aims to be.</strong> Every part of this portal — the searchable vacancy dashboard, the pay-level and eligibility filters, the “days-left” and source tags, the DeFeX index, the report and feedback tools, and the personal <em>My Deputation</em> tracker — has been planned and refined for one thing: clarity and practical usefulness for someone actually trying to go on deputation. It has gone through <strong>281+ revisions over about two months</strong>, and continues to be improved.",
      "<strong class='lead'>How information gets here — trust the process, but still verify.</strong> Vacancies are compiled from publicly available official sources: Employment News, official notifications and Office Memorandums, departmental websites, and user-reported official links. The portal leans heavily on modern AI-assisted tools and automation to read, structure and organise this material — but <strong>AI is only an assistant</strong>. Every vacancy, every correction, every user submission and every community input is <strong>reviewed and approved before it appears</strong>; nothing is published automatically. Even so, deadlines, eligibility, rules and policies change, expire or get superseded. So before acting on anything here — eligibility, pay level, tenure, application and forwarding procedure, vigilance/NOC requirements, last date, mode of application — <strong>please verify it against the original official circular, the concerned official website, or the competent authority.</strong>",
      "<strong class='lead'>About DeFeX (Deputation Friendliness Index).</strong> DeFeX is an original concept and naming developed for this portal — an attempt to indicate how convenient, supportive, rational and predictable it is to proceed on deputation from a given Ministry, Department, Organisation or Cadre Controlling Authority. It is currently in <strong>beta</strong>, built on a deputation survey conducted in <strong>October–December 2025</strong>, and it will keep evolving. It will be revised and refined as more feedback, documentary inputs, correction requests, official clarifications, and user experiences are received. The purpose of DeFeX is constructive. It is intended not only to help Government officials make more informed deputation-related decisions, but also to provide Ministries, Departments, Organisations, and Cadre Controlling Authorities with a feedback-oriented perspective that may assist in improving officer experience, procedural rationality, transparency, and uniformity across organisations. It is meant to be <strong>constructive</strong> — to help you choose better, and to give organisations a feedback-oriented view that may improve officer experience and procedural fairness. It makes <strong>no allegations</strong>, names no individual officers, and is <strong>not</strong> an official rating, audit, vigilance finding or legal determination. Where data is thin, an organisation is simply shown as unrated.",
      "<strong class='lead'>This works best as a community effort.</strong> Keeping deputation information accurate needs many eyes. If you spot a new vacancy, a broken or wrong link, an outdated circular, a missing detail, a factual correction or a rule update — please report it through the report and feedback tools. Such inputs genuinely make this better for the whole deputation community.",
      "<strong class='lead'>On names and references.</strong> Government, ministry, department, designation, vacancy, link and rule references are used only for identification, classification and public-interest information; their use implies no official association, approval or endorsement.",
      "By using this site you acknowledge that <strong>Deputations is an independent, AI-assisted, human-reviewed, community-supported information aid</strong>, and that final reliance must always rest on the original official sources and the competent authority."
    ];
    // Sign-off: headshot placeholder (swap the <svg> for an <img src='…'> when a
    // photo is available) + name & credentials.
    var signHtml =
      "<div class='sw-sign'>" +
        "<div class='sw-sign-pic' aria-hidden='true'>" +
          "<svg viewBox='0 0 24 24' fill='currentColor'><path d='M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z'/></svg>" +
        "</div>" +
        "<div class='sw-sign-info'>" +
          "<strong>Vivek Vishal</strong>" +
          "<span>Section Officer (DR 2012 Batch)</span>" +
          "<span>B. Tech Computer Science, NIT Durgapur</span>" +
          "<span>MBA (FM), AJNIFM</span>" +
        "</div>" +
      "</div>";
    var modal = document.createElement("div");
    modal.className = "sw-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Declaration and disclaimer");
    modal.innerHTML =
      "<div class='card'>" +
        "<button class='cls' aria-label='Close'>×</button>" +
        "<div class='hd'><span class='ic'>" + SVG_SHIELD + "</span>" +
          "<div><h3>Declaration &amp; Disclaimer</h3>" +
          "<p class='sub'>Deputations — an independent, non-official portal</p></div></div>" +
        "<div class='bd'>" + paras.map(function (p) { return "<p>" + p + "</p>"; }).join("") + signHtml + "</div>" +
      "</div>";
    document.body.appendChild(modal);

    function open() { modal.classList.add("open"); }
    function close() { modal.classList.remove("open"); }
    foot.querySelector(".disc").addEventListener("click", open);
    modal.querySelector(".cls").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ===================== ABOUT PROJECT (logo → popup) =====================
     The .nav-brand anchor in the top-nav now opens a styled "Behind All
     Deputations" modal instead of navigating home. The href is preserved so
     middle-click / cmd-click / right-click "Open in new tab" still work, but
     plain left-click is intercepted.

     Reuses the same sw-modal / sw-sign / sw-sign-pic / sw-sign-info classes
     the disclaimer uses, so the two modals look like siblings. Adds a few
     small extensions for the longer content: section headings (.sw-section)
     and inline links (.sw-link) styled in the primary accent. */
  function buildAboutProject() {
    if (document.querySelector(".sw-about")) return;       // only mount once
    var brand = document.querySelector(".nav-brand");
    if (!brand) return;

    // Personal-narrative paragraphs render in Lora italic — same stylish serif
    // the verification legend uses — so the popup reads as an editorial
    // "behind the project" essay rather than a generic feature card.
    var P = function (s) { return "<p class='sw-about-prose'>" + s + "</p>"; };
    var H = function (s) { return "<h4 class='sw-section'>" + s + "</h4>"; };
    var SITE = "<a class='sw-link' href='" + rootPrefix() + "index.html' target='_blank' rel='noopener'>www.alldeputations.com</a>";

    var intro = [
      "I have always been fascinated by technology — the ability to take a problem, understand it deeply and build something that makes the experience better. Artificial intelligence has only strengthened that fascination by dramatically expanding what an individual builder can explore and create.",
      "My journey began with Computer Science Engineering at <strong>NIT Durgapur</strong>, followed by a stint as a Software Engineer with an IT multinational in Bengaluru, where I developed web- and Windows-based applications.",
      "I later left the well settled corporate job to work for the nation and become an IAS officer, appearing in the <strong>UPSC Civil Services Mains</strong> on multiple occasions. A Government position that I had initially taken alongside those preparations eventually opened another world to me: the scale, complexity and impact of public administration.",
      "Today, I am proud to be a member of the <strong>Central Secretariat Service (CSS)</strong>, a service that works at the core of policy formulation and administration across the Central Government.",
      "More recently, I completed my <strong>MBA in Financial Management (2024–26)</strong> from AJNIFM. My final-term dissertation explored a subject particularly close to my interests: a proposal for an AI-Augmented Decision Support System for Public Governance in Indian Central Ministries.",
      "I have recently joined the <strong>Ministry of Road Transport &amp; Highways</strong> as <strong>Section Officer (Toll)</strong>."
    ].map(P).join("");

    var whyBlock = [
      "A deputation opportunity should not be discovered by chance.",
      "Yet, as a Government employee, I repeatedly encountered exactly that problem.",
      "Deputation vacancies were scattered across many different sources. eHRMS provided an interface, but it did not capture everything I was looking for. Employment News still had to be scanned. Some notifications appeared on individual Government websites. Some reached us through colleagues or WhatsApp groups. And occasionally, a useful opportunity was noticed only after someone happened to come across it.",
      "It was remarkably easy to miss a vacancy simply because you had not looked at the right place at the right time.",
      "The project therefore began very modestly: a personal attempt to collect deputation information in an Excel sheet and present it to my friends more usefully.",
      "Then I started improving it.",
      "One problem revealed another. Search needed to be better. Eligibility needed to be easier to understand. Deadlines needed attention. Locations, organisations, pay levels and experience requirements needed structure. The interface needed to work from the perspective of an officer actually searching for an opportunity — not merely as another repository of notifications.",
      "That small hobby project gradually evolved through more than <strong>600 development iterations and rebuilds</strong> into what you see today.",
      "Throughout its development, I have tried to approach " + SITE + " as both its builder and its end user — examining even small friction points and repeatedly asking a simple question:",
      "<em class='sw-quote'>\"If I were searching for the right deputation today, what would I expect this service to do for me?\"</em>",
      "That question continues to shape the platform."
    ].map(P).join("");

    var builtBlock = [
      SITE + " is a personal, independently developed project.",
      "There is no large product team behind it. It is an ongoing experiment in using modern software engineering, automation and AI to solve a very specific real-world information problem experienced by Government officers.",
      "And it is still evolving.",
      "I am also exploring a few other technology and AI projects, particularly around improving information discovery, decision support and digital experiences in public-sector contexts.",
      "For me, the most exciting aspect of today's technology is not technology itself.",
      "It is what a sufficiently curious individual can now build with it."
    ].map(P).join("");

    var disclaimerBlock =
      "<div class='sw-about-disclaimer'>" +
        "<p><strong>All Deputations is an independent personal initiative</strong> and is not an official website of the Government of India. The views, design and functionality of this project are personal and do not represent the Government of India or Ministry of Road Transport &amp; Highways or any other Government organisation or institution mentioned above.</p>" +
      "</div>";

    var signHtml =
      "<div class='sw-sign'>" +
        "<div class='sw-sign-pic' aria-hidden='true'>" +
          "<svg viewBox='0 0 24 24' fill='currentColor'><path d='M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z'/></svg>" +
        "</div>" +
        "<div class='sw-sign-info'>" +
          "<strong>Vivek Vishal</strong>" +
          "<span>Section Officer (Toll) — Ministry of Road Transport &amp; Highways</span>" +
          "<span>B. Tech CSE, NIT Durgapur · MBA (FM), AJNIFM</span>" +
          "<span>Central Secretariat Service</span>" +
        "</div>" +
      "</div>";

    var SVG_USER = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4 21c0-4 4-6 8-6s8 2 8 6'/></svg>";

    var modal = document.createElement("div");
    modal.className = "sw-modal sw-about";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Behind All Deputations");
    modal.innerHTML =
      "<div class='card'>" +
        "<button class='cls' aria-label='Close'>×</button>" +
        "<div class='hd'><span class='ic'>" + SVG_USER + "</span>" +
          "<div><h3>Behind All Deputations</h3>" +
          "<p class='sub'>An independent project at the intersection of technology, AI and public service.</p></div></div>" +
        "<div class='bd'>" +
          intro +
          H("Why " + SITE + "?") + whyBlock +
          H("Built independently") + builtBlock +
          signHtml +
          disclaimerBlock +
        "</div>" +
      "</div>";
    document.body.appendChild(modal);

    /* ---------- word-by-word reader-speed reveal --------------------------
       The owner asked for the prose to type in at reading pace instead of
       appearing all at once. We mirror the #manpower typewriter on defex:
       at init, every word inside .sw-about-prose and the pull-quote is
       wrapped in <span class="sw-type-w" style="--w:N"> carrying its
       global ordinal. The bd starts with data-typing="pending" so the
       spans begin at opacity 0; each open() flips data-typing to "run"
       after a double-rAF flush (so pending styles resolve before the
       transition rule engages), and a single CSS transition with
       per-word delay staggers the fade-in across the whole essay.

       Excluded from wrapping (instant):
         .sw-link anchors — styled in primary colour, must stay whole.
         .sw-sign / .sw-about-disclaimer — signature + notice, not body.
         The .hd heading block + .sw-section headings — outside the targets.
       prefers-reduced-motion: skip wrapping; text reads as plain paragraphs. */
    var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var bd = modal.querySelector(".bd");
    bd.setAttribute("data-typing", "pending");
    if (!REDUCED_MOTION) wrapWordsForTypewriter(modal);

    function wrapWordsForTypewriter(root) {
      // Collect text nodes inside prose paragraphs. The .sw-quote <em> is a
      // descendant of a .sw-about-prose <p> on the page, so listing both as
      // targets would visit it twice and try to replaceChild on the same
      // text node twice — second call finds parentNode === null and throws.
      var targets = root.querySelectorAll(".sw-about-prose");
      var collected = [];
      function visit(node) {
        if (node.nodeType === 3) { collected.push(node); return; }
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(".sw-link, .sw-sign")) return;
        var kids = node.childNodes;
        for (var i = 0; i < kids.length; i++) visit(kids[i]);
      }
      for (var i = 0; i < targets.length; i++) visit(targets[i]);

      var idx = 0;
      for (var j = 0; j < collected.length; j++) {
        var tn = collected[j];
        var text = tn.nodeValue;
        if (!text || !text.trim()) continue;        // whitespace-only nodes stay as-is
        var tokens = text.split(/(\s+)/);            // keep separators in the split
        var frag = document.createDocumentFragment();
        for (var k = 0; k < tokens.length; k++) {
          var t = tokens[k];
          if (!t) continue;
          if (/^\s+$/.test(t)) {
            frag.appendChild(document.createTextNode(t));
          } else {
            var s = document.createElement("span");
            s.className = "sw-type-w";
            s.style.setProperty("--w", String(idx));
            s.textContent = t;
            frag.appendChild(s);
            idx++;
          }
        }
        if (frag.childNodes.length) tn.parentNode.replaceChild(frag, tn);
      }
    }

    function open() {
      modal.classList.add("open");
      // Move focus into the dialog so Esc + Tab start somewhere sensible.
      var btn = modal.querySelector(".cls");
      if (btn) btn.focus();
      if (REDUCED_MOTION) return;
      // Double-rAF flushes the pending→run style change past the layout step
      // before the transition rule engages, so the staggered fade actually
      // plays (a single rAF in a backgrounded tab parks the rule indefinitely
      // and the essay would sit at opacity 0).
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          bd.setAttribute("data-typing", "run");
        });
      });
    }
    function close() {
      modal.classList.remove("open");
      // Reset to pending so the next open() re-runs the reveal from word 0
      // (the display:none from removing .open hides the modal instantly, so
      // setting pending here is about state hygiene, not visible fade-out).
      if (!REDUCED_MOTION) bd.setAttribute("data-typing", "pending");
    }

    // Intercept the plain left-click. Right-click, middle-click, ctrl/cmd-click
    // still hit the href so users can open About in a new tab if they want.
    brand.addEventListener("click", function (e) {
      // Allow modifiers (open-in-new-tab gestures) and non-left buttons through.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open();
    });
    modal.querySelector(".cls").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ===================== MOBILE NAV (hamburger + bottom sheet) ============ */
  /* The nav row silently cuts off on small screens (review M2): several links
     were undiscoverable. A hamburger (<=768px via CSS) opens a bottom sheet
     cloned from .nav-links, so all pages get it from this one injection point. */
  function buildMobileNav() {
    var topNav = document.querySelector(".top-nav");
    var links = topNav && topNav.querySelector(".nav-links");
    if (!topNav || !links || document.querySelector(".sw-menu-btn")) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sw-menu-btn";
    btn.setAttribute("aria-label", "Open menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "swNavSheet");
    btn.innerHTML = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' aria-hidden='true'><path d='M4 7h16M4 12h16M4 17h16'/></svg>";
    topNav.appendChild(btn);

    var sheet = document.createElement("div");
    sheet.className = "sw-sheet";
    sheet.id = "swNavSheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Site menu");
    sheet.innerHTML =
      "<div class='panel'>" +
        "<div class='hdr'><span class='ttl'>Menu</span>" +
        "<button type='button' class='x' aria-label='Close menu'>×</button></div>" +
        "<nav>" + links.innerHTML + "</nav>" +
      "</div>";
    document.body.appendChild(sheet);

    function open() {
      sheet.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      var first = sheet.querySelector("nav a.active") || sheet.querySelector("nav a");
      if (first) first.focus();
    }
    function close() {
      if (!sheet.classList.contains("open")) return;
      sheet.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    }
    btn.addEventListener("click", function () {
      if (sheet.classList.contains("open")) close(); else open();
    });
    sheet.querySelector(".x").addEventListener("click", close);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---- header title animation: type it out, then flow the gradient ------- */
  function buildTypewriter() {
    var els = document.querySelectorAll("[data-tw]");
    if (!els.length) return;
    els.forEach(function (el) {
      var full = (el.textContent || "").trim();
      if (!full) return;
      if (REDUCED) { el.classList.add("tw-flow"); return; } // static (animation disabled by media query)
      el.textContent = "";
      var txt = document.createElement("span");
      var caret = document.createElement("span");
      caret.className = "tw-caret on";
      caret.textContent = "▏"; // ▏
      el.appendChild(txt);
      el.appendChild(caret);
      var i = 0;
      (function tick() {
        if (i <= full.length) {
          txt.textContent = full.slice(0, i);
          i++;
          setTimeout(tick, 150);
        } else {
          // finished: drop the caret and let the gradient flow
          el.textContent = full;
          el.classList.add("tw-flow");
        }
      })();
    });
  }

  /* ---- navbar: keep the active pill visible inside the mobile scroller ---- */
  function enhanceNav() {
    var links = document.querySelector(".top-nav .nav-links");
    if (!links) return;
    var active = links.querySelector("a.active");
    if (!active) return;
    // centre via scrollLeft (scrollIntoView would also scroll the page vertically)
    var target = active.offsetLeft - (links.clientWidth - active.offsetWidth) / 2;
    if (links.scrollWidth > links.clientWidth + 4) {
      links.scrollLeft = Math.max(0, target);
    }
  }

  // Feedback widget: site-wide "Liked the website?" — like records sentiment,
  // dislike routes straight to the feedback form.
  var ENABLE_FEEDBACK = true;
  function init() {
    injectCSS();
    try { enhanceNav(); } catch (e) {}
    try { buildTypewriter(); } catch (e) {}
    try { buildMobileNav(); } catch (e) {}
    try { buildDisclaimer(); } catch (e) {}
    try { buildAboutProject(); } catch (e) {}

    // P3-7 PR 1 (fix): render the visitor counter and feedback widget
    // UNCONDITIONALLY. The previous shape gated both on an eager
    // `ensureSupabaseAvailable()` HEAD probe, which surfaced
    // ERR_SSL_PROTOCOL_ERROR on NIC users and hid the heart entirely.
    //
    // New shape: widgets render on load. The first RPC that fails trips
    // `onRpcFail()` which sets `is-supabase-down` on <body> and unhides the
    // offline banner — the user-visible signal. After 3 consecutive failures
    // the 3-strike breaker flips SB_OK=false and the counter is hidden; the
    // feedback widget stays visible (heart + count shows "—") so the
    // interaction is still discoverable, even if clicks fail silently.
    //
    // No eager probe → no ERR_SSL_PROTOCOL_ERROR noise on NIC.
    try { buildCounter(); } catch (e) {}
    if (ENABLE_FEEDBACK) { try { buildFeedback(); } catch (e) {} }

    // PWA offline shell (review P1-2). Production origin only, so local dev
    // servers never serve stale cached assets while iterating.
    //
    // Register on EITHER live hostname (deputations.github.io OR
    // alldeputations.com). Reject only local development hosts.
    try {
      var host = location.hostname;
      var isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "" || /^192\.168\./.test(host) || /^10\./.test(host);
      if ("serviceWorker" in navigator && !isLocal) {
        navigator.serviceWorker.register("/sw.js");
      }
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
