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

  /* ---- Supabase RPC helper (graceful no-op when unavailable) ------------- */
  var SB_URL = (window.SUPABASE_URL || "").replace(/\/+$/, "");
  var SB_KEY = window.SUPABASE_ANON_KEY || "";
  var SB_OK  = /^https:\/\/[a-z0-9]+\.supabase\.co/.test(SB_URL) && SB_KEY.length > 20;

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
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
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
  var CSS = "" +
  ":root{--sw-z:70}" +
  ".sw-counter,.sw-fb{position:fixed;z-index:var(--sw-z);" +
    "font-family:'Plus Jakarta Sans','Inter',system-ui,-apple-system,sans-serif;" +
    "-webkit-font-smoothing:antialiased;box-sizing:border-box}" +
  ".sw-counter *,.sw-fb *{box-sizing:border-box}" +

  /* palette (dark default) */
  ".sw-counter,.sw-fb,.sw-footer,.sw-modal{--sw-surface:rgba(15,23,42,.82);--sw-surface2:rgba(30,41,59,.9);" +
    "--sw-border:rgba(148,163,184,.18);--sw-text:#f8fafc;--sw-muted:#94a3b8;" +
    "--sw-primary:#22d3ee;--sw-accent:#a78bfa;--sw-good:#34d399;--sw-bad:#f87171;" +
    "--sw-gold:#fbbf24;--sw-shadow:0 14px 40px -12px rgba(0,0,0,.6)}" +
  "html[data-theme='light'] .sw-counter,html[data-theme='light'] .sw-fb,html[data-theme='light'] .sw-footer,html[data-theme='light'] .sw-modal{" +
    "--sw-surface:rgba(255,255,255,.92);--sw-surface2:rgba(248,250,252,.96);" +
    "--sw-border:rgba(15,23,42,.10);--sw-text:#0f172a;--sw-muted:#64748b;" +
    "--sw-primary:#0284c7;--sw-accent:#7c3aed;--sw-good:#16a34a;--sw-bad:#e11d48;" +
    "--sw-gold:#b8860b;--sw-shadow:0 16px 40px -14px rgba(15,23,42,.22)}" +

  /* ===== VISITOR COUNTER (bottom-left) — display only, never blocks clicks ===== */
  ".sw-counter{left:16px;bottom:16px;pointer-events:none}" +
  ".sw-counter .sw-c{display:inline-flex;align-items:stretch;gap:0;" +
    "background:var(--sw-surface);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);" +
    "border:1px solid var(--sw-border);border-radius:16px;padding:6px;box-shadow:var(--sw-shadow);color:var(--sw-text);" +
    "transform:translateY(8px);opacity:0;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .5s ease}" +
  ".sw-counter.sw-in .sw-c{transform:none;opacity:1}" +
  ".sw-c .cell{padding:7px 16px;text-align:center;position:relative}" +
  ".sw-c .cell+.cell::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:1px;background:var(--sw-border)}" +
  ".sw-c .num{font-family:'Sora','Plus Jakarta Sans',sans-serif;font-weight:700;font-size:1.18rem;line-height:1;" +
    "font-variant-numeric:tabular-nums;letter-spacing:.3px;display:inline-flex;align-items:center}" +
  ".sw-c .cell.total .num{color:var(--sw-primary)}" +
  ".sw-c .cell.today .num{color:var(--sw-accent)}" +
  ".sw-c .cell.online .num{color:var(--sw-gold)}" +
  ".sw-c .lbl{display:block;margin-top:5px;font-size:.6rem;text-transform:uppercase;letter-spacing:.12em;color:var(--sw-muted);font-weight:600;white-space:nowrap}" +
  ".sw-c .dot{width:7px;height:7px;border-radius:50%;background:var(--sw-gold);margin-right:6px;box-shadow:0 0 0 0 var(--sw-gold);animation:swPulse 1.8s ease-in-out infinite}" +
  "@keyframes swPulse{0%,100%{opacity:1}50%{opacity:.3}}" +
  ".sw-counter .sw-min{display:none}" +

  /* ===== FEEDBACK (top-right) ===== */
  ".sw-fb{top:76px;right:16px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}" +
  ".sw-fb .launch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:1px solid var(--sw-border);" +
    "background:var(--sw-surface);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);" +
    "color:var(--sw-text);border-radius:999px;padding:8px 14px;box-shadow:var(--sw-shadow);font:inherit;font-weight:700;font-size:.86rem;" +
    "transition:transform .18s ease,border-color .18s ease}" +
  ".sw-fb .launch:hover{transform:translateY(-1px);border-color:var(--sw-primary)}" +
  ".sw-fb .launch svg{width:18px;height:18px;color:var(--sw-bad)}" +
  ".sw-fb .launch .cnt{font-variant-numeric:tabular-nums;color:var(--sw-text)}" +
  ".sw-fb .launch .cap{color:var(--sw-muted);font-weight:600;font-size:.8rem}" +

  ".sw-fb .panel{width:min(300px,86vw);background:var(--sw-surface);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);" +
    "border:1px solid var(--sw-border);border-radius:16px;box-shadow:var(--sw-shadow);color:var(--sw-text);padding:16px;" +
    "transform-origin:top right;transform:scale(.92);opacity:0;pointer-events:none;transition:transform .22s cubic-bezier(.16,1,.3,1),opacity .2s ease}" +
  ".sw-fb.open .panel{transform:none;opacity:1;pointer-events:auto}" +
  ".sw-fb .panel h4{font-family:'Sora','Plus Jakarta Sans',sans-serif;margin:0 0 12px;font-size:1.02rem;font-weight:700}" +
  ".sw-fb .row{display:flex;gap:8px}" +
  ".sw-fb .vote{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;font:inherit;font-weight:700;" +
    "padding:9px 10px;border-radius:11px;border:1px solid var(--sw-border);background:var(--sw-surface2);color:var(--sw-text);transition:all .16s ease}" +
  ".sw-fb .vote svg{width:17px;height:17px}" +
  ".sw-fb .vote.up:hover{border-color:var(--sw-good);color:var(--sw-good);transform:translateY(-1px)}" +
  ".sw-fb .vote.down:hover{border-color:var(--sw-bad);color:var(--sw-bad);transform:translateY(-1px)}" +
  ".sw-fb .vote.up.on{background:var(--sw-good);border-color:var(--sw-good);color:#04210f}" +
  ".sw-fb .vote.up.on svg{animation:swPop .4s cubic-bezier(.34,1.56,.64,1)}" +
  "@keyframes swPop{0%{transform:scale(.6)}60%{transform:scale(1.3)}100%{transform:scale(1)}}" +
  ".sw-fb .thanks{display:none;align-items:center;gap:8px;margin-top:10px;color:var(--sw-good);font-weight:600;font-size:.9rem}" +
  ".sw-fb.thanked .thanks{display:flex}" +
  ".sw-fb .improve{display:none;margin-top:12px}" +
  ".sw-fb.improving .improve{display:block}" +
  ".sw-fb.improving .row,.sw-fb.improving h4{display:none}" +
  ".sw-fb .improve p{margin:0 0 9px;font-weight:700;font-size:.92rem}" +
  ".sw-fb .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}" +
  ".sw-fb .chip{cursor:pointer;font:inherit;font-size:.76rem;font-weight:600;padding:6px 11px;border-radius:999px;" +
    "border:1px solid var(--sw-border);background:transparent;color:var(--sw-muted);transition:all .15s ease}" +
  ".sw-fb .chip:hover{border-color:var(--sw-bad);color:var(--sw-bad)}" +
  ".sw-fb .chip.on{background:var(--sw-bad);border-color:var(--sw-bad);color:#fff}" +
  ".sw-fb .cta{display:inline-flex;align-items:center;gap:7px;width:100%;justify-content:center;cursor:pointer;font:inherit;font-weight:700;" +
    "padding:10px;border-radius:11px;border:none;background:linear-gradient(135deg,var(--sw-primary),var(--sw-accent));color:#fff;text-decoration:none}" +
  ".sw-fb .cta:hover{filter:brightness(1.06)}" +
  ".sw-fb .x{position:absolute;top:9px;right:11px;cursor:pointer;border:none;background:none;color:var(--sw-muted);font-size:1.1rem;line-height:1;padding:2px 6px;border-radius:8px}" +
  ".sw-fb .x:hover{color:var(--sw-text)}" +
  ".sw-fb .panel{position:relative}" +

  /* ===== DISCLAIMER — footer link + modal ===== */
  ".sw-footer{display:flex;justify-content:center;align-items:center;gap:9px;flex-wrap:wrap;text-align:center;" +
    "margin:34px auto 22px;padding:0 16px;font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;font-size:.8rem;color:var(--sw-muted)}" +
  ".sw-footer .sep{opacity:.45}" +
  ".sw-footer .disc{cursor:pointer;font:inherit;font-weight:700;color:var(--sw-primary);background:none;border:none;" +
    "padding:4px 4px;border-radius:8px;text-decoration:underline;text-underline-offset:3px}" +
  ".sw-footer .disc:hover{color:var(--sw-accent)}" +
  ".sw-modal{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;padding:20px;" +
    "background:radial-gradient(circle at 20% 18%,rgba(34,211,238,.10),transparent 30%),radial-gradient(circle at 82% 82%,rgba(167,139,250,.12),transparent 28%),rgba(2,4,11,.82);" +
    "-webkit-backdrop-filter:blur(16px) saturate(120%);backdrop-filter:blur(16px) saturate(120%)}" +
  ".sw-modal.open{display:flex}" +
  "html[data-theme='light'] .sw-modal{background:radial-gradient(circle at 20% 18%,rgba(2,132,199,.10),transparent 30%),radial-gradient(circle at 82% 82%,rgba(124,58,237,.10),transparent 28%),rgba(226,232,240,.72)}" +
  ".sw-modal .card{position:relative;width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;" +
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
  "}";

  function injectCSS() {
    var s = document.createElement("style");
    s.id = "sw-styles"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* SVG icons */
  var SVG_HEART = "<svg viewBox='0 0 24 24' fill='currentColor'><path d='M12 21s-7.4-4.6-10-9.2C.7 9 1.6 5.3 4.7 4.2 6.8 3.5 9 4.3 10.2 6c.4.5.6.8.8 1.1.2-.3.4-.6.8-1.1C13.8 4.3 16 3.5 18.1 4.2c3.1 1.1 4 4.8 2.7 7.6C20.4 16.4 12 21 12 21z'/></svg>";
  var SVG_UP   = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 10v11'/><path d='M15 5.9 14 10h5.6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.2 22H7V10l4-9a2.5 2.5 0 0 1 4 1.9z'/></svg>";
  var SVG_DOWN = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 14V3'/><path d='M9 18.1 10 14H4.4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.8 2H17v12l-4 9a2.5 2.5 0 0 1-4-1.9z'/></svg>";
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
      "</div>";
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add("sw-in"); });

    var elTotal = wrap.querySelector("[data-k='total']");
    var elToday = wrap.querySelector("[data-k='today']");
    var elOnline = wrap.querySelector("[data-k='online']");

    if (!SB_OK) { wrap.style.display = "none"; return; }

    function show(total, today) { countUp(elTotal, total); countUp(elToday, today); }

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
    var page = pageKey();
    var votedKey = "sw_voted_" + page;
    var alreadyVoted = ls(true, votedKey);

    var wrap = document.createElement("div");
    wrap.className = "sw-fb";
    wrap.innerHTML =
      "<button class='launch' aria-haspopup='dialog' aria-expanded='false' title='Rate this page'>" +
        SVG_HEART + "<span class='cnt'>—</span><span class='cap'>found this helpful</span>" +
      "</button>" +
      "<div class='panel' role='dialog' aria-label='Was this page helpful?'>" +
        "<button class='x' aria-label='Close'>×</button>" +
        "<h4>Was this page helpful?</h4>" +
        "<div class='row'>" +
          "<button class='vote up'>" + SVG_UP + "Yes</button>" +
          "<button class='vote down'>" + SVG_DOWN + "Could be better</button>" +
        "</div>" +
        "<div class='thanks'>" + SVG_CHECK + "<span>Thank you — glad it helped!</span></div>" +
        "<div class='improve'>" +
          "<p>Let us know how we can improve</p>" +
          "<div class='chips'>" +
            "<button class='chip' data-tag='Hard to find info'>Hard to find info</button>" +
            "<button class='chip' data-tag='Out of date'>Out of date</button>" +
            "<button class='chip' data-tag='Confusing'>Confusing</button>" +
            "<button class='chip' data-tag='Missing detail'>Missing detail</button>" +
          "</div>" +
          "<a class='cta' href='#'>Tell us more " + SVG_ARROW + "</a>" +
        "</div>" +
      "</div>";
    document.body.appendChild(wrap);

    var launch = wrap.querySelector(".launch");
    var panel  = wrap.querySelector(".panel");
    var cntEl  = wrap.querySelector(".cnt");
    var upBtn  = wrap.querySelector(".vote.up");
    var dnBtn  = wrap.querySelector(".vote.down");
    var chips  = wrap.querySelector(".chips");
    var cta    = wrap.querySelector(".cta");

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

    function setCount(ups) { cntEl.textContent = (ups == null) ? "—" : fmt(ups); }

    // load current likes
    if (SB_OK) rpc("get_sentiment", { p_page: page }).then(function (r) { setCount(r ? r.ups : null); });
    else setCount(null);

    function openPanel() { wrap.classList.add("open"); launch.setAttribute("aria-expanded", "true"); }
    function closePanel() { wrap.classList.remove("open"); launch.setAttribute("aria-expanded", "false"); }
    launch.addEventListener("click", function () { wrap.classList.contains("open") ? closePanel() : openPanel(); });
    wrap.querySelector(".x").addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) closePanel(); });

    if (alreadyVoted) { upBtn.disabled = dnBtn.disabled = (alreadyVoted === "up"); }

    upBtn.addEventListener("click", function () {
      upBtn.classList.add("on"); wrap.classList.add("thanked");
      if (!ls(true, votedKey)) {
        ls(false, votedKey, "up");
        rpc("record_sentiment", { p_page: page, p_vote: "up" }).then(function (r) { if (r) setCount(r.ups); });
        // optimistic bump
        var cur = parseInt((cntEl.textContent || "0").replace(/[^0-9]/g, ""), 10) || 0; setCount(cur + 1);
      }
      setTimeout(closePanel, 1400);
    });

    dnBtn.addEventListener("click", function () { wrap.classList.add("improving"); });
    chips.addEventListener("click", function (e) {
      var c = e.target.closest(".chip"); if (c) c.classList.toggle("on");
    });
    cta.addEventListener("click", function (e) {
      e.preventDefault();
      if (!ls(true, votedKey)) {
        ls(false, votedKey, "down");
        rpc("record_sentiment", { p_page: page, p_vote: "down" });
      }
      var tags = [].slice.call(chips.querySelectorAll(".chip.on")).map(function (c) { return c.dataset.tag; });
      var url = rootPrefix() + "contact.html?ref=" + encodeURIComponent(page) +
                (tags.length ? "&tags=" + encodeURIComponent(tags.join(", ")) : "") + "#ctFormCard";
      location.href = url;
    });
  }

  /* ===================== INIT ===================== */
  /* ===================== DISCLAIMER (footer link + modal) ===================== */
  function buildDisclaimer() {
    var foot = document.createElement("div");
    foot.className = "sw-footer";
    foot.innerHTML =
      "<span>© Deputations — independent, AI-assisted, human-reviewed</span>" +
      "<span class='sep'>·</span>" +
      "<button type='button' class='disc'>Disclaimer</button>";
    document.body.appendChild(foot);

    var paras = [
      "<strong>Deputations</strong> has been conceptualised and developed by <strong>Vivek Vishal, Section Officer</strong>, in his personal capacity, as an independent initiative to assist Government officers and officials seeking Central Government deputation opportunities.",
      "The objective of this portal is to provide a <strong>holistic, organised, and user-focused</strong> platform for deputation-related vacancies, rules, references, guidance, and supporting tools, so that users can access relevant information with greater ease and clarity.",
      "<strong class='lead'>This is not an official website.</strong> Deputations is an independent, non-official information portal. It is not the website of the Government of India or of any Ministry, Department, Organisation, Cadre Controlling Authority or public authority, and it is not affiliated with, endorsed, sponsored or authorised by any of them. Nothing here is an official circular, instruction, clarification, recommendation, approval, legal opinion or administrative direction — please don't treat it as one.",
      "<strong class='lead'>What I've tried to build.</strong> Every part of this portal — the searchable vacancy dashboard, the pay-level and eligibility filters, the “days-left” and source tags, the DeFeX index, the report and feedback tools, and the personal <em>My Deputation</em> tracker — has been planned and refined for one thing: clarity and practical usefulness for someone actually trying to go on deputation. It has gone through <strong>281+ revisions over about two months</strong>, and I keep improving it.",
      "<strong class='lead'>How information gets here — trust the process, but still verify.</strong> I compile vacancies from publicly available official sources: Employment News, official notifications and Office Memorandums, departmental websites, and user-reported official links. I lean heavily on modern AI-assisted tools and automation to read, structure and organise this material — but <strong>AI is only an assistant</strong>. Every vacancy, every correction, every user submission and every community input is <strong>reviewed and approved by me before it appears</strong>; nothing is published automatically. Even so, deadlines, eligibility, rules and policies change, expire or get superseded. So before acting on anything here — eligibility, pay level, tenure, application and forwarding procedure, vigilance/NOC requirements, last date, mode of application — <strong>please verify it against the original official circular, the concerned official website, or the competent authority.</strong>",
      "<strong class='lead'>About DeFeX (Deputation Friendliness Index).</strong> DeFeX is my own original concept and naming — an attempt to indicate how convenient, supportive, rational and predictable it is to proceed on deputation from a given Ministry, Department, Organisation or Cadre Controlling Authority. It is currently in <strong>beta</strong>, built on a deputation survey I ran in <strong>October–December 2025</strong>, available official documents and moderated feedback, and it will keep evolving. It is meant to be <strong>constructive</strong> — to help you choose better, and to give organisations a feedback-oriented view that may improve officer experience and procedural fairness. It makes <strong>no allegations</strong>, names no individual officers, and is <strong>not</strong> an official rating, audit, vigilance finding or legal determination. Where data is thin, an organisation is simply shown as unrated.",
      "<strong class='lead'>This works best as a community effort.</strong> Keeping deputation information accurate needs many eyes. If you spot a new vacancy, a broken or wrong link, an outdated circular, a missing detail, a factual correction or a rule update — please tell me through the report and feedback tools. Your inputs genuinely make this better for the whole deputation community.",
      "<strong class='lead'>On names and references.</strong> Government, ministry, department, designation, vacancy, link and rule references are used only for identification, classification and public-interest information; their use implies no official association, approval or endorsement.",
      "By using this site you acknowledge that <strong>Deputations is an independent, AI-assisted, human-reviewed, community-supported information aid</strong>, and that final reliance must always rest on the original official sources and the competent authority.",
      "<span class='sign'>— Vivek Vishal, Section Officer</span>"
    ];
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
        "<div class='bd'>" + paras.map(function (p) { return "<p>" + p + "</p>"; }).join("") + "</div>" +
      "</div>";
    document.body.appendChild(modal);

    function open() { modal.classList.add("open"); }
    function close() { modal.classList.remove("open"); }
    foot.querySelector(".disc").addEventListener("click", open);
    modal.querySelector(".cls").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  // Feedback widget kept in abeyance for a later upgrade — counter only for now.
  var ENABLE_FEEDBACK = false;
  function init() {
    injectCSS();
    try { buildCounter(); } catch (e) {}
    try { buildDisclaimer(); } catch (e) {}
    if (ENABLE_FEEDBACK) { try { buildFeedback(); } catch (e) {} }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
