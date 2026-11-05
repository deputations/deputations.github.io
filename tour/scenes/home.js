/* ============================================================
   tour/scenes/home.js — the Home page tour (index.html): intro,
   steps 1–3 and the registration of the whole tour.

   Intro: "Your one stop solution to Deputation", then the brand.
   Step 1 "Only the posts you can apply for": card wall; Level 7 +
   4 years; ineligible cards fall away (feeder-grade rule).
   Step 2 "Narrow it down": ministry / organisation / location
   filters and the quick chips.
   Step 3 "Just ask": the AI search ("Understood" tags, matches).
   Steps 4–7 come from home-more.js, step 8 from pages.js.

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3.1
   ============================================================ */
(function () {
  'use strict';
  if (!window.DepTour) return;
  DepTour.expect('home');

  var HEADLINE = 'Your one stop solution to Deputation';
  var BRAND = 'ALL Deputations.com';
  var LEVEL = 7, YEARS = 4;

  function shortMinistry(m) { return String(m).replace(/^Ministry of /, ''); }
  // "Open to L-7 · 3 yrs" — the feeder grade that matters to this officer, else the first one
  function openToText(v) {
    var t = (v.openTo || []).filter(function (x) { return x.level === LEVEL; })[0] || (v.openTo || [])[0];
    if (!t) return '';
    return 'Open to L-' + t.level + (t.years ? ' \u00B7 ' + t.years + ' yrs' : '');
  }
  function daysLeft(iso) {
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return Math.max(0, Math.round((Date.parse(iso) - Date.parse(today)) / 864e5));
  }
  function shortDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // Centre of `el` in scene-local (canvas) units. Valid while the camera is level.
  function localCentre(el, scene, kit) {
    var r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
    var k = s.width / kit.width || 1;
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
  }

  /* ---------------------------------------------------------------
     Scene 1 — eligibility
     --------------------------------------------------------------- */
  var eligibility = {
    key: 'eligibility',
    label: 'STEP 1',
    title: 'Only the posts you can apply for',
    summary: 'Set your pay level and years of experience to see only the posts you can apply for.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var s = kit.sample;
      var L = tall
        ? { panel: [10, 0, 370, 206], chip: [10, 216], wall: [15, 262, 360, 450], cols: 4, n: 48, keep: 5, card: [340, 80] }
        : { panel: [24, 64, 300, 392], chip: [356, 0], wall: [350, 54, 730, 556], cols: 8, n: kit.lowPower ? 72 : 120, keep: 8, card: [322, 92] };

      // pick the cards: survivors first so they are always present, then fill in
      var eligible = s.vacancies.filter(function (v) { return s.isEligible(v, LEVEL, YEARS); }).slice(0, L.keep);
      var others = s.vacancies.filter(function (v) { return !s.isEligible(v, LEVEL, YEARS); });
      var chosen = s.vacancies.filter(function (v) {
        return eligible.indexOf(v) >= 0 || others.indexOf(v) >= 0 && others.indexOf(v) < L.n - eligible.length;
      });

      /* filter panel */
      var panel = kit.el('div', 'dt-panel' + (tall ? ' is-compact' : ''), null, stage);
      Object.assign(panel.style, { left: L.panel[0] + 'px', top: L.panel[1] + 'px', width: L.panel[2] + 'px', height: L.panel[3] + 'px' });
      panel.innerHTML =
        '<div class="dt-panel-h"><span>Display deputations for me</span>' +
          '<span class="dt-switch"><i class="dt-switch-on"></i><i class="dt-switch-knob"></i></span></div>' +
        '<div class="dt-fields">' +
          '<div class="dt-field"><span class="dt-field-l">Your Pay Level</span>' +
            '<div class="dt-select"><span class="dt-select-v is-empty">Select level</span>' +
            '<span class="dt-select-v is-set">Level ' + LEVEL + '</span><i class="dt-chev"></i></div></div>' +
          '<div class="dt-field"><span class="dt-field-l">Years at this level</span>' +
            '<div class="dt-select dt-years"><span class="dt-select-v is-empty">Select years</span>' +
            '<span class="dt-select-v is-set">' + YEARS + ' years</span><i class="dt-chev"></i></div></div>' +
        '</div>' +
        '<ul class="dt-options">' + [5, 6, 7, 8, 9].map(function (l) {
          return '<li' + (l === LEVEL ? ' class="is-pick"' : '') + '>Level ' + l + '</li>';
        }).join('') + '</ul>' +
        '<div class="dt-panel-note"><i></i>Matching posts you’re eligible for</div>';
      var sw = panel.querySelector('.dt-switch');
      var select = panel.querySelector('.dt-select');
      var options = panel.querySelector('.dt-options');
      var pick = panel.querySelector('.dt-options .is-pick');
      var years = panel.querySelector('.dt-years');
      var note = panel.querySelector('.dt-panel-note');

      /* counter */
      var chip = kit.el('div', 'dt-count-chip', null, stage);
      Object.assign(chip.style, { left: L.chip[0] + 'px', top: L.chip[1] + 'px' });
      chip.innerHTML = '<b class="dt-count"></b><span class="dt-count-k">vacancies</span>' +
        '<span class="dt-count-sub"><span class="is-all">in this sample</span><span class="is-you">you can apply for</span></span>';
      var count = chip.querySelector('.dt-count');
      count.textContent = s.total.toLocaleString('en-IN');

      /* the wall */
      var wall = kit.el('div', 'dt-wall' + (tall ? ' is-tall' : ''), null, stage);
      Object.assign(wall.style, { left: L.wall[0] + 'px', top: L.wall[1] + 'px', width: L.wall[2] + 'px', height: L.wall[3] + 'px' });
      var cols = L.cols, rows = Math.ceil(chosen.length / cols);
      var cw = L.wall[2] / cols, ch = L.wall[3] / rows;
      var CW = L.card[0], CH = L.card[1];
      var mini = Math.min((cw - 8) / CW, (ch - 6) / CH);
      var cards = chosen.map(function (v, i) {
        var ok = eligible.indexOf(v) >= 0;
        var c = kit.el('div', 'dt-vcard lvl-' + v.payLevel + (ok ? ' is-eligible' : ''), null, wall);
        c.style.width = CW + 'px';
        c.style.height = CH + 'px';
        c.innerHTML = '<i class="dt-vcard-bar"></i><i class="dt-vcard-glow"></i>' +
          '<div class="dt-vcard-main"><b>' + esc(v.title) + '</b><span>' + esc(v.org) + ' · ' + esc(v.location) + '</span></div>' +
          '<div class="dt-vcard-meta"><span class="dt-lvl">Level ' + v.payLevel + '</span><span class="dt-open">' + openToText(v) +
          '</span><span class="dt-days">' + daysLeft(v.closes) + 'd left</span></div>';
        var col = i % cols, row = Math.floor(i / cols);
        gsap.set(c, { x: col * cw + (cw - CW * mini) / 2, y: row * ch + (ch - CH * mini) / 2,
                      scale: mini, transformOrigin: '0 0', opacity: 0 });
        return c;
      });
      var keep = cards.filter(function (c) { return c.classList.contains('is-eligible'); });
      var drop = cards.filter(function (c) { return !c.classList.contains('is-eligible'); });

      // where the survivors land
      var gap = tall ? 10 : 14, lcols = tall ? 1 : 2;
      var listW = lcols * CW + (lcols - 1) * gap;
      var listRows = Math.ceil(keep.length / lcols);
      var listH = listRows * CH + (listRows - 1) * gap;
      var x0 = (L.wall[2] - listW) / 2, y0 = Math.max(0, (L.wall[3] - listH) / 2 - (tall ? 0 : 24));

      var tl = gsap.timeline();
      tl.fromTo(panel, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .fromTo(chip, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.25)
        .fromTo(wall, { rotationY: tall ? 0 : -16, rotationX: tall ? 16 : 9, z: -40 },
          { rotationY: tall ? 0 : -14, rotationX: tall ? 14 : 8, z: 0, duration: 1.6, ease: 'power2.out' }, 0)
        .fromTo(cards, { opacity: 0, z: -220 },
          { opacity: 1, z: 0, duration: 0.6, ease: 'power3.out',
            stagger: { grid: [rows, cols], from: 'center', amount: 1.0 } }, 0.1);

      // 1. switch on
      tl.add(kit.cursorTo(sw, { duration: 0.8 }), 1.4)
        .add(kit.tap(sw), 2.2)
        .to(sw.querySelector('.dt-switch-on'), { opacity: 1, duration: 0.25 }, 2.3)
        .to(sw.querySelector('.dt-switch-knob'), { x: 16, duration: 0.3, ease: 'back.out(2)' }, 2.3);
      // 2. pick Level 7
      tl.add(kit.cursorTo(select, { duration: 0.6 }), 2.7)
        .add(kit.tap(select), 3.35)
        .fromTo(options, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 3.45)
        .fromTo(options.children, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.25, stagger: 0.05 }, 3.5)
        .add(kit.cursorTo(pick, { duration: 0.45 }), 3.9)
        .add(kit.tap(pick), 4.4)
        .to(select.querySelector('.is-empty'), { opacity: 0, y: -8, duration: 0.25 }, 4.55)
        .fromTo(select.querySelector('.is-set'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 }, 4.6)
        .to(options, { opacity: 0, y: -6, duration: 0.25 }, 4.65);
      // 3. years at that level
      tl.add(kit.cursorTo(years, { duration: 0.5 }), 4.9)
        .add(kit.tap(years), 5.45)
        .to(years.querySelector('.is-empty'), { opacity: 0, y: -8, duration: 0.25 }, 5.55)
        .fromTo(years.querySelector('.is-set'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 }, 5.6)
        .fromTo(note, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 5.95)
        .add(kit.sweep(note), 6.0);

      // 4. the filter hits the wall
      var cursorBits = Array.prototype.slice.call(document.querySelectorAll('.dt-cursor, .dt-trail'));
      if (cursorBits.length) tl.to(cursorBits, { opacity: 0, duration: 0.4 }, 6.3);
      tl.add(kit.camera({ z: 1.03, ry: 3 }, { duration: 1.4, ease: 'power2.inOut' }), 6.2)
        .to(drop, Object.assign({ rotationY: 90, z: -360, y: '+=70', opacity: 0, duration: 0.9, ease: 'power2.in',
          stagger: { amount: 1.3, from: 'random' } }, kit.lowPower || tall ? {} : { filter: 'blur(6px)' }), 6.4)
        .add(kit.odometer(count, s.total, s.eligibleCount, { duration: 1.9 }), 6.5)
        .to(chip.querySelector('.is-all'), { opacity: 0, y: -8, duration: 0.3 }, 7.2)
        .fromTo(chip.querySelector('.is-you'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35 }, 7.3)
        .add(kit.sweep(chip), 8.3);

      // 5. survivors fly into a readable list and the wall straightens
      tl.to(wall, { rotationY: 0, rotationX: 0, duration: 1.2, ease: 'power3.inOut' }, 7.9)
        .add(kit.camera({ z: 1, ry: 0 }, { duration: 1.2, ease: 'power3.inOut' }), 7.9);
      keep.forEach(function (c, i) {
        var col = i % lcols, row = Math.floor(i / lcols);
        tl.to(c, { x: x0 + col * (CW + gap), y: y0 + row * (CH + gap), scale: 1, z: 0,
                   duration: 1.0, ease: 'power3.inOut' }, 7.9 + i * 0.07)
          .to(c.querySelector('.dt-vcard-glow'), { opacity: 1, duration: 0.5 }, 8.6 + i * 0.07)
          .add(kit.sweep(c), 9.0 + i * 0.08);
      });
      tl.to({}, { duration: 1.4 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Scene 2 — narrow it down (the other filters + quick chips)
     --------------------------------------------------------------- */
  // Sample rows; `out` = which pick removes the row (0 = stays to the end).
  var FROWS = [
    { t: 'Section Officer', m: 'Finance', loc: 'Delhi', d: 5, out: 0 },
    { t: 'Under Secretary', m: 'Education', loc: 'Delhi', d: 12, out: 1 },
    { t: 'Accounts Officer', m: 'Railways', loc: 'Delhi', d: 3, out: 0 },
    { t: 'Senior Accountant', m: 'Railways', loc: 'Kolkata', d: 4, out: 2 },
    { t: 'Deputy Director', m: 'Health', loc: 'Mumbai', d: 9, out: 1 },
    { t: 'Assistant Section Officer', m: 'Finance', loc: 'Delhi', d: 6, out: 0 },
    { t: 'Accounts Officer', m: 'Railways', loc: 'Delhi', d: 18, out: 3 },
    { t: 'Section Officer', m: 'Finance', loc: 'Chennai', d: 21, out: 2 }
  ];
  var MINISTRY_OPTS = ['Finance', 'Railways', 'Home Affairs', 'Education', 'Defence'];
  var QCHIPS = ['New', 'Closing in 7 days', 'Delhi/NCR', 'Closing today'];
  var COUNTS = [1240, 214, 46, 12];

  var filters = {
    key: 'filters',
    label: 'STEP 2',
    title: 'Narrow it down',
    summary: 'Pick ministries, organisations and locations, or tap a quick chip like Delhi/NCR or Closing in 7 days.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var L = tall
        ? { bar: [10, 0, 370], rows: [10, 182, 370], rowH: 52, cnt: [10, 136] }
        : { bar: [110, 20, 880], rows: [110, 210, 880], rowH: 46, cnt: [110, 156] };

      var bar = kit.el('div', 'dt-fbar' + (tall ? ' is-tall' : ''), null, stage);
      Object.assign(bar.style, { left: L.bar[0] + 'px', top: L.bar[1] + 'px', width: L.bar[2] + 'px' });
      var pills = kit.el('div', 'dt-fpills', null, bar);
      var pill = ['Ministry', 'Organisation', 'Location'].map(function (n, i) {
        var p = kit.el('span', 'dt-fpill', null, pills);
        p.innerHTML = '<span class="dt-fpill-t">' + n + '</span>' +
          (i === 0 ? '<span class="dt-fpill-n"> · 2</span>' : '') + '<i class="dt-fchev" aria-hidden="true"></i>';
        return p;
      });
      var chipsRow = kit.el('div', 'dt-qchips', null, bar);
      var qchip = QCHIPS.map(function (n) { var c = kit.el('span', 'dt-qchip', null, chipsRow); c.textContent = n; return c; });
      var menu = kit.el('ul', 'dt-fmenu', null, bar);
      var opts = MINISTRY_OPTS.map(function (n) {
        var li = kit.el('li', null, '<i class="dt-check"></i>' + n, menu);
        return li;
      });

      var cw = kit.el('div', 'dt-fcount-wrap', null, stage);
      Object.assign(cw.style, { left: L.cnt[0] + 'px', top: L.cnt[1] + 'px' });
      cw.innerHTML = '<b class="dt-fcount"></b><span class="dt-fcount-k">sample posts match</span>';
      var count = cw.querySelector('.dt-fcount');
      count.textContent = COUNTS[0].toLocaleString('en-IN');

      var list = kit.el('div', 'dt-flist', null, stage);
      Object.assign(list.style, { left: L.rows[0] + 'px', top: L.rows[1] + 'px', width: L.rows[2] + 'px',
                                  height: (FROWS.length * L.rowH) + 'px' });
      var rows = FROWS.map(function (r, i) {
        var el = kit.el('div', 'dt-frow', null, list);
        el.innerHTML = '<b>' + esc(r.t) + '</b><span>' + esc(r.m) + '</span><span>' + esc(r.loc) +
          '</span><span class="dt-days">' + r.d + 'd left</span>';
        gsap.set(el, { y: i * L.rowH, height: L.rowH - 8 });
        return el;
      });

      var tl = gsap.timeline();
      tl.fromTo(bar, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .fromTo(cw, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.3)
        .fromTo(rows, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power2.out', stagger: 0.05 }, 0.2);

      // after pick k, rows with out === k leave and the rest close ranks
      function settle(k, at) {
        var leaving = rows.filter(function (_, i) { return FROWS[i].out === k; });
        tl.to(leaving, { opacity: 0, x: -40, duration: 0.45, ease: 'power2.in', stagger: 0.05 }, at);
        var y = 0;
        rows.forEach(function (el, i) {
          var o = FROWS[i].out;
          if (o === 0 || o > k) { tl.to(el, { y: y, duration: 0.55, ease: 'power3.inOut' }, at + 0.35); y += L.rowH; }
        });
        tl.add(kit.odometer(count, COUNTS[k - 1], COUNTS[k], { duration: 0.9 }), at);
      }

      // 1. Ministry: tick two
      tl.add(kit.cursorTo(pill[0], { duration: 0.7 }), 0.8)
        .add(kit.tap(pill[0]), 1.5)
        .fromTo(menu, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 1.6)
        .add(kit.cursorTo(opts[0], { duration: 0.4 }), 1.85)
        .add(kit.tap(opts[0]), 2.25)
        .to(opts[0].querySelector('.dt-check'), { '--dt-on': 1, duration: 0.2 }, 2.3)
        .add(kit.cursorTo(opts[1], { duration: 0.35 }), 2.45)
        .add(kit.tap(opts[1]), 2.8)
        .to(opts[1].querySelector('.dt-check'), { '--dt-on': 1, duration: 0.2 }, 2.85)
        .to(menu, { opacity: 0, y: -6, duration: 0.25 }, 3.15)
        .to(pill[0].querySelector('.dt-fpill-n'), { opacity: 1, maxWidth: '3em', duration: 0.3 }, 3.15)
        .set(pill[0], { attr: { class: 'dt-fpill is-on' } }, 3.15);
      settle(1, 3.2);
      // 2. Delhi/NCR, 3. Closing in 7 days
      [[2, 2, 4.0], [1, 3, 5.4]].forEach(function (step) {
        var c = qchip[step[0]], at = step[2];
        tl.add(kit.cursorTo(c, { duration: 0.6 }), at - 0.7)
          .add(kit.tap(c), at - 0.05)
          .set(c, { attr: { class: 'dt-qchip is-on' } }, at)
          .add(kit.sweep(c), at + 0.05);
        settle(step[1], at + 0.1);
      });
      tl.add(kit.sweep(cw), 6.8).to({}, { duration: 1.0 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Scene 3 — just ask
     --------------------------------------------------------------- */
  var CHIPS = ['Level 8', 'Delhi', 'Closes ≤ 30 days'];
  var SCORES = [96, 91, 87];

  var ask = {
    key: 'ask',
    label: 'STEP 3',
    title: 'Just ask',
    summary: 'Type what you want in plain words — AI understands it and ranks the best matches.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var s = kit.sample;
      var q = s.query;
      var month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
      var matches = s.vacancies.filter(function (v) {
        return v.location === 'Delhi' && v.payLevel === 8 && v.closes.slice(0, 7) === month;
      }).sort(function (a, b) { return a.closes < b.closes ? -1 : 1; }).slice(0, 3);
      var L = tall
        ? { box: [10, 6, 370, 84], chips: [10, 104, 370], label: [10, 196], list: [10, 228, 370] }
        : { box: [110, 132, 880, 70], chips: [110, 226, 880], label: [110, 300], list: [110, 336, 880] };

      var box = kit.el('div', 'dt-ask' + (tall ? ' is-tall' : ''), null, stage);
      Object.assign(box.style, { left: L.box[0] + 'px', top: L.box[1] + 'px', width: L.box[2] + 'px', height: L.box[3] + 'px' });
      box.innerHTML = '<span class="dt-ask-ico" aria-hidden="true">✨</span>' +
        '<div class="dt-ask-field"><span class="dt-ask-text"></span><span class="dt-ask-marked">' +
          q.replace('Level 8', '<mark class="dt-m">Level 8</mark>').replace('Delhi', '<mark class="dt-m">Delhi</mark>')
           .replace('this month', '<mark class="dt-m">this month</mark>') +
        '</span></div><span class="dt-ask-hint">AI-powered</span>';
      var text = box.querySelector('.dt-ask-text');
      var marked = box.querySelector('.dt-ask-marked');
      var marks = Array.prototype.slice.call(marked.querySelectorAll('.dt-m'));

      var row = kit.el('div', 'dt-ask-chips', null, stage);
      Object.assign(row.style, { left: L.chips[0] + 'px', top: L.chips[1] + 'px', width: L.chips[2] + 'px' });
      var understood = kit.el('span', 'dt-ask-understood', 'Understood', row);
      var chips = CHIPS.map(function (label) {
        var c = kit.el('span', 'dt-chip', null, row);
        c.innerHTML = '<i class="dt-chip-ico" aria-hidden="true"></i>';
        c.appendChild(document.createTextNode(label));
        return c;
      });

      var label = kit.el('div', 'dt-ask-label', '<i aria-hidden="true"></i>AI-ranked matches', stage);
      Object.assign(label.style, { left: L.label[0] + 'px', top: L.label[1] + 'px' });

      var list = kit.el('div', 'dt-matches' + (tall ? ' is-tall' : ''), null, stage);
      Object.assign(list.style, { left: L.list[0] + 'px', top: L.list[1] + 'px', width: L.list[2] + 'px' });
      var C = 2 * Math.PI * 18;
      var cards = matches.map(function (v, i) {
        var m = kit.el('div', 'dt-match', null, list);
        m.innerHTML =
          '<div class="dt-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="dt-ring-bg" cx="22" cy="22" r="18"/>' +
            '<circle class="dt-ring-fg" cx="22" cy="22" r="18" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"/></svg>' +
            '<span class="dt-ring-n"><b class="dt-ring-v">0</b>%</span></div>' +
          '<div class="dt-match-main"><b>' + esc(v.title) + '</b><span>' + esc(v.org) + '</span><span class="dt-match-min">' + esc(shortMinistry(v.ministry)) + '</span></div>' +
          '<div class="dt-match-meta"><span class="dt-lvl">Level 8</span><span>Delhi</span><span class="dt-days">Closes ' + shortDate(v.closes) + '</span></div>';
        return m;
      });

      // particles that carry each phrase into its chip
      var fly = kit.el('div', 'dt-ask-fly', null, stage);
      var PER = kit.lowPower || tall ? 6 : 10;
      var sparks = [];
      marks.forEach(function (mk, mi) {
        for (var k = 0; k < PER; k++) {
          var p = kit.el('i', 'dt-fly dt-fly-' + mi, null, fly);
          sparks.push({ el: p, from: mk, to: chips[mi], k: k });
        }
      });
      gsap.set(sparks.map(function (o) { return o.el; }), { opacity: 0, xPercent: -50, yPercent: -50 });

      var tl = gsap.timeline();
      tl.fromTo(box, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'power3.out' }, 0)
        .add(kit.cursorTo(box, { duration: 0.7 }), 0.45)
        .add(kit.tap(box), 1.15)
        .add(kit.type(text, q, { cps: 22 }), 1.25);
      var typed = 1.25 + q.length / 22;
      tl.to(text, { opacity: 0, duration: 0.3 }, typed + 0.2)
        .fromTo(marked, { opacity: 0 }, { opacity: 1, duration: 0.3 }, typed + 0.2)
        .fromTo(marks, { '--dt-m': 0 }, { '--dt-m': 1, duration: 0.4, stagger: 0.12 }, typed + 0.3);
      var flyAt = typed + 0.75;
      sparks.forEach(function (o, i) {
        var a = null, b = null;
        function A() { return a || (a = localCentre(o.from, stage, kit)); }
        function B() { return b || (b = localCentre(o.to, stage, kit)); }
        var jitter = (o.k - PER / 2) * 3;
        tl.fromTo(o.el, { x: function () { return A().x + jitter; }, y: function () { return A().y; }, opacity: 1, scale: 1 },
          { x: function () { return B().x + jitter * 0.3; }, y: function () { return B().y; }, opacity: 0.2, scale: 0.4,
            duration: 0.7, ease: 'power2.inOut', immediateRender: false }, flyAt + (i % PER) * 0.025 + Math.floor(i / PER) * 0.12);
      });
      tl.to(sparks.map(function (o) { return o.el; }), { opacity: 0, duration: 0.2 }, flyAt + 1.2);
      tl.fromTo(understood, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' }, flyAt + 0.4)
        .fromTo(chips, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.12 }, flyAt + 0.55)
        .fromTo(label, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, flyAt + 1.1)
        .add(kit.sweep(label), flyAt + 1.2);
      var listAt = flyAt + 1.4;
      cards.forEach(function (m, i) {
        var t = listAt + i * 0.18;
        tl.fromTo(m, { opacity: 0, x: tall ? 0 : 50, y: tall ? 30 : 0 }, { opacity: 1, x: 0, y: 0, duration: 0.7, ease: 'power3.out' }, t)
          .to(m.querySelector('.dt-ring-fg'), { strokeDashoffset: C * (1 - SCORES[i] / 100), duration: 1.2, ease: 'power2.out' }, t + 0.3)
          .add(kit.odometer(m.querySelector('.dt-ring-v'), 0, SCORES[i], { duration: 1.2, ease: 'power2.out' }), t + 0.3);
      });
      tl.add(kit.cursorTo(cards[0], { duration: 0.7 }), listAt + 1.7)
        .add(kit.tap(cards[0]), listAt + 2.4)
        .add(kit.sweep(cards[0]), listAt + 2.5)
        .to({}, { duration: 1.2 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Hand-off: open the real "Display deputations for me" control
     --------------------------------------------------------------- */
  function openPayLevel() {
    var btn = document.getElementById('filterMyPayLevelBtn');
    if (!btn) return;
    var sidebar = document.getElementById('filtersSidebar');
    if (sidebar && sidebar.classList.contains('collapsed') && window.innerWidth <= 768) {
      var toggle = sidebar.querySelector('.mobile-filter-toggle');
      if (toggle) toggle.click();
    }
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    try { btn.focus({ preventScroll: true }); } catch (e) {}
  }

  function register() {
    DepTour.register('home', {
      intro: { headline: HEADLINE, brand: BRAND },
      scenes: [eligibility, filters, ask]
        .concat(window.DepTourHomeMore && window.DepTourHomeMore.scenes || [])
        .concat(window.DepTourPages && window.DepTourPages.montageScene ? [window.DepTourPages.montageScene] : []),
      cta: { label: 'Try it with your pay level', action: openPayLevel, keepScene: true }
    });
  }

  // The map data only draws the montage's mini map, which copes without it:
  // register either way so a failed fetch never costs the whole Home tour.
  if (window.DepTourMap) {
    window.DepTourMap.load().then(register, function (err) {
      try { console.warn('[tour] map data unavailable:', err && err.message); } catch (e) {}
      register();
    });
  } else {
    register();
  }
})();
