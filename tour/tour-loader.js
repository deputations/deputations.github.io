/* ============================================================
   tour/tour-loader.js — site tour loader (always loaded, ~2 KB).

   Decides whether this page's "how to use" demo auto-plays, injects
   the floating "How this works" replay button, and lazy-loads GSAP,
   the engine, the kit and the page's scenes only when a demo plays.

   Wire on a page with:
     <script defer src="/tour/tour-loader.js?v=1" data-tour="home"></script>

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §4.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourLoader) return;

  var script = document.currentScript;
  var KEY = (script && script.dataset && script.dataset.tour) || '';
  var SEEN_KEY = 'dep_tour_seen_v1';
  var OFF_KEY = 'dep_tour_off_v1';
  var VERSION = '?v=1';
  var CORE = ['/vendor/gsap.min.js', '/tour/tour.css', '/tour/tour-engine.js', '/tour/tour-kit.js'];
  var SCENES = {
    home: ['/tour/scenes/map.js', '/tour/scenes/pages.js', '/tour/scenes/home-more.js', '/tour/scenes/home.js']
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

  function shouldAutoplay(env, key) {
    if (env.force) return true;
    return !(env.seen && env.seen[key]) && !env.off && !env.webdriver && !env.reducedMotion &&
      !env.intent && !env.saveData;
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
    'html.dt-open .dt-replay{display:none}' +
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
    function go() {
      if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 800 });
      else setTimeout(fn, 800);
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

    // Someone already tapping or typing before the page settles is busy: don't
    // pull the page out from under them; the tour plays on a later visit.
    var busy = false;
    var EVENTS = ['pointerdown', 'keydown'];
    function onBusy() { busy = true; }
    EVENTS.forEach(function (t) { window.addEventListener(t, onBusy, true); });
    whenSettled(function () {
      EVENTS.forEach(function (t) { window.removeEventListener(t, onBusy, true); });
      if (busy && !force) return;
      play(KEY, { speed: speed > 0 ? speed : 1, mode: force ? 'cinematic' : 'auto' });
    });
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
