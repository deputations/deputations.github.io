/* ============================================================================
   home-flourish.js — OPTIONAL homepage enhancements (Tier A + B).
   FENCED + self-contained: delete the one <script> in index.html to fully revert.
   No dependency on app.js internals — hooks via delegated/observed DOM only.
   A2 title sheen · A3 haptic · B1 fly-to-watchlist bead · A4 urgency · B2 spotlight.
   ============================================================================ */
(function () {
  "use strict";

  var MM_MOTION = matchMedia("(prefers-reduced-motion: no-preference)").matches;
  var MM_FINE   = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var MM_WIDE   = matchMedia("(min-width: 901px)").matches;
  var FX = MM_MOTION && MM_FINE && MM_WIDE;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---- A2: one-shot title sheen, fired after the typewriter settles ---- */
  setTimeout(function () {
    var t = document.querySelector(".header-logo h1 .gradient-text[data-tw]");
    if (t) t.classList.add("hf-sheen");
  }, 1800);

  /* ---- A3 + B1: bookmark haptic + fly-to-watchlist bead ----
     Capture phase so it runs BEFORE app.js's stopPropagation on the same click. */
  function haptic() { if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} } }
  function popFavCount() {
    var fc = document.getElementById("favCount");
    if (!fc) return;
    fc.classList.remove("hf-pop"); void fc.offsetWidth; fc.classList.add("hf-pop");
  }
  function flyToWatchlist(srcEl) {
    if (!MM_MOTION || !srcEl || !srcEl.animate) return;
    var fav = document.getElementById("favBtn");
    if (!fav) return;
    var s = srcEl.getBoundingClientRect(), d = fav.getBoundingClientRect();
    if (!s.width || !d.width) return;
    var sx = s.left + s.width / 2, sy = s.top + s.height / 2;
    var ex = d.left + d.width / 2, ey = d.top + d.height / 2;
    var dx = ex - sx, dy = ey - sy;
    var bead = document.createElement("span");
    bead.className = "hf-bead";
    bead.style.left = sx + "px"; bead.style.top = sy + "px";
    document.body.appendChild(bead);
    var a = bead.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
      { transform: "translate(" + (dx * 0.5) + "px," + (dy * 0.5 - 70) + "px) scale(1.25)", opacity: 1, offset: 0.55 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(.4)", opacity: .8, offset: 1 }
    ], { duration: 560, easing: "cubic-bezier(.45,0,.25,1)" });
    a.onfinish = function () { bead.remove(); popFavCount(); };
    a.oncancel = function () { bead.remove(); };
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-card-action="watchlist"], [data-table-action="watchlist"]');
    if (!btn) return;
    if (btn.classList.contains("saved")) return; // removing a bookmark → no celebration
    haptic();
    flyToWatchlist(btn);
  }, true);

  /* ---- A4: urgency-as-light — pulse pills closing in <=3 days ---- */
  function markUrgent(root) {
    var pills = (root || document).querySelectorAll(".days-pill");
    for (var i = 0; i < pills.length; i++) {
      var txt = (pills[i].textContent || "").trim().toLowerCase();
      var urgent = txt === "closes today" || /^[0-3]\s*days?$/.test(txt);
      pills[i].classList.toggle("hf-urgent", urgent);
    }
  }
  function watchDashboard() {
    var dc = document.getElementById("dataContainer");
    if (!dc) return;
    markUrgent(dc);
    var raf = 0;
    new MutationObserver(function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; markUrgent(dc); });
    }).observe(dc, { childList: true, subtree: true });
  }

  /* ---- B2: cursor spotlight on the 4 KPI cards (one rAF loop; desktop/fine only) ---- */
  function setupKpiSpotlight() {
    if (!FX) return;
    var grid = document.getElementById("kpiGrid");
    if (!grid) return;
    var pt = { x: 0, y: 0 }, active = null, rect = null, raf = 0;
    function reset(c) { c.style.removeProperty("--hf-mx"); c.style.removeProperty("--hf-my"); }
    grid.addEventListener("pointermove", function (e) {
      var card = e.target.closest(".kpi-card");
      if (card !== active) { if (active) reset(active); active = card; rect = card ? card.getBoundingClientRect() : null; }
      pt.x = e.clientX; pt.y = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    grid.addEventListener("pointerleave", function () { if (active) { reset(active); active = null; rect = null; } });
    addEventListener("scroll", function () { if (active) rect = active.getBoundingClientRect(); }, { passive: true });
    function tick() {
      raf = 0;
      if (!active || !rect) return;
      active.style.setProperty("--hf-mx", (clamp((pt.x - rect.left) / rect.width, 0, 1) * 100).toFixed(1) + "%");
      active.style.setProperty("--hf-my", (clamp((pt.y - rect.top) / rect.height, 0, 1) * 100).toFixed(1) + "%");
    }
  }

  /* ---- Card view (.vx-card): cursor spotlight + 3D tilt (folds in the -3px lift) ----
     One delegated loop on #dataContainer (persists across re-renders). .hf-tilt is
     added only while a card is hovered, which disables its vx-in reveal so the tilt
     transform applies; on leave the transform eases back, then .hf-tilt is removed. */
  function setupCardTilt() {
    if (!FX) return;
    var dc = document.getElementById("dataContainer");
    if (!dc) return;
    var pt = { x: 0, y: 0 }, active = null, rect = null, raf = 0;
    function release(card) {
      card.style.transform = "";
      if (card.__hfT) clearTimeout(card.__hfT);
      card.__hfT = setTimeout(function () {
        card.classList.remove("hf-tilt");
        card.style.removeProperty("--vx-mx"); card.style.removeProperty("--vx-my");
        card.__hfT = 0;
      }, 220);
    }
    dc.addEventListener("pointermove", function (e) {
      var card = e.target.closest(".vx-card");
      if (card !== active) {
        if (active) release(active);
        active = card;
        if (active) {
          if (active.__hfT) { clearTimeout(active.__hfT); active.__hfT = 0; }
          active.classList.add("hf-tilt");
          rect = active.getBoundingClientRect();
        } else rect = null;
      }
      pt.x = e.clientX; pt.y = e.clientY;
      if (active && !raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    dc.addEventListener("pointerleave", function () { if (active) { release(active); active = null; rect = null; } });
    addEventListener("scroll", function () { if (active) rect = active.getBoundingClientRect(); }, { passive: true });
    function tick() {
      raf = 0;
      if (!active || !rect) return;
      var lx = clamp((pt.x - rect.left) / rect.width, 0, 1);
      var ly = clamp((pt.y - rect.top) / rect.height, 0, 1);
      active.style.setProperty("--vx-mx", (lx * 100).toFixed(1) + "%");
      active.style.setProperty("--vx-my", (ly * 100).toFixed(1) + "%");
      var ry = ((lx - 0.5) * 8).toFixed(2);   // ±4°
      var rx = (-(ly - 0.5) * 8).toFixed(2);  // ±4°
      active.style.transform = "perspective(900px) rotateX(" + rx + "deg) rotateY(" + ry + "deg) translateY(-4px)";
    }
  }

  function init() { watchDashboard(); setupKpiSpotlight(); setupCardTilt(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
