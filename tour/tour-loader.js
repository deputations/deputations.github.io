/* ============================================================
   tour/tour-loader.js — site tour loader (always loaded, ~2 KB).

   Decides whether this page's "how to use" demo auto-plays, injects
   the floating "How this works" replay button, and lazy-loads GSAP,
   the engine, the kit and the page's scenes only when a demo plays.

   Wire on a page with:
     <script defer src="/tour/tour-loader.js?v=7" data-tour="home"></script>
   A page with its own async start-up (data fetch, intro animation) adds
   data-tour-ready="<document event>": auto-play then waits for that event
   (at most READY_WAIT ms after load) so the tour never covers the page's
   intro or races its history.replaceState.

   Bump ?v= here (VERSION) and in every page's tag whenever any tour asset
   changes: sw.js serves same-origin JS/CSS cache-first, keyed by URL.

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §4.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourLoader) return;

  var script = document.currentScript;
  var KEY = (script && script.dataset && script.dataset.tour) || '';
  var READY_EVENT = (script && script.dataset && script.dataset.tourReady) || '';
  var READY_WAIT = 12000;
  // data-tour-hold: on a first visit the page holds its own start-up animation
  // (elements marked data-tour-hidden stay hidden) until the tour is over.
  var HOLD = !!(script && script.dataset && script.dataset.tourHold != null);
  var held = false;
  function hold() {
    if (!HOLD || held) return;
    held = true;
    document.documentElement.setAttribute('data-tour-pending', '');
    // once the tour has closed and its Back step is done, let the page start
    document.addEventListener('deptour:close', function () {
      var until = Date.now() + 1500;
      (function wait() {
        if (history.state && history.state.dtTour && Date.now() < until) return setTimeout(wait, 50);
        release();
      })();
    }, { once: true });
    setTimeout(release, 180000);                      // never hold the page forever
  }
  function release() {
    if (!held) return;
    held = false;
    document.documentElement.removeAttribute('data-tour-pending');
    try { document.dispatchEvent(new CustomEvent('deptour:release')); } catch (e) {}
  }
  var BUTTON_LIFE = 10000;      // "How this works" shows for 10 s per page load
  var IDLE_MS = 2500;           // busy = touched the page in the last 2.5 s
  var BUSY_GIVE_UP = 20000;     // still busy this long after the page settled: try a later visit   // the map page's own intro takes ~5-10 s after load
  var pageReady = !READY_EVENT;
  if (READY_EVENT) document.addEventListener(READY_EVENT, function () { pageReady = true; }, { once: true });
  var SEEN_KEY = 'dep_tour_seen_v1';
  var OFF_KEY = 'dep_tour_off_v1';
  var VERSION = '?v=7';
  var CORE = ['/vendor/gsap.min.js', '/tour/tour.css', '/tour/tour-engine.js', '/tour/tour-kit.js'];
  var SCENES = {
    home: ['/tour/scenes/map.js', '/tour/scenes/pages.js', '/tour/scenes/home-more.js', '/tour/scenes/home.js'],
    map: ['/tour/scenes/map.js', '/tour/scenes/map-page.js']
  };

  /* ---------- storage (every access guarded) ---------- */
  function readSeen() {
    try {
      var raw = localStorage.getItem(SEEN_KEY);
      var val = raw ? JSON.parse(raw) : {};
      return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
    } catch (e) { return {}; }
  }
  function markSeen(key) {
    try {
      var seen = readSeen();
      seen[key] = 1;
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch (e) { /* storage blocked: the tour may replay, nothing breaks */ }
  }
  function setOff() {
    try { localStorage.setItem(OFF_KEY, '1'); } catch (e) { /* blocked */ }
  }
  function isOff() {
    try { return localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; }
  }

  // Reduce-motion visitors are not skipped: the engine gives them the calm
  // step-by-step view instead of the animation.
  function shouldAutoplay(env, key) {
    if (env.force) return true;
    return !(env.seen && env.seen[key]) && !env.off && !env.webdriver && !env.intent && !env.saveData;
  }

  // A link that carries anything beyond tracking tags (?v=<vacancy> from a share,
  // ?search=... filters) means the visitor came for something specific; the
  // tour waits for a plain visit instead (it is not marked seen).
  var TRACKING = /^(tour|tourSpeed|utm_[a-z_]+|fbclid|gclid|ref)$/i;
  function hasIntent(params) {
    if (!params) return false;
    var found = false;
    params.forEach(function (_, k) { if (!TRACKING.test(k)) found = true; });
    return found;
  }
  function wantsLessData() {
    var c = navigator.connection;
    return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
  }

  /* ---------- lazy asset loading, strictly in order ---------- */
  var loading = null;
  function loadOne(src) {
    return new Promise(function (resolve, reject) {
      var isCss = /\.css$/.test(src);
      var el = document.createElement(isCss ? 'link' : 'script');
      if (isCss) { el.rel = 'stylesheet'; el.href = src + VERSION; }
      else { el.src = src + VERSION; el.async = false; }
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('could not load ' + src)); };
      (isCss ? document.head : document.body).appendChild(el);
    });
  }
  function loadAssets(key) {
    if (!loading) {
      loading = CORE.concat(SCENES[key] || []).reduce(function (chain, src) {
        return chain.then(function () { return loadOne(src); });
      }, Promise.resolve());
      // A failed load is forgotten so a later replay can retry (slow networks recover).
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  function play(key, opts) {
    opts = opts || {};
    return loadAssets(key).then(function () {
      if (!window.DepTour || typeof window.DepTour.play !== 'function') return 'unavailable';
      return window.DepTour.play(key, { speed: opts.speed || 1, mode: opts.mode || 'auto' });
    }).catch(function (err) {
      try { console.warn('[tour]', err && err.message ? err.message : err); } catch (e) {}
      return 'unavailable';
    });
  }

  /* ---------- floating replay button ---------- */
  var CSS =
    '.dt-replay{position:fixed;right:16px;bottom:16px;z-index:69;display:inline-flex;align-items:center;gap:8px;' +
    'padding:9px 15px 9px 12px;border-radius:999px;border:1px solid rgba(165,243,252,.28);' +
    'background:rgba(15,23,42,.72);-webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%);' +
    'color:#e6fbff;font:600 13px/1 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;' +
    'box-shadow:0 8px 28px -8px rgba(34,211,238,.45),inset 0 1px 0 rgba(255,255,255,.08);' +
    'transition:opacity .25s ease,transform .25s ease,border-color .2s ease,box-shadow .2s ease}' +
    '.dt-replay:hover{border-color:rgba(34,211,238,.7);box-shadow:0 10px 34px -6px rgba(34,211,238,.6),inset 0 1px 0 rgba(255,255,255,.1)}' +
    '.dt-replay:focus-visible{outline:2px solid #22d3ee;outline-offset:3px}' +
    '.dt-replay .dt-replay-ico{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:9px;' +
    'background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#02040b;padding-left:2px}' +
    '.dt-replay--hidden{opacity:0;transform:translateY(10px);pointer-events:none}' +
    '.dt-replay.dt-replay--gone{opacity:0;transform:translateY(12px) scale(.9);pointer-events:none;transition:opacity .8s ease,transform .8s ease}' +
    'html.dt-open .dt-replay{display:none}' +
    'html[data-tour-pending] [data-tour-hidden]{visibility:hidden}' +
    '@media (prefers-reduced-motion: reduce){.dt-replay{transition:opacity .2s ease}.dt-replay--hidden{transform:none}}' +
    '@media print{.dt-replay{display:none}}';

  function injectButton() {
    if (!KEY || document.querySelector('.dt-replay')) return;
    var style = document.createElement('style');
    style.id = 'dt-replay-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dt-replay';
    btn.setAttribute('aria-label', 'Play the how-to demo for this page');
    btn.innerHTML = '<span class="dt-replay-ico" aria-hidden="true">▶</span>How this works';
    btn.addEventListener('click', function () { play(KEY, { mode: 'auto' }); });
    document.body.appendChild(btn);
    watchFooter(btn);
    // Owner, 2026-11-06: the button bows out after 10 s (back on the next load).
    setTimeout(function () { btn.classList.add('dt-replay--gone'); }, BUTTON_LIFE - 800);
    setTimeout(function () { btn.remove(); }, BUTTON_LIFE);
  }

  // Never cover the footer trust line: fade the button out while the footer is on screen.
  function watchFooter(btn) {
    if (!('IntersectionObserver' in window)) return;
    var tries = 0;
    (function find() {
      var footer = document.querySelector('.sw-footer');
      if (footer) {
        new IntersectionObserver(function (entries) {
          var last = entries[entries.length - 1];
          btn.classList.toggle('dt-replay--hidden', !!(last && last.isIntersecting));
        }).observe(footer);
      } else if (++tries < 20) {
        setTimeout(find, 500);
      }
    })();
  }

  /* ---------- auto-play decision ---------- */
  function whenSettled(fn) {
    function idle() {
      if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 800 });
      else setTimeout(fn, 800);
    }
    function go() {
      if (pageReady) return idle();
      var done = false;
      function once() { if (done) return; done = true; idle(); }
      document.addEventListener(READY_EVENT, once, { once: true });
      setTimeout(once, READY_WAIT);
    }
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  function boot() {
    injectButton();
    if (!KEY) return;
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    var force = !!params && params.get('tour') === 'play';
    var speed = params ? parseFloat(params.get('tourSpeed')) : NaN;
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var env = {
      seen: readSeen(),
      off: isOff(),
      webdriver: navigator.webdriver === true,
      reducedMotion: reduced,
      intent: hasIntent(params),
      saveData: wantsLessData(),
      force: force
    };
    if (!shouldAutoplay(env, KEY)) return;
    hold();

    // Busy means busy *now*: someone touching the page in the last IDLE_MS is
    // not interrupted; the tour waits until they pause (or, if they never do,
    // tries again on a later visit). A tap while the page loads no longer
    // cancels it (owner, 2026-11-06: the map tour was always skipped).
    var lastInput = -Infinity;
    var EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    function onInput() { lastInput = Date.now(); }
    EVENTS.forEach(function (t) { window.addEventListener(t, onInput, { capture: true, passive: true }); });
    function stop() { EVENTS.forEach(function (t) { window.removeEventListener(t, onInput, { capture: true, passive: true }); }); }
    // Fetch the tour while the page finishes its own start-up, so it opens at once.
    function preload() { loadAssets(KEY).catch(function () {}); }
    if (document.readyState === 'complete') preload();
    else window.addEventListener('load', preload, { once: true });
    whenSettled(function () {
      // Decide once the tour is actually ready to show: someone who started
      // tapping while it downloaded is busy then, and gets the page instead.
      // The first look waits one task: on a slow phone the last script can
      // freeze the page for seconds, and taps made meanwhile are queued
      // behind it; they must count before the visitor is judged idle.
      loadAssets(KEY).then(function () { setTimeout(start, 50); }, function () { stop(); release(); });
    });
    function start() {
      var giveUp = Date.now() + BUSY_GIVE_UP;
      (function check() {
        var quiet = Date.now() - lastInput;
        if (force || quiet >= IDLE_MS) {
          stop();
          return play(KEY, { speed: speed > 0 ? speed : 1, mode: force ? 'cinematic' : 'auto' })
            .then(function (r) { if (r === 'unavailable') release(); });
        }
        release();                                    // busy: show them the page now
        if (Date.now() > giveUp) return stop();
        setTimeout(check, IDLE_MS - quiet + 50);
      })();
    }
  }

  window.DepTourLoader = {
    key: KEY,
    shouldAutoplay: shouldAutoplay,
    readSeen: readSeen,
    markSeen: markSeen,
    setOff: setOff,
    isOff: isOff,
    play: play
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
