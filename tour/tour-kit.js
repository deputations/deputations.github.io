/* ============================================================
   tour/tour-kit.js — the toolbox every tour scene draws with.

   DepTourKit.create(ctx) returns a kit bound to the open tour:
   a glowing screen-space cursor with a light trail, taps with
   ripples and sparks, typing, odometer numbers, title splitting,
   camera moves, particle bursts, light sweeps and sample data.

   Every effect returns a GSAP timeline/tween for the scene to add
   to its own timeline. Effects render correctly when the engine
   seeks (no state lives only in callbacks); callbacks are used
   only to clean up DOM once an effect has played.

   Coordinates: elements are resolved to their on-screen centre at
   the moment the tween starts; raw {x, y} / (x, y) numbers are
   viewport (screen) pixels.

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §4.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourKit) return;

  /* ---------- deterministic randomness + dates ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function todayISO() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysToMonthEnd(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    var end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return Math.round((end - d) / 864e5);
  }

  /* ---------- sample data (always shown with the Demo badge) ---------- */
  var MINISTRIES = [
    { m: 'Ministry of Finance', orgs: ['Department of Expenditure', 'Central Board of Direct Taxes', 'Department of Financial Services'] },
    { m: 'Ministry of Home Affairs', orgs: ['Border Security Force', 'National Disaster Management Authority', 'Registrar General of India'] },
    { m: 'Ministry of Railways', orgs: ['Railway Board', 'Research Designs & Standards Organisation', 'Rail Land Development Authority'] },
    { m: 'Ministry of Education', orgs: ['Department of Higher Education', 'NCERT', 'Kendriya Vidyalaya Sangathan'] },
    { m: 'Ministry of Health and Family Welfare', orgs: ['Directorate General of Health Services', 'National Health Authority', 'CDSCO'] },
    { m: 'Ministry of External Affairs', orgs: ['Central Passport Organisation', 'Indian Council for Cultural Relations', 'Sushma Swaraj Institute of Foreign Service'] },
    { m: 'Ministry of Defence', orgs: ['Defence Accounts Department', 'DRDO', 'Border Roads Organisation'] },
    { m: 'Ministry of Road Transport and Highways', orgs: ['National Highways Authority of India', 'NHIDCL', 'Indian Academy of Highway Engineers'] }
  ];
  var POSTS = [
    { t: 'Section Officer', l: [8] },
    { t: 'Assistant Section Officer', l: [7] },
    { t: 'Accounts Officer', l: [8, 9] },
    { t: 'Senior Accountant', l: [6] },
    { t: 'Deputy Director', l: [11, 12] },
    { t: 'Under Secretary', l: [11] },
    { t: 'Assistant Director (OL)', l: [10] }
  ];
  var LOCATIONS = [
    ['Delhi', 'DL'], ['Mumbai', 'MH'], ['Bengaluru', 'KA'], ['Chennai', 'TN'], ['Kolkata', 'WB'],
    ['Hyderabad', 'TS'], ['Lucknow', 'UP'], ['Jaipur', 'RJ'], ['Bhopal', 'MP'], ['Guwahati', 'AS'],
    ['Chandigarh', 'CH'], ['Bhubaneswar', 'OD'], ['Thiruvananthapuram', 'KL'], ['Patna', 'BR'],
    ['Pune', 'MH'], ['Ahmedabad', 'GJ'], ['Dehradun', 'UK'], ['Shimla', 'HP'], ['Ranchi', 'JH'], ['Raipur', 'CG']
  ];
  // Illustrative vacancies per state for the map heat glow (all 36 States/UTs).
  var HEAT = {
    DL: 312, MH: 128, KA: 96, UP: 92, TN: 84, WB: 77, TS: 64, GJ: 58, MP: 45, HR: 44, RJ: 41,
    AP: 39, KL: 38, AS: 36, BR: 35, OD: 33, CH: 31, PB: 29, JK: 26, UK: 24, JH: 22, CG: 19,
    HP: 17, GA: 11, AN: 9, ML: 9, PY: 8, TR: 8, AR: 7, MN: 7, LA: 6, NL: 6, SK: 5,
    'DNH-&-DD': 5, MZ: 4, LD: 3
  };

  var SAMPLE = null;
  function buildSample() {
    var rnd = mulberry32(20261104);
    var pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    var today = todayISO();
    var monthLeft = daysToMonthEnd(today);
    var list = [];
    function make(title, level, minYears, loc, closes) {
      var min = pick(MINISTRIES);
      return { title: title, ministry: min.m, org: pick(min.orgs), location: loc[0], state: loc[1],
               payLevel: level, minYears: minYears, closes: closes };
    }
    var i;
    // Exactly 8 posts open to a Level 7 officer with 4 years at that level.
    for (i = 0; i < 8; i++) {
      list.push(make('Assistant Section Officer', 7, 2 + Math.floor(rnd() * 3), pick(LOCATIONS),
                     addDays(today, 6 + Math.floor(rnd() * 45))));
    }
    // Level 8 posts in Delhi that close this month (the "Just ask" query).
    for (i = 0; i < 4; i++) {
      list.push(make(i % 2 ? 'Accounts Officer' : 'Section Officer', 8, 3 + Math.floor(rnd() * 3),
                     ['Delhi', 'DL'], addDays(today, Math.floor(rnd() * (monthLeft + 1)))));
    }
    // Everything else; any Level 7 post here needs 5+ years, so it stays ineligible.
    while (list.length < 120) {
      var post = pick(POSTS);
      var level = pick(post.l);
      var years = Math.floor(rnd() * 9);
      if (level === 7 && years <= 4) years = 5 + Math.floor(rnd() * 4);
      list.push(make(post.t, level, years, pick(LOCATIONS), addDays(today, 1 + Math.floor(rnd() * 75))));
    }
    for (i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    list.forEach(function (v, k) { v.id = 'DEMO-' + String(k + 1).padStart(3, '0'); });
    return {
      total: 1240,
      eligibleCount: 86,
      query: 'Level 8 posts in Delhi closing this month',
      vacancies: list,
      heat: HEAT
    };
  }
  function sample() {
    if (!SAMPLE || SAMPLE.day !== todayISO()) {
      SAMPLE = buildSample();
      SAMPLE.day = todayISO();
    }
    return SAMPLE;
  }

  /* ---------- the kit ---------- */
  function create(ctx) {
    ctx = ctx || {};
    var layer = ctx.cursorLayer || null;
    var tall = ctx.layout === 'tall';
    var low = !!ctx.lowPower;
    var rnd = mulberry32(7);

    function mk(tag, cls, html, parent) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      if (parent) parent.appendChild(e);
      return e;
    }
    function centre(t) {
      if (t && typeof t.getBoundingClientRect === 'function') {
        var r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return { x: +(t && t.x) || 0, y: +(t && t.y) || 0 };
    }
    function empty() { return gsap.timeline(); }

    /* cursor: one per tour, living in the screen-space cursor layer */
    function cursor() {
      var c = layer.querySelector('.dt-cursor');
      if (!c) {
        var trails = [];
        for (var i = 0; i < 6; i++) trails.push(mk('i', 'dt-trail dt-trail-' + i, null, layer));
        c = mk('div', 'dt-cursor', '<i class="dt-cursor-halo"></i><i class="dt-cursor-dot"></i>', layer);
        gsap.set(trails.concat(c), {
          x: window.innerWidth * 0.74, y: window.innerHeight * 0.8,
          xPercent: -50, yPercent: -50, opacity: 0
        });
      }
      return c;
    }

    function cursorTo(target, opts) {
      if (!layer) return empty();
      opts = opts || {};
      var d = opts.duration != null ? opts.duration : 0.8;
      var ease = opts.ease || 'power3.inOut';
      var c = cursor();
      var trails = layer.querySelectorAll('.dt-trail');
      var dest = null;
      function X() { dest = centre(target); return dest.x; }
      function Y() { return (dest || centre(target)).y; }
      var tl = gsap.timeline();
      tl.to(c, { x: X, y: Y, opacity: 1, duration: d, ease: ease }, 0);
      Array.prototype.forEach.call(trails, function (t, i) {
        tl.fromTo(t, { opacity: 0.6 * (1 - i / 7) },
          { x: function () { return centre(target).x; }, y: function () { return centre(target).y; },
            opacity: 0, duration: d, ease: ease, immediateRender: false }, 0.028 * (i + 1));
      });
      return tl;
    }

    function tap(target) {
      if (!layer) return empty();
      var c = cursor();
      var pt = null;
      function P() { return pt || (pt = centre(target)); }
      var ring = mk('i', 'dt-ripple', null, layer);
      var sparks = [];
      for (var i = 0; i < 8; i++) sparks.push(mk('i', 'dt-tap-spark', null, layer));
      gsap.set([ring].concat(sparks), { xPercent: -50, yPercent: -50, opacity: 0 });
      function cleanup() {
        ring.remove();
        sparks.forEach(function (s) { s.remove(); });
        if (target && target.classList) target.classList.remove('dt-pressed');
      }
      var tl = gsap.timeline({ onComplete: cleanup });
      tl.call(function () { if (target && target.classList) target.classList.add('dt-pressed'); }, null, 0)
        .to(c, { scale: 0.82, duration: 0.12, ease: 'power2.out' }, 0)
        .to(c, { scale: 1, duration: 0.24, ease: 'back.out(3)' }, 0.12)
        .fromTo(ring, { x: function () { return P().x; }, y: function () { return P().y; }, scale: 0, opacity: 0.9 },
          { scale: 2.4, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, 0.05);
      sparks.forEach(function (s, k) {
        var a = (k / sparks.length) * Math.PI * 2 + 0.3;
        var dist = 22 + (k % 3) * 8;
        tl.fromTo(s, { x: function () { return P().x; }, y: function () { return P().y; }, opacity: 1, scale: 1 },
          { x: function () { return P().x + Math.cos(a) * dist; }, y: function () { return P().y + Math.sin(a) * dist; },
            opacity: 0, scale: 0.3, duration: 0.45, ease: 'power3.out', immediateRender: false }, 0.05);
      });
      tl.call(function () { if (target && target.classList) target.classList.remove('dt-pressed'); }, null, 0.36);
      return tl;
    }

    function type(el, text, opts) {
      opts = opts || {};
      text = String(text);
      var cps = opts.cps || 24;
      var caret = mk('span', 'dt-caret');
      var shown = -1;
      function render(n) {
        n = Math.max(0, Math.min(text.length, n));
        if (n === shown) return;
        shown = n;
        el.textContent = text.slice(0, n);
        if (n < text.length) el.appendChild(caret);
      }
      var proxy = {};
      Object.defineProperty(proxy, 'n', {
        get: function () { return Math.max(0, shown); },
        set: function (v) { render(Math.round(v)); }
      });
      render(0);
      return gsap.timeline().to(proxy, { n: text.length, duration: Math.max(0.2, text.length / cps), ease: 'none' });
    }

    function odometer(el, from, to, opts) {
      opts = opts || {};
      el.setAttribute('aria-label', String(to));
      el.classList.add('dt-odo');
      var val = from;
      function plain(x) { el.classList.remove('dt-odo-rolling'); el.textContent = Math.round(x).toLocaleString('en-IN'); }
      function draw(x) {
        if (Math.abs(x - from) < 1e-6 || Math.abs(x - to) < 1e-6) return plain(x);
        el.classList.add('dt-odo-rolling');
        var whole = Math.floor(Math.abs(x));
        var frac = Math.abs(x) - whole;
        var chars = whole.toLocaleString('en-IN').split('');
        var html = [];
        var place = 0;
        for (var i = chars.length - 1; i >= 0; i--) {
          var ch = chars[i];
          if (!/\d/.test(ch)) { html.unshift('<span class="dt-odo-sep">' + ch + '</span>'); continue; }
          var d = +ch;
          var lower = whole % Math.pow(10, place);
          var rolling = place === 0 || lower === Math.pow(10, place) - 1;
          var p = rolling ? frac : 0;
          html.unshift('<span class="dt-odo-slot"><span class="dt-odo-strip" style="transform:translateY(' +
            (-p * 50).toFixed(2) + '%)"><b>' + d + '</b><b>' + ((d + 1) % 10) + '</b></span></span>');
          place++;
        }
        el.innerHTML = html.join('');
      }
      var proxy = {};
      Object.defineProperty(proxy, 'v', {
        get: function () { return val; },
        set: function (x) { val = x; draw(x); }
      });
      plain(from);
      return gsap.timeline().to(proxy, { v: to, duration: opts.duration || 1.6, ease: opts.ease || 'power2.inOut' });
    }

    function splitTitle(el) {
      var text = el.textContent;
      var chars = [];
      el.textContent = '';
      text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); return; }
        var w = mk('span', 'dt-word', null, el);
        Array.from(part).forEach(function (ch) {
          var c = mk('span', 'dt-ch', null, w);
          c.textContent = ch;
          chars.push(c);
        });
      });
      return chars;
    }

    function camera(pose, opts) {
      pose = pose || {};
      opts = opts || {};
      var clamp = function (v) { return Math.max(-12, Math.min(12, v)); };
      var vars = { duration: opts.duration != null ? opts.duration : 1.2, ease: opts.ease || 'power2.inOut' };
      if (pose.x != null) vars.x = pose.x;
      if (pose.y != null) vars.y = pose.y;
      if (pose.z != null) vars.scale = pose.z;
      if (pose.rx != null) vars.rotationX = clamp(pose.rx);
      if (pose.ry != null) vars.rotationY = clamp(pose.ry);
      return gsap.to(ctx.camera, vars);
    }

    function burst(x, y, opts) {
      if (!layer) return empty();
      if (y && typeof y === 'object') { opts = y; y = undefined; }
      opts = opts || {};
      var target = x && typeof x.getBoundingClientRect === 'function' ? x : null;
      var pt = target ? null : { x: +x || 0, y: +y || 0 };
      function P() { return pt || (pt = centre(target)); }
      var n = opts.count || 28;
      if (low || tall) n = Math.round(n / 2);
      var reach = tall ? 0.6 : 1;
      var sparks = [];
      var tl = gsap.timeline({ onComplete: function () { sparks.forEach(function (s) { s.remove(); }); } });
      for (var i = 0; i < n; i++) {
        var s = mk('i', 'dt-spark dt-spark-' + (i % 3), null, layer);
        sparks.push(s);
        var a = rnd() * Math.PI * 2;
        var dist = (70 + rnd() * 150) * reach;
        var size = 3 + rnd() * 5;
        gsap.set(s, { xPercent: -50, yPercent: -50, opacity: 0, width: size, height: size });
        (function (a, dist) {
          tl.fromTo(s, { x: function () { return P().x; }, y: function () { return P().y; }, opacity: 1, scale: 1 },
            { x: function () { return P().x + Math.cos(a) * dist; },
              y: function () { return P().y + Math.sin(a) * dist + 26; },
              opacity: 0, scale: 0.2, duration: 0.9 + rnd() * 0.5, ease: 'power3.out', immediateRender: false },
            rnd() * 0.08);
        })(a, dist);
      }
      return tl;
    }

    function sweep(el) {
      var cs = window.getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
      if (cs.overflow === 'visible') el.style.overflow = 'hidden';
      var s = mk('i', 'dt-sweep', null, el);
      gsap.set(s, { xPercent: -160, opacity: 0 });
      return gsap.timeline({ onComplete: function () { s.remove(); } })
        .to(s, { xPercent: 360, duration: 0.9, ease: 'power2.inOut' }, 0)
        .to(s, { opacity: 1, duration: 0.2, ease: 'none' }, 0)
        .to(s, { opacity: 0, duration: 0.25, ease: 'none' }, 0.65);
    }

    return {
      layout: ctx.layout || 'wide',
      lowPower: low,
      width: ctx.width || (tall ? 390 : 1100),
      height: ctx.height || (tall ? 720 : 620),
      el: mk,
      centre: centre,
      cursorTo: cursorTo,
      tap: tap,
      type: type,
      odometer: odometer,
      splitTitle: splitTitle,
      camera: camera,
      burst: burst,
      sweep: sweep,
      get sample() { return sample(); }
    };
  }

  window.DepTourKit = { create: create };
})();
