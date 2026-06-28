/* Upcoming Projects — "Election Night / live results desk" frontend logic.
 * Preserves all backend wiring (theme toggle, rpc(), PROJECTS, per-project
 * like/dislike via record_sentiment / get_sentiment "project:<slug>", and the
 * suggestion POST to /functions/v1/submit). Adds the reward layer: scaleX meter
 * + --up-heat glow, ballot-drop (button spring + confetti + odometer), a load-
 * time leaderboard, hero count-ups (net-new IntersectionObserver), one rAF
 * pointer engine (spotlight + tilt + magnet), and aria-live. Every effect is
 * gated behind prefers-reduced-motion AND hard-disabled <=900px / on touch,
 * with a correct static end-state. */
(function () {
  "use strict";

  /* ---------- Effect gates (computed once) ---------- */
  var MM_MOTION = matchMedia("(prefers-reduced-motion: no-preference)").matches;
  var MM_FINE   = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var MM_WIDE   = matchMedia("(min-width: 901px)").matches;
  var FX = MM_MOTION && MM_FINE && MM_WIDE;

  /* ---------- Theme toggle (persisted, unified key) ---------- */
  var THEME_KEY = "deputation_theme_v1";
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark"); }
  try { applyTheme(localStorage.getItem(THEME_KEY) || "dark"); } catch (e) {}
  document.addEventListener("DOMContentLoaded", function () {
    var tb = document.getElementById("upThemeToggle");
    if (tb) tb.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });
  });

  /* ---------- Supabase helpers (mirror site-widgets.js / contact.js) ---------- */
  var SB_URL = (window.SUPABASE_URL || "").replace(/\/+$/, "");
  var SB_KEY = window.SUPABASE_ANON_KEY || "";
  var SB_OK  = /^https:\/\/[a-z0-9]+\.supabase\.co/.test(SB_URL) && SB_KEY.length > 20;
  var SB_HEAD = { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };

  function rpc(fn, body) {
    if (!SB_OK) return Promise.resolve(null);
    return fetch(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: SB_HEAD, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ============================================================================
     PROJECTS are now managed from the admin console ("🚀 Projects" tab), stored
     in the Supabase `upcoming_projects` table, and loaded at runtime (see
     loadProjects() / init()). The array below is only the OFFLINE FALLBACK shown
     if the table is unreachable or empty — keep it roughly in sync with the seed
     in supabase/migrations/0013_upcoming_projects.sql.
     ============================================================================ */
  var PROJECTS = [
    {
      slug: "v2-pdf-reader",
      title: "V² PDF Reader",
      status: "design",
      tags: ["Desktop", "Windows", "Productivity"],
      icon: "file",
      image: "",
      blurb: "A fast, distraction-free Windows PDF reader from V² — read, annotate, edit, convert and protect documents in one clean, modern workspace."
    },
    {
      slug: "health-fitness",
      title: "AI Health Companion App",
      status: "concept",
      tags: ["Blood reports → plan", "Workouts & nutrition", "Sleep & recovery", "Retest proof"],
      icon: "pulse",
      image: "",
      blurb: "From blood reports to workouts, sleep, nutrition and recovery — your whole health journey in **one AI companion**. Your labs, daily habits and fitness goals usually live in apps that never talk to each other; this **connects them**. Upload a blood report and AI explains every abnormal marker in plain English and builds a personalised plan — lifestyle, nutrition, supplements, reminders — while also planning workouts, adapting when equipment isn't available, and tracking sleep, hydration, activity and weight. The real innovation is **the link between them**: your labs shape your fitness plan, your habits shape your health plan, and the plan evolves automatically as you improve. Months later it prompts a fresh blood report and compares it with the last — showing exactly what changed, and **proving your effort worked**."
    },
    {
      slug: "deputation-alerts",
      title: "Deputation Alert Bot",
      status: "design",
      tags: ["Alerts", "WhatsApp / Telegram", "Automation"],
      icon: "bell",
      image: "",
      blurb: "Get an instant ping the moment a vacancy matches your pay level, ministry and location preferences — on WhatsApp or Telegram — so you never miss a closing date."
    },
    {
      slug: "pay-pension-estimator",
      title: "Pay & Pension Estimator",
      status: "concept",
      tags: ["Calculator", "7th CPC", "Finance"],
      icon: "calculator",
      image: "",
      blurb: "Model how a deputation move changes your take-home — deputation (duty) allowance, pay protection, HRA — and a rough pension impact, all before you apply."
    },
    {
      slug: "cadre-connect",
      title: "Cadre Connect",
      status: "planned",
      tags: ["Community", "Mentorship", "Q&A"],
      icon: "users",
      image: "",
      blurb: "An anonymous space to ask officers who've actually been on deputation to a ministry or CCA what it's really like — vigilance, NOC, workload, and coming back to the parent cadre."
    },
    {
      slug: "document-vault",
      title: "Document Vault & Reminders",
      status: "concept",
      tags: ["Tracker", "Documents", "Reminders"],
      icon: "folder",
      image: "",
      blurb: "A private checklist for the paperwork deputation needs — NOC, vigilance clearance, APAR dossiers, cadre clearance — with deadline reminders so nothing stalls your application."
    }
  ];

  /* placeholder-art glyphs (inner SVG of a 24x24 stroke icon) */
  var ICONS = {
    bell:       '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/>',
    users:      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    folder:     '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M8 13h8M8 17h5"/>',
    file:       '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
    pulse:      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
    spark:      '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'
  };

  /* UI icons */
  var SVG = {
    up:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21h4V9H2v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L14.17 1 7.59 7.59A1.99 1.99 0 0 0 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L11.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>',
    plus:  '<svg class="up-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    send:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>',
    check: '<svg class="up-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4 3.5L12 4l5 6.5L21 7l-1.4 11H4.4z"/></svg>'
  };

  var STATUS_LABEL = { concept: "Concept", design: "In design", planned: "Planned" };
  var BY_SLUG = {};
  PROJECTS.forEach(function (p) { BY_SLUG[p.slug] = p; });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function votedKey(slug) { return "up_voted_" + slug; }

  /* Rich blurb: escape first (XSS-safe), then apply a tiny markup layer —
     **phrase** -> brand-tinted bold, and the opening sentence -> a lead line. */
  function blurbHTML(text) {
    var t = esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong class="up-em">$1</strong>');
    var m = t.match(/^(.*?[.!?])(\s+)([\s\S]+)$/);
    if (m && m[3].length > 40) return '<span class="up-lead">' + m[1] + '</span>' + m[3];
    return t;
  }

  /* ---------- Render ---------- */
  function cardHTML(p, i) {
    var media = p.image
      ? '<img class="up-img" src="' + esc(p.image) + '" alt="' + esc(p.title) + ' preview" loading="lazy">'
      : '<div class="up-media--ph" style="--i:' + i + '">' +
          '<svg class="up-ph-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[p.icon] || ICONS.spark) + '</svg>' +
          '<span class="up-ph-initial" aria-hidden="true">' + esc((p.title || "?").charAt(0)) + '</span>' +
        '</div>';
    var tags = (p.tags || []).map(function (t) { return '<span class="up-tag">' + esc(t) + '</span>'; }).join("");
    var st = p.status || "concept";
    return '' +
      '<article class="up-project" data-slug="' + esc(p.slug) + '">' +
        '<div class="up-inner">' +
          '<div class="up-media">' +
            '<span class="up-status up-status--' + esc(st) + '">' + esc(STATUS_LABEL[st] || "Idea") + '</span>' +
            '<span class="up-rank" hidden></span>' +
            media +
          '</div>' +
          '<div class="up-body">' +
            '<span class="up-folio" aria-hidden="true"></span>' +
            '<span class="up-wanted-pill" hidden>' + SVG.crown + 'Most wanted</span>' +
            '<div class="up-tags">' + tags + '</div>' +
            '<h2 class="up-name">' + esc(p.title) + '</h2>' +
            '<p class="up-desc">' + blurbHTML(p.blurb) + '</p>' +
            '<div class="up-vote">' +
              '<div class="up-vote-btns">' +
                '<button type="button" class="up-btn up-like" data-vote="up" aria-label="Liked ' + esc(p.title) + '">' + SVG.up + '<span>Liked the project</span></button>' +
                '<button type="button" class="up-btn up-dislike" data-vote="down" aria-label="Did not like ' + esc(p.title) + '">' + SVG.down + '<span>Did not like</span></button>' +
              '</div>' +
              '<div class="up-meter">' +
                '<div class="up-meter-track"><div class="up-meter-fill"></div></div>' +
                '<div class="up-meter-label"><b class="up-pct"></b><span class="up-pct-word"></span><span class="up-count">Loading…</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="up-suggest">' +
              '<button type="button" class="up-suggest-toggle" aria-expanded="false">' + SVG.plus + 'Suggest an improvement</button>' +
              '<form class="up-suggest-form" hidden>' +
                '<textarea required rows="3" aria-label="Your suggestion for ' + esc(p.title) + '" placeholder="How would you make this more useful?"></textarea>' +
                '<div class="up-suggest-row">' +
                  '<input type="text" class="up-sug-name" placeholder="Name (optional)" autocomplete="name">' +
                  '<input type="email" class="up-sug-email" placeholder="Email (optional)" autocomplete="email">' +
                '</div>' +
                '<button type="submit" class="up-suggest-send">' + SVG.send + 'Send suggestion</button>' +
                '<p class="up-suggest-msg" role="status" aria-live="polite"></p>' +
              '</form>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ---------- Numeric odometer (cancellable, reduced-motion safe) ---------- */
  function rollNumber(el, from, to, fmt) {
    if (!el) return;
    if (el.__raf) { cancelAnimationFrame(el.__raf); el.__raf = null; }
    if (!MM_MOTION || from === to) { el.textContent = fmt(to); return; }
    var start = null, dur = 520;
    function step(ts) {
      if (start == null) start = ts;
      var t = clamp((ts - start) / dur, 0, 1);
      var e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (t < 1) { el.__raf = requestAnimationFrame(step); }
      else { el.__raf = null; el.textContent = fmt(to); }
    }
    el.__raf = requestAnimationFrame(step);
  }

  /* ---------- Meter (scaleX + heat) ---------- */
  function setMeter(card, ups, downs, animateNum) {
    ups = ups || 0; downs = downs || 0;
    var total = ups + downs;
    var pct = total ? Math.round(ups / total * 100) : 0;
    card.__counts = { ups: ups, downs: downs };
    card.__pct = pct;
    var fill  = card.querySelector(".up-meter-fill");
    var pctEl = card.querySelector(".up-pct");
    var word  = card.querySelector(".up-pct-word");
    var count = card.querySelector(".up-count");
    fill.style.transform = "scaleX(" + (total ? pct / 100 : 0) + ")";
    card.style.setProperty("--up-heat", total ? (pct / 100).toFixed(3) : "0");
    if (total === 0) {
      pctEl.textContent = ""; word.textContent = ""; count.textContent = "Be the first to vote";
      card.__pctShown = 0; card.__totalShown = 0;
      return;
    }
    word.textContent = "positive ";
    if (animateNum && MM_MOTION) {
      rollNumber(pctEl, card.__pctShown || 0, pct, function (v) { return v + "% "; });
      rollNumber(count, card.__totalShown || 0, total, function (v) { return "· " + v + (v === 1 ? " vote" : " votes"); });
    } else {
      pctEl.textContent = pct + "% ";
      count.textContent = "· " + total + (total === 1 ? " vote" : " votes");
    }
    card.__pctShown = pct; card.__totalShown = total;
  }

  function markVoted(card, vote) {
    card.querySelector(".up-vote").classList.add("is-voted");
    var btn = card.querySelector('.up-btn[data-vote="' + vote + '"]');
    if (btn) btn.classList.add("is-chosen");
  }

  /* ---------- Hero / turnout stats ---------- */
  function grandTotals() {
    var votes = 0, ideasWithVotes = 0;
    document.querySelectorAll(".up-project").forEach(function (c) {
      if (c.__counts) { var t = c.__counts.ups + c.__counts.downs; votes += t; if (t > 0) ideasWithVotes++; }
    });
    return { votes: votes, ideasWithVotes: ideasWithVotes };
  }
  function refreshStats() {
    var g = grandTotals();
    var el = document.querySelector('[data-stat="votes"]');
    if (el && !el.__raf) el.textContent = g.votes.toLocaleString();
    updateTurnout();
  }
  function updateTurnout() {
    var g = grandTotals();
    var vEl = document.querySelector("[data-turnout-votes]");
    var iEl = document.querySelector("[data-turnout-ideas]");
    var bar = document.querySelector(".up-turnout-bar > i");
    if (vEl && !vEl.__raf) vEl.textContent = g.votes.toLocaleString();
    if (iEl) iEl.textContent = PROJECTS.length;
    if (bar) bar.style.transform = "scaleX(" + (PROJECTS.length ? (g.ideasWithVotes / PROJECTS.length).toFixed(3) : 0) + ")";
  }

  /* ---------- Hero count-ups (net-new, run-once IntersectionObserver) ---------- */
  function setupCountUps() {
    var hero = document.querySelector(".up-hero");
    if (!hero) return;
    var fired = false;
    function fire() {
      if (fired) return; fired = true;
      var g = grandTotals();
      rollNumber(document.querySelector('[data-stat="projects"]'), 0, PROJECTS.length, function (v) { return String(v); });
      rollNumber(document.querySelector('[data-stat="votes"]'), 0, g.votes, function (v) { return v.toLocaleString(); });
      rollNumber(document.querySelector("[data-turnout-votes]"), 0, g.votes, function (v) { return v.toLocaleString(); });
      var iEl = document.querySelector("[data-turnout-ideas]"); if (iEl) iEl.textContent = PROJECTS.length;
      var bar = document.querySelector(".up-turnout-bar > i");
      if (bar) bar.style.transform = "scaleX(" + (PROJECTS.length ? (g.ideasWithVotes / PROJECTS.length).toFixed(3) : 0) + ")";
    }
    if (!("IntersectionObserver" in window)) { fire(); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { fire(); io.disconnect(); } });
    }, { threshold: 0.25 });
    io.observe(hero);
  }

  /* ---------- Leaderboard (decided ONCE on load; layout-stable) ---------- */
  function applyLeaderboard() {
    var feed = document.getElementById("upFeed");
    var cards = Array.prototype.slice.call(feed.querySelectorAll(".up-project"));
    cards.forEach(function (c) {
      var k = c.__counts || { ups: 0, downs: 0 };
      c.__total = k.ups + k.downs;
      c.__pctv = c.__total ? (k.ups / c.__total * 100) : 0;
      c.__score = k.ups - k.downs;
    });
    var grand = cards.reduce(function (s, c) { return s + c.__total; }, 0);
    var ordered = cards.slice().sort(function (a, b) {
      return (b.__pctv - a.__pctv) || (b.__score - a.__score) || (a.__idx - b.__idx);
    });
    var feature = null;
    if (grand > 0 && ordered.length > 1) {
      var top = ordered[0], second = ordered[1];
      if (top.__total >= 5 && (top.__pctv - second.__pctv) >= 8) feature = top;
    }
    if (grand > 0) ordered.forEach(function (c) { feed.appendChild(c); }); // one-time reorder
    cards.forEach(function (c) { c.classList.remove("is-featured"); });
    ordered.forEach(function (c, i) {
      var rank = c.querySelector(".up-rank");
      var pill = c.querySelector(".up-wanted-pill");
      var folio = c.querySelector(".up-folio");
      if (grand > 0) { rank.hidden = false; rank.textContent = "#" + (i + 1); if (folio) folio.textContent = String(i + 1); }
      else { rank.hidden = true; if (folio) folio.textContent = ""; }
      if (pill) pill.hidden = (c !== feature);
    });
    if (feature) feature.classList.add("is-featured");
  }

  /* ---------- Vote-light reward (bead arc → confetti → meter flash; LIKE only) ---------- */
  function confettiAt(cx, cy, count) {
    if (!MM_MOTION) return;
    var cs = getComputedStyle(document.documentElement);
    var c1 = (cs.getPropertyValue("--up-primary") || "#22d3ee").trim();
    var c2 = (cs.getPropertyValue("--up-accent")  || "#a78bfa").trim();
    count = count || 12;
    for (var i = 0; i < count; i++) {
      var s = document.createElement("span");
      s.className = "up-confetti";
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
      var dist = 38 + Math.random() * 58;
      s.style.left = cx + "px"; s.style.top = cy + "px";
      s.style.background = (i % 2 ? c2 : c1);
      s.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(1) + "px");
      s.style.setProperty("--dy", (Math.sin(ang) * dist - 18).toFixed(1) + "px");
      s.style.setProperty("--dr", (Math.random() * 360 - 180).toFixed(0) + "deg");
      s.addEventListener("animationend", function () { this.remove(); });
      document.body.appendChild(s);
    }
  }
  function burstFromEl(el, count) {
    var r = el.getBoundingClientRect();
    confettiAt(r.left + r.width / 2, r.top + r.height / 2, count);
  }
  function flashMeter(card) {
    var track = card.querySelector(".up-meter-track");
    if (!track) return;
    track.classList.add("is-flash");
    setTimeout(function () { track.classList.remove("is-flash"); }, 380);
  }
  // a glowing cyan→violet bead detaches from the Like button and arcs into the meter
  function spawnBead(btn, card) {
    if (!MM_MOTION || !btn.animate) { burstFromEl(btn, 12); return; }
    var br = btn.getBoundingClientRect();
    var track = card.querySelector(".up-meter-track");
    var tr = track.getBoundingClientRect();
    var sx = br.left + br.width / 2, sy = br.top + br.height / 2;
    var pct = card.__pct || 0;
    var ex = tr.left + Math.max(8, tr.width * (pct / 100)), ey = tr.top + tr.height / 2;
    var dx = ex - sx, dy = ey - sy;
    var bead = document.createElement("span");
    bead.className = "up-bead";
    bead.style.left = sx + "px"; bead.style.top = sy + "px";
    document.body.appendChild(bead);
    var a = bead.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
      { transform: "translate(" + (dx * 0.5) + "px," + (dy * 0.5 - 56) + "px) scale(1.2)", opacity: 1, offset: 0.55 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(.45)", opacity: .85, offset: 1 }
    ], { duration: 470, easing: "cubic-bezier(.45,0,.25,1)" });
    a.onfinish = function () { bead.remove(); confettiAt(ex, ey, 8); flashMeter(card); };
    a.oncancel = function () { bead.remove(); };
  }

  /* ---------- aria-live (user-initiated votes only, debounced) ---------- */
  var srTimer = null;
  function announce(text) {
    var sr = document.querySelector(".up-sr");
    if (!sr) return;
    if (srTimer) clearTimeout(srTimer);
    srTimer = setTimeout(function () { sr.textContent = text; }, 400);
  }

  /* ---------- Voting ---------- */
  function onVote(btn) {
    var card = btn.closest(".up-project"); if (!card) return;
    var box = card.querySelector(".up-vote");
    if (box.classList.contains("is-voted")) return;
    var slug = card.getAttribute("data-slug");
    var vote = btn.getAttribute("data-vote");
    var prior; try { prior = localStorage.getItem(votedKey(slug)); } catch (e) {}
    if (prior) { markVoted(card, prior); return; }
    try { localStorage.setItem(votedKey(slug), vote); } catch (e) {}
    markVoted(card, vote);

    var c = card.__counts || { ups: 0, downs: 0 };
    var nu = c.ups + (vote === "up" ? 1 : 0);
    var nd = c.downs + (vote === "down" ? 1 : 0);
    setMeter(card, nu, nd, true);          // odometer + scaleX spring
    refreshStats();
    if (vote === "up") { if (FX) spawnBead(btn, card); else burstFromEl(btn, 12); } // celebration reserved for positive intent
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }           // haptic "it counted" (supported mobiles)
    announce(card.__pct != null && (nu + nd) ? ("Now " + card.__pct + "% positive, " + (nu + nd) + ((nu + nd) === 1 ? " vote" : " votes") + " — recorded.") : "Your vote was recorded.");

    rpc("record_sentiment", { p_page: "project:" + slug, p_vote: vote }).then(function (r) {
      if (r) { setMeter(card, r.ups, r.downs, MM_MOTION); refreshStats(); } // reconcile, cancels in-flight tween
    });
  }

  /* ---------- Suggestions ---------- */
  function toggleSuggest(tog) {
    var form = tog.parentNode.querySelector(".up-suggest-form");
    if (form.hasAttribute("hidden")) {
      form.removeAttribute("hidden");
      tog.setAttribute("aria-expanded", "true");
      var ta = form.querySelector("textarea"); if (ta) ta.focus();
    } else {
      form.setAttribute("hidden", "");
      tog.setAttribute("aria-expanded", "false");
    }
  }

  function onSuggest(form) {
    var card = form.closest(".up-project");
    var slug = card.getAttribute("data-slug");
    var p = BY_SLUG[slug] || { title: slug };
    var ta = form.querySelector("textarea");
    var msg = form.querySelector(".up-suggest-msg");
    var send = form.querySelector(".up-suggest-send");
    var text = (ta.value || "").trim();
    msg.className = "up-suggest-msg"; msg.textContent = "";
    if (!text) { msg.textContent = "Please write a suggestion first."; msg.classList.add("is-err"); ta.focus(); return; }
    if (!SB_OK) { msg.textContent = "Suggestions are temporarily unavailable — please use the Contact page."; msg.classList.add("is-err"); return; }

    var sendHTML = send.innerHTML;
    send.disabled = true; send.textContent = "Sending…";
    fetch(SB_URL + "/functions/v1/submit", {
      method: "POST", headers: SB_HEAD,
      body: JSON.stringify({
        action: "feedback",
        category: "Suggest a Feature",
        subject: "Project suggestion: " + (p.title || slug),
        message: text,
        name: (form.querySelector(".up-sug-name").value || "").trim(),
        email: (form.querySelector(".up-sug-email").value || "").trim(),
        page: "/upcoming-projects.html",
        pageLabel: "Project: " + (p.title || slug),
        pageContext: location.pathname,
        userAgent: navigator.userAgent || "",
        website: ""
      })
    })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .then(function (d) {
        send.disabled = false; send.innerHTML = sendHTML;
        if (d && (d.ok || d.success)) {
          form.reset();
          msg.innerHTML = SVG.check + "Thank you — your suggestion was sent.";
          msg.classList.add("is-ok");
          var sug = form.closest(".up-suggest"); if (sug) sug.classList.add("is-sent");
          burstFromEl(send, 10);
          announce("Thanks — your suggestion reached the team.");
        } else {
          msg.textContent = (d && d.message) || "Couldn't send — try the Contact page.";
          msg.classList.add("is-err");
        }
      })
      .catch(function () {
        send.disabled = false; send.innerHTML = sendHTML;
        msg.textContent = "Network error — please try the Contact page.";
        msg.classList.add("is-err");
      });
  }

  /* ---------- Pointer engine (one rAF loop; FX only) ---------- */
  function setupPointer() {
    if (!FX) return;
    var feed = document.getElementById("upFeed");
    if (!feed) return;
    var pt = { x: 0, y: 0 }, active = null, rect = null, magBtn = null, raf = 0;

    function resetCard(c) { c.style.setProperty("--mx", "50%"); c.style.setProperty("--my", "50%"); c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); }
    function resetMag(b) { b.style.setProperty("--magx", "0"); b.style.setProperty("--magy", "0"); }

    feed.addEventListener("pointerover", function (e) {
      var card = e.target.closest(".up-project");
      if (card && card !== active) { if (active) resetCard(active); active = card; rect = card.getBoundingClientRect(); }
    });
    feed.addEventListener("pointerout", function (e) {
      if (!feed.contains(e.relatedTarget)) {
        if (active) resetCard(active); active = null; rect = null;
        if (magBtn) { resetMag(magBtn); magBtn = null; }
      }
    });
    feed.addEventListener("pointermove", function (e) {
      pt.x = e.clientX; pt.y = e.clientY;
      pt.btn = e.target.closest(".up-btn, .up-cta-btn");
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    addEventListener("scroll", function () { if (active) rect = active.getBoundingClientRect(); }, { passive: true });
    addEventListener("resize", function () { if (active) rect = active.getBoundingClientRect(); }, { passive: true });

    function tick() {
      raf = 0;
      if (active && rect) {
        var lx = clamp((pt.x - rect.left) / rect.width, 0, 1);
        var ly = clamp((pt.y - rect.top) / rect.height, 0, 1);
        active.style.setProperty("--mx", (lx * 100).toFixed(1) + "%");
        active.style.setProperty("--my", (ly * 100).toFixed(1) + "%");
        active.style.setProperty("--ry", ((lx - 0.5) * 12).toFixed(2) + "deg");
        active.style.setProperty("--rx", (-(ly - 0.5) * 12).toFixed(2) + "deg");
      }
      var hb = pt.btn;
      if (hb) {
        var br = hb.getBoundingClientRect();
        hb.style.setProperty("--magx", clamp((pt.x - (br.left + br.width / 2)) / br.width * 12, -6, 6).toFixed(1) + "px");
        hb.style.setProperty("--magy", clamp((pt.y - (br.top + br.height / 2)) / br.height * 12, -6, 6).toFixed(1) + "px");
        if (magBtn && magBtn !== hb) resetMag(magBtn);
        magBtn = hb;
      } else if (magBtn) { resetMag(magBtn); magBtn = null; }
    }
  }

  /* ---------- Pause ambient loops when tab hidden ---------- */
  function setupVisibility() {
    document.addEventListener("visibilitychange", function () {
      var hidden = document.hidden;
      var aur = document.querySelector(".up-aurora"); if (aur) aur.classList.toggle("is-hidden", hidden);
      document.querySelectorAll(".up-meter-fill").forEach(function (f) { f.classList.toggle("is-hidden", hidden); });
    });
  }

  /* ---------- Load projects from the admin-managed table (fallback: PROJECTS) ---------- */
  function loadProjects() {
    if (!SB_OK) return Promise.resolve(null);
    return fetch(SB_URL + "/rest/v1/upcoming_projects?is_published=eq.true&order=sort_order.asc,created_at.asc&select=slug,title,blurb,status,tags,icon,image_url", { headers: SB_HEAD })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!rows || !rows.length) return null;
        return rows.map(function (p) {
          var tags = Array.isArray(p.tags) ? p.tags
            : (p.tags ? String(p.tags).replace(/^\{|\}$/g, "").split(",").map(function (s) { return s.replace(/^"|"$/g, "").trim(); }).filter(Boolean) : []);
          return { slug: p.slug, title: p.title || p.slug, blurb: p.blurb || "", status: p.status || "concept", tags: tags, icon: p.icon || "spark", image: p.image_url || "" };
        });
      })
      .catch(function () { return null; });
  }

  /* ---------- Render + wire the feed ---------- */
  function renderFeed(feed) {
    var pc = document.querySelector('[data-stat="projects"]');
    if (pc) pc.textContent = MM_MOTION ? "0" : PROJECTS.length;

    feed.innerHTML = PROJECTS.map(cardHTML).join("");
    var cards = Array.prototype.slice.call(feed.querySelectorAll(".up-project"));
    cards.forEach(function (c, i) { c.__idx = i; });

    var jobs = cards.map(function (card) {
      var slug = card.getAttribute("data-slug");
      var prior; try { prior = localStorage.getItem(votedKey(slug)); } catch (e) {}
      if (prior) markVoted(card, prior);
      return rpc("get_sentiment", { p_page: "project:" + slug }).then(function (r) {
        setMeter(card, r ? r.ups : 0, r ? r.downs : 0, false);
      });
    });
    Promise.all(jobs).then(function () { applyLeaderboard(); setupCountUps(); refreshStats(); });

    feed.addEventListener("click", function (e) {
      var vb = e.target.closest(".up-btn[data-vote]");
      if (vb) { onVote(vb); return; }
      var tog = e.target.closest(".up-suggest-toggle");
      if (tog) { toggleSuggest(tog); return; }
    });
    feed.addEventListener("submit", function (e) {
      var form = e.target.closest(".up-suggest-form");
      if (form) { e.preventDefault(); onSuggest(form); }
    });

    setupPointer();
    setupVisibility();
    setTimeout(function () { var t = document.querySelector(".up-title"); if (t) t.classList.add("is-typed"); }, 600);
  }

  /* ---------- Boot ---------- */
  function init() {
    var feed = document.getElementById("upFeed");
    if (!feed) return;
    loadProjects().then(function (list) {
      if (list && list.length) PROJECTS = list;
      BY_SLUG = {};
      PROJECTS.forEach(function (p) { BY_SLUG[p.slug] = p; });
      renderFeed(feed);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
