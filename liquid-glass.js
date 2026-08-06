/* ============================================================================
   liquid-glass.js — capability detection + the single motion engine that
   drives liquid-glass.css.

   FENCED + self-contained: delete the <script> + <link> pair inside the
   <!-- BEGIN liquid-glass --> fences in index.html to fully revert.
   No dependency on app.js internals — everything hooks via CSS custom
   properties, so app.js re-rendering .kpi-card innerHTML costs us nothing.

   WHAT IT DOES
     1. sets capability classes on <html>: lg-on / lg-fx / lg-refract / lg-thead
     2. injects the SVG displacement filter used by .lg-refract
     3. runs ONE rAF loop publishing --lg-px / --lg-py / --lg-scroll on :root
        and --lg-lx / --lg-ly (local coords) on the registered surfaces
     4. measures whether a blurred sticky table header costs frames, and only
        then turns it on

   DELIBERATE REUSE: home-flourish.js:80-100 already runs a pointer loop over
   #kpiGrid writing --hf-mx / --hf-my. The stat-card spotlight in
   liquid-glass.css CONSUMES those existing variables — this file adds no
   second tracker for the KPI row.
   ============================================================================ */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---- 1. capability ladder ------------------------------------------------
     Mirrors the perf budget already in the codebase: style.css:5819 kills
     backdrop-filter <=768px, hero-wave.js:24 skips WebGL there. One budget,
     not two competing ones. */
  var supportsBackdrop =
    CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)");

  var mqSmall   = matchMedia("(max-width: 768px)");
  var mqMotion  = matchMedia("(prefers-reduced-motion: no-preference)");
  var mqFine    = matchMedia("(hover: hover) and (pointer: fine)");
  var mqWide    = matchMedia("(min-width: 901px)");
  var mqLessTransparency = matchMedia("(prefers-reduced-transparency: reduce)");

  var nav = navigator;
  var lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory < 4;
  var saveData  = !!(nav.connection && nav.connection.saveData);

  /* Hard gates — properties of the device/browser that cannot change while
     the page is open. Failing any of these means the layer never activates. */
  if (!supportsBackdrop || mqLessTransparency.matches || lowMemory || saveData) {
    return;                              // today's site, untouched
  }

  /* Soft gates — viewport-dependent, so they are re-evaluated on change.
     Without this, loading in a narrow window and then maximising would leave
     the glass permanently off. */
  var FX = false;

  function applyGates() {
    var glassOk = !mqSmall.matches;
    root.classList.toggle("lg-on", glassOk);

    FX = glassOk && mqMotion.matches && mqFine.matches && mqWide.matches;
    root.classList.toggle("lg-fx", FX);
    if (FX && REFRACT) {
      injectFilter();          /* injected lazily: a phone that never turns the
                                  glass on should not carry an unused filter */
      root.classList.add("lg-refract");
    } else {
      root.classList.remove("lg-refract");
    }
  }

  /* SVG filters inside backdrop-filter are Chromium-only today; Safari and
     Firefox silently no-op, which would leave the surface un-frosted. Gate it. */
  var REFRACT = CSS.supports("backdrop-filter", "url(#x)");

  /* ---- 2. the displacement filter -----------------------------------------
     feTurbulence generates a smooth noise field; feDisplacementMap uses its
     R/G channels to push the backdrop's pixels sideways. That IS refraction —
     the backdrop genuinely bends, rather than being faked with a gradient.
     Low baseFrequency + modest scale = thick glass, not a funhouse mirror. */
  function injectFilter() {
    if (document.getElementById("lg-svg-defs")) return;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.id = "lg-svg-defs";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    svg.innerHTML =
      '<filter id="lg-refraction" x="-20%" y="-20%" width="140%" height="140%"' +
      ' color-interpolation-filters="sRGB">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.016"' +
        ' numOctaves="2" seed="7" result="noise"/>' +
        '<feGaussianBlur in="noise" stdDeviation="3" result="softNoise"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="softNoise" scale="14"' +
        ' xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>';
    document.body.appendChild(svg);
  }

  applyGates();

  /* ---- 3. the motion engine ------------------------------------------------
     ONE rAF loop. Passive listeners. IntersectionObserver so off-screen
     surfaces cost nothing. Values are written only when they actually change
     by a visible amount, so an idle page does zero style work. */

  var SURFACES = ".filters-sidebar.glass-panel, .ai-search-bar, .toolbar-line";

  var ptr = { x: 0, y: 0, has: false };
  var scrollN = 0;
  var lastScrollN = -1;
  var lastPx = -1, lastPy = -1;
  var frame = 0;
  var tracked = [];          // [{el, rect}] — only the on-screen surfaces

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function refreshRects() {
    for (var i = 0; i < tracked.length; i++) {
      tracked[i].rect = tracked[i].el.getBoundingClientRect();
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function tick() {
    frame = 0;

    /* global scroll depth, 0..1 over the first 240px — this is what makes the
       nav thicken as content passes under it */
    if (scrollN !== lastScrollN) {
      root.style.setProperty("--lg-scroll", scrollN.toFixed(3));
      lastScrollN = scrollN;
    }

    if (!FX || !ptr.has) return;

    /* viewport-normalised pointer drives the tint angle + aberration offset
       on every surface at once */
    var px = clamp(ptr.x / window.innerWidth, 0, 1);
    var py = clamp(ptr.y / window.innerHeight, 0, 1);
    if (Math.abs(px - lastPx) > 0.002 || Math.abs(py - lastPy) > 0.002) {
      root.style.setProperty("--lg-px", px.toFixed(3));
      root.style.setProperty("--lg-py", py.toFixed(3));
      lastPx = px; lastPy = py;
    }

    /* local coords position each surface's specular highlight */
    for (var i = 0; i < tracked.length; i++) {
      var t = tracked[i], r = t.rect;
      if (!r || !r.width) continue;
      var lx = clamp((ptr.x - r.left) / r.width, -0.5, 1.5) * 100;
      var ly = clamp((ptr.y - r.top) / r.height, -0.5, 1.5) * 100;
      t.el.style.setProperty("--lg-lx", lx.toFixed(1) + "%");
      t.el.style.setProperty("--lg-ly", ly.toFixed(1) + "%");
    }
  }

  function onScroll() {
    scrollN = clamp((window.scrollY || window.pageYOffset || 0) / 240, 0, 1);
    refreshRects();
    schedule();
  }

  function onPointerMove(e) {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true;
    schedule();
  }

  /* only track surfaces that are actually on screen */
  var io = "IntersectionObserver" in window
    ? new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i].target;
          var idx = -1;
          for (var j = 0; j < tracked.length; j++) if (tracked[j].el === el) { idx = j; break; }
          if (entries[i].isIntersecting) {
            if (idx === -1) tracked.push({ el: el, rect: el.getBoundingClientRect() });
          } else if (idx !== -1) {
            tracked.splice(idx, 1);
            el.style.removeProperty("--lg-lx");
            el.style.removeProperty("--lg-ly");
          }
        }
        schedule();
      }, { rootMargin: "120px" })
    : null;

  function registerSurfaces() {
    var els = document.querySelectorAll(SURFACES);
    for (var i = 0; i < els.length; i++) {
      if (io) io.observe(els[i]);
      else tracked.push({ el: els[i], rect: els[i].getBoundingClientRect() });
    }
  }

  /* ---- 4. sticky-header cost probe ----------------------------------------
     backdrop-filter on a position:sticky element inside an overflow:auto
     container (the P1-9 nested table scroller) can force a full backdrop
     repaint every scroll frame in Chromium. Rather than guess, measure: run
     the blurred header for a short burst of real frames and keep it only if
     the frame budget holds. Otherwise the header keeps its plank silhouette
     with rim + depth and no blur — visually most of the win, none of the cost.

     Called once, after the table has actually rendered. */
  function measureStickyCost() {
    var wrapper = document.querySelector(".table-wrapper");
    if (!wrapper || !document.querySelector(".data-table thead th")) return;

    /* Fail SAFE, not fail-open: the header starts on the no-blur fallback and
       only earns the blur by passing. A background tab gets no rAF at all, so
       an optimistic class would leave an unmeasured blur switched on forever. */
    if (document.visibilityState !== "visible") {
      document.addEventListener("visibilitychange", function onVis() {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVis);
          measureStickyCost();
        }
      });
      return;
    }

    /* Already decided on this device? Don't re-measure on every page view. */
    var cached = readVerdict();
    if (cached !== null) {
      root.classList.toggle("lg-thead", cached.kept);
      window.__lgThead = cached;
      return;
    }

    /* A/B, not a single reading. Measuring only the blurred pass would score
       whatever else the page happens to be doing — right after app.js rebuilds
       the table that's a lot. So: scroll the wrapper WITHOUT the blur to get a
       baseline, then WITH it, and compare the two medians. What survives is
       the blur's own cost. */
    var startY = wrapper.scrollTop;
    var PASS_MS = 320;

    function runPass(blurOn, done) {
      root.classList.toggle("lg-thead", blurOn);
      var samples = [], last = performance.now(), t0 = last, n = 0, raf = 0;

      function step(now) {
        samples.push(now - last);
        last = now;
        n++;
        /* 1px is enough to force the sticky header to re-composite, and is
           imperceptible — an 8px nudge read as the table visibly jittering
           for half a second on every load */
        wrapper.scrollTop += (n % 2 === 0) ? 1 : -1;
        if (now - t0 < PASS_MS) raf = requestAnimationFrame(step);
        else { cancelAnimationFrame(raf); wrapper.scrollTop = startY; done(samples); }
      }
      raf = requestAnimationFrame(step);
    }

    function median(a) {
      if (!a.length) return Infinity;
      var s = a.slice().sort(function (x, y) { return x - y; });
      return s[Math.floor(s.length / 2)];
    }

    runPass(false, function (base) {
      runPass(true, function (blur) {
        /* drop the first sample of each pass — it carries the style
           recalculation from toggling the class, not steady-state cost */
        var b = median(base.slice(1)), g = median(blur.slice(1));
        var enough = base.length >= 6 && blur.length >= 6;
        /* keep the blur if it neither pushes past the 60fps budget nor costs
           more than half again the baseline frame time */
        var keep = enough && g <= 20 && g <= b * 1.5;
        root.classList.toggle("lg-thead", keep);

        /* exposed so verification reads the real numbers instead of trusting */
        var verdict = {
          baselineMs: isFinite(b) ? +b.toFixed(2) : null,
          blurredMs: isFinite(g) ? +g.toFixed(2) : null,
          costMs: isFinite(g - b) ? +(g - b).toFixed(2) : null,
          baseFrames: base.length,
          blurFrames: blur.length,
          enoughSamples: enough,
          kept: keep
        };
        window.__lgThead = verdict;
        /* Only cache a verdict we could actually measure. An inconclusive run
           (background tab, software rendering) must not be frozen in as a
           permanent "no" — leave it to be retried next visit. */
        if (enough) writeVerdict(verdict);
      });
    });
  }

  var VERDICT_KEY = "dep_lg_thead_v1";

  function readVerdict() {
    try {
      var raw = localStorage.getItem(VERDICT_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return typeof v === "object" && v && typeof v.kept === "boolean" ? v : null;
    } catch (e) { return null; }
  }

  function writeVerdict(v) {
    try { localStorage.setItem(VERDICT_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  /* Wait for app.js to paint the table, then let the main thread go quiet
     before measuring — probing mid-render scores the render, not the blur. */
  function whenTableReady(cb) {
    function settleThen() {
      var go = function () { setTimeout(cb, 400); };
      if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 2000 });
      else setTimeout(go, 600);
    }
    if (document.querySelector(".data-table thead th")) { settleThen(); return; }

    var dc = document.getElementById("dataContainer");
    if (!dc) return;
    var done = false;
    var mo = new MutationObserver(function () {
      if (done) return;
      if (document.querySelector(".data-table thead th")) {
        done = true; mo.disconnect(); settleThen();
      }
    });
    mo.observe(dc, { childList: true, subtree: true });
    setTimeout(function () { if (!done) { done = true; mo.disconnect(); } }, 15000);
  }

  /* ---- 5. wiring ---------------------------------------------------------- */
  function init() {
    registerSurfaces();
    onScroll();

    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", function () { refreshRects(); schedule(); }, { passive: true });
    if (FX) addEventListener("pointermove", onPointerMove, { passive: true });

    /* app.js rebuilds .toolbar-line's neighbours and the sidebar can collapse /
       expand — re-register when the layout changes shape */
    var main = document.querySelector(".main-layout");
    if (main && "MutationObserver" in window) {
      var pending = 0;
      new MutationObserver(function () {
        if (pending) return;
        pending = requestAnimationFrame(function () {
          pending = 0;
          if (io) { io.disconnect(); tracked.length = 0; }
          registerSurfaces();
        });
      }).observe(main, { childList: true, subtree: false });
    }

    /* viewport-dependent gates are live: maximising a narrow window turns the
       glass on, and dropping to phone width turns it (and the pointer loop)
       back off without a reload */
    var mqs = [mqSmall, mqWide, mqMotion, mqFine];
    for (var i = 0; i < mqs.length; i++) {
      if (mqs[i].addEventListener) mqs[i].addEventListener("change", onGateChange);
      else if (mqs[i].addListener) mqs[i].addListener(onGateChange);   /* older Safari */
    }

    /* The probe only makes sense where the glass is actually on. Below the
       glass threshold there is nothing to measure and nothing to enable. */
    if (!root.classList.contains("lg-on")) return;
    if (FX) whenTableReady(measureStickyCost);
    else root.classList.add("lg-thead");   /* no pointer FX: no probe needed */
  }

  function onGateChange() {
    applyGates();
    refreshRects();
    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
