/* ============================================================
   tour/scenes/home-more.js — Home steps 4–7.

   4 "Sort and switch views": the Days-left header sorts the rows,
     then the view toggle morphs each row into a card.
   5 "Save posts you like": the heart fills, a heart arcs up to the
     header bookmark and its badge ticks 0 -> 1.
   6 "Never miss a vacancy": the bell turns alerts on and a push
     alert drops onto a phone.
   7 "Light or dark — your choice": a circular wipe from the theme
     toggle reveals the light theme, then wipes back.

   Registered by tour/scenes/home.js via window.DepTourHomeMore.
   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourHomeMore) return;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function icon(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON = {
    bell: icon('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    bookmark: icon('<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    moon: icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
    sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    heart: icon('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
    table: icon('<path d="M3 5h18M3 12h18M3 19h18"/>'),
    cards: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
                '<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>')
  };
  function todayLong() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date()).replace(',', '');
  }
  // Centre of `el` in scene units (valid while the camera is level).
  function localCentre(el, scene, kit) {
    var r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
    var k = s.width / kit.width || 1;
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
  }
  function place(el, x, y, w, h) {
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (w != null) el.style.width = w + 'px';
    if (h != null) el.style.height = h + 'px';
  }
  // The site's header, in miniature: logo, alerts bell, bookmarks (with badge), theme.
  function miniHeader(kit, parent, x, y, w) {
    var hd = kit.el('div', 'dt-mhead', null, parent);
    place(hd, x, y, w);
    hd.innerHTML = '<span class="dt-mlogo"><b>ALL</b> Deputations</span><span class="dt-micons">' +
      '<span class="dt-mi dt-bell">' + ICON.bell + '</span>' +
      '<span class="dt-mi dt-bmark">' + ICON.bookmark + '<b class="dt-badge-count">0</b></span>' +
      '<span class="dt-mi dt-themebtn">' + ICON.moon + '</span></span>';
    return { el: hd, bell: hd.querySelector('.dt-bell'), bmark: hd.querySelector('.dt-bmark'),
             badge: hd.querySelector('.dt-badge-count'), theme: hd.querySelector('.dt-themebtn') };
  }

  var ROWS = [
    { t: 'Section Officer', o: 'Department of Expenditure', m: 'Finance', loc: 'Delhi', l: 8, d: 18 },
    { t: 'Accounts Officer', o: 'Railway Board', m: 'Railways', loc: 'Delhi', l: 8, d: 5 },
    { t: 'Deputy Director', o: 'National Health Authority', m: 'Health', loc: 'Delhi', l: 11, d: 27 },
    { t: 'Assistant Section Officer', o: 'Central Passport Organisation', m: 'External Affairs', loc: 'Mumbai', l: 7, d: 3 },
    { t: 'Under Secretary', o: 'Dept. of Higher Education', m: 'Education', loc: 'Delhi', l: 11, d: 12 },
    { t: 'Senior Accountant', o: 'Defence Accounts Department', m: 'Defence', loc: 'Pune', l: 6, d: 9 }
  ];

  /* ---------------------------------------------------------------
     Step 4 — sort and switch views
     --------------------------------------------------------------- */
  var views = {
    key: 'views',
    label: 'STEP 4',
    title: 'Sort and switch views',
    summary: 'Click a column header to sort the table, and switch between the table and card views.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var L = tall
        ? { x: 10, y: 40, w: 370, rowH: 54, gap: 6, cols: 2, cardH: 160, cg: 12 }
        : { x: 110, y: 50, w: 880, rowH: 50, gap: 6, cols: 3, cardH: 150, cg: 20 };
      var TOOLS = 52, HEAD = 42;
      var tb = kit.el('div', 'dt-table' + (tall ? ' is-tall' : ''), null, stage);
      place(tb, L.x, L.y, L.w, 520);

      var tools = kit.el('div', 'dt-ttools', '<span class="dt-ttools-k"><b>6</b> of 86 sample posts</span>', tb);
      var tog = kit.el('div', 'dt-vtoggle', '<span class="dt-vt is-on">' + ICON.table + '</span><span class="dt-vt">' +
        ICON.cards + '</span>', tools);
      var vtTable = tog.children[0], vtCards = tog.children[1];

      var head = kit.el('div', 'dt-thead', null, tb);
      head.style.top = TOOLS + 'px';
      var cols = tall ? ['Post', 'Days left'] : ['Post', 'Level', 'Ministry', 'Location', 'Days left'];
      var ths = cols.map(function (c) {
        var th = kit.el('span', 'dt-th', null, head);
        th.innerHTML = c + (c === 'Days left' ? ' <i class="dt-sort" aria-hidden="true">↕</i>' : '');
        return th;
      });
      var dayTh = ths[ths.length - 1];

      var top0 = TOOLS + HEAD + 8, pitch = L.rowH + L.gap;
      var rows = ROWS.map(function (r, i) {
        var el = kit.el('div', 'dt-trow', null, tb);
        el.dataset.days = r.d;
        el.innerHTML =
          '<div class="dt-trow-line"><b>' + esc(r.t) + '</b>' +
            (tall ? '' : '<span>Level ' + r.l + '</span><span>' + esc(r.m) + '</span><span>' + esc(r.loc) + '</span>') +
            '<span class="dt-days">' + r.d + 'd left</span></div>' +
          '<div class="dt-trow-card"><b>' + esc(r.t) + '</b><span>' + esc(r.o) + '</span>' +
            '<span class="dt-trow-chips"><i>Level ' + r.l + '</i><i>' + esc(r.loc) + '</i><i class="dt-days">' + r.d + 'd left</i></span></div>';
        gsap.set(el, { x: 0, y: top0 + i * pitch, width: L.w, height: L.rowH });
        return el;
      });
      var order = ROWS.map(function (r, i) { return i; }).sort(function (a, b) { return ROWS[a].d - ROWS[b].d; });
      var cw = (L.w - (L.cols - 1) * L.cg) / L.cols;

      var tl = gsap.timeline();
      tl.fromTo(tb, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .fromTo(rows, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.05 }, 0.2);

      // sort by days left
      tl.add(kit.cursorTo(dayTh, { duration: 0.7 }), 0.8)
        .add(kit.tap(dayTh), 1.5)
        .set(dayTh, { attr: { class: 'dt-th is-sorted' } }, 1.55)
        .fromTo(dayTh.querySelector('.dt-sort'), { rotation: 0 }, { rotation: 180, duration: 0.35 }, 1.55);
      order.forEach(function (ri, k) {
        tl.to(rows[ri], { y: top0 + k * pitch, duration: 0.8, ease: 'power3.inOut' }, 1.65 + k * 0.04);
      });
      tl.fromTo(rows.map(function (r) { return r.querySelector('.dt-trow-line .dt-days'); }),
        { scale: 1 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1, stagger: 0.04 }, 2.4);

      // table -> cards
      tl.add(kit.cursorTo(vtCards, { duration: 0.6 }), 3.7)
        .add(kit.tap(vtCards), 4.35)
        .set(vtCards, { attr: { class: 'dt-vt is-on' } }, 4.4)
        .set(vtTable, { attr: { class: 'dt-vt' } }, 4.4)
        .set(tb, { attr: { class: 'dt-table is-cards' + (tall ? ' is-tall' : '') } }, 4.4)
        .to(head, { opacity: 0, y: -8, duration: 0.3 }, 4.4);
      order.forEach(function (ri, k) {
        var col = k % L.cols, row = Math.floor(k / L.cols);
        var el = rows[ri];
        tl.to(el, { x: col * (cw + L.cg), y: TOOLS + row * (L.cardH + L.cg), width: cw, height: L.cardH,
                    duration: 0.9, ease: 'power3.inOut' }, 4.5 + k * 0.06)
          .to(el.querySelector('.dt-trow-line'), { opacity: 0, duration: 0.25 }, 4.5 + k * 0.06)
          .fromTo(el.querySelector('.dt-trow-card'), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 4.95 + k * 0.06);
      });
      tl.to({}, { duration: 1.4 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Step 5 — bookmark
     --------------------------------------------------------------- */
  var bookmark = {
    key: 'bookmark',
    label: 'STEP 5',
    title: 'Save posts you like',
    summary: 'Tap the heart on any post to save it; your bookmarks are kept in My Deputation.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var hdr = tall ? miniHeader(kit, stage, 10, 0, 370) : miniHeader(kit, stage, 110, 10, 880);
      var card = kit.el('div', 'dt-bcard', null, stage);
      if (tall) place(card, 20, 170, 350, 230); else place(card, 310, 170, 480, 230);
      card.innerHTML = '<b class="dt-bcard-t">Section Officer</b><span class="dt-bcard-o">Department of Expenditure · Finance</span>' +
        '<span class="dt-trow-chips"><i>Level 8</i><i class="dt-open">Open to L-7 · 3 yrs</i><i>Delhi</i><i class="dt-days">18d left</i></span>' +
        '<span class="dt-heart">' + ICON.heart + '</span>';
      var heart = card.querySelector('.dt-heart');
      var fly = kit.el('i', 'dt-fly-heart', ICON.heart, stage);
      var toast = kit.el('div', 'dt-toast', ICON.bookmark + 'Saved to My Deputation', stage);
      if (tall) place(toast, 60, 70); else place(toast, 650, 80);

      var a = null, b = null;
      function A() { return a || (a = localCentre(heart, stage, kit)); }
      function B() { return b || (b = localCentre(hdr.bmark, stage, kit)); }
      gsap.set(fly, { opacity: 0, xPercent: -50, yPercent: -50 });

      var tl = gsap.timeline();
      tl.fromTo(hdr.el, { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.5 }, 0)
        .fromTo(card, { opacity: 0, y: 30, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }, 0.15)
        .add(kit.cursorTo(heart, { duration: 0.7 }), 0.6)
        .add(kit.tap(heart), 1.3)
        .set(heart, { attr: { class: 'dt-heart is-saved' } }, 1.35)
        .fromTo(heart, { scale: 1 }, { scale: 1.35, duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out' }, 1.35)
        .add(kit.burst(heart, { count: 22 }), 1.38)
        .fromTo(fly, { x: function () { return A().x; }, y: function () { return A().y; }, opacity: 1, scale: 1 },
          { x: function () { return B().x; }, duration: 0.9, ease: 'power1.inOut', immediateRender: false }, 1.55)
        .fromTo(fly, { y: function () { return A().y; } },
          { y: function () { return B().y; }, duration: 0.9, ease: 'back.in(2.2)', immediateRender: false }, 1.55)
        .to(fly, { scale: 0.45, duration: 0.9, ease: 'power1.in' }, 1.55)
        .to(fly, { opacity: 0, duration: 0.15 }, 2.4)
        .fromTo(hdr.bmark, { scale: 1 }, { scale: 1.3, duration: 0.18, yoyo: true, repeat: 1 }, 2.4)
        .add(kit.odometer(hdr.badge, 0, 1, { duration: 0.4 }), 2.42)
        .fromTo(hdr.badge, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(3)' }, 2.42)
        .fromTo(toast, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 2.8)
        .to({}, { duration: 1.6 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Step 6 — alerts
     --------------------------------------------------------------- */
  var alerts = {
    key: 'alerts',
    label: 'STEP 6',
    title: 'Never miss a vacancy',
    summary: 'Turn on alerts for your pay level and get a daily notification of new vacancies.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var hdr = tall ? miniHeader(kit, stage, 10, 0, 370) : miniHeader(kit, stage, 110, 10, 880);
      var pop = kit.el('div', 'dt-apop', null, stage);
      if (tall) place(pop, 90, 66, 290); else place(pop, 690, 78, 300);
      pop.innerHTML = '<div class="dt-apop-row"><span>Daily alerts for new posts</span><span class="dt-switch dt-aswitch">' +
        '<i class="dt-switch-on"></i><i class="dt-switch-knob"></i></span></div>' +
        '<div class="dt-trow-chips"><i>Level 8</i></div><span class="dt-apop-note">For your pay level \u00B7 every morning</span>';
      var sw = pop.querySelector('.dt-aswitch');
      var phone = kit.el('div', 'dt-phone', null, stage);
      if (tall) place(phone, 85, 236, 220, 440); else place(phone, 300, 96, 230, 470);
      phone.innerHTML = '<i class="dt-phone-notch"></i><span class="dt-phone-time">9:41</span>' +
        '<span class="dt-phone-date">' + todayLong() + '</span>' +
        '<div class="dt-push"><span class="dt-push-app">AD</span><div class="dt-push-body">' +
        '<b>New vacancy · Level 8 · Delhi</b><span>Section Officer — Department of Expenditure</span>' +
        '<em>ALL Deputations · now</em></div></div>';
      var push = phone.querySelector('.dt-push');

      var tl = gsap.timeline();
      tl.fromTo(hdr.el, { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.5 }, 0)
        .add(kit.cursorTo(hdr.bell, { duration: 0.7 }), 0.4)
        .add(kit.tap(hdr.bell), 1.15)
        .fromTo(pop, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 1.25)
        .add(kit.cursorTo(sw, { duration: 0.5 }), 1.6)
        .add(kit.tap(sw), 2.15)
        .to(sw.querySelector('.dt-switch-on'), { opacity: 1, duration: 0.25 }, 2.2)
        .to(sw.querySelector('.dt-switch-knob'), { x: 16, duration: 0.3, ease: 'back.out(2)' }, 2.2)
        .set(hdr.bell, { attr: { class: 'dt-mi dt-bell is-on' } }, 2.25)
        .to(hdr.bell, { keyframes: { rotation: [0, 16, -14, 10, -6, 0] }, duration: 0.7, ease: 'none' }, 2.25)
        .fromTo(phone, { opacity: 0, x: tall ? 0 : -60, y: tall ? 60 : 0, rotation: tall ? 0 : -4 },
          { opacity: 1, x: 0, y: 0, rotation: 0, duration: 0.8, ease: 'power3.out' }, 2.6)
        .fromTo(push, { opacity: 0, y: -70, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.6)' }, 3.5)
        .to(phone, { keyframes: { x: [0, -5, 5, -4, 4, 0] }, duration: 0.45, ease: 'none' }, 3.6)
        .add(kit.sweep(push), 4.1)
        .to({}, { duration: 1.8 });
      return tl;
    }
  };

  /* ---------------------------------------------------------------
     Step 7 — light or dark
     --------------------------------------------------------------- */
  function pageMock(themeCls, tall) {
    var cards = [['Sample \u00B7 Active', '1,240'], ['Closing soon', '86'], ['Ministries', '24']];
    return '<div class="dt-tm-head"><span class="dt-mlogo"><b>ALL</b> Deputations</span>' +
      '<span class="dt-mi dt-tm-toggle">' + (themeCls === 'dark' ? ICON.moon : ICON.sun) + '</span></div>' +
      '<b class="dt-tm-title">All Deputation Vacancies</b>' +
      '<div class="dt-tm-kpis">' + cards.slice(0, tall ? 2 : 3).map(function (c) {
        return '<span><em>' + c[0] + '</em><b>' + c[1] + '</b></span>';
      }).join('') + '</div>' +
      '<div class="dt-tm-rows">' + ROWS.slice(0, 4).map(function (r) {
        return '<span><b>' + esc(r.t) + '</b><i>' + r.d + 'd left</i></span>';
      }).join('') + '</div>';
  }

  var theme = {
    key: 'theme',
    label: 'STEP 7',
    title: 'Light or dark — your choice',
    summary: 'Switch between the dark and the light theme at any time.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var box = tall ? [20, 20, 350, 600] : [200, 30, 700, 540];
      var dark = kit.el('div', 'dt-theme dt-theme-dark', pageMock('dark', tall), stage);
      var light = kit.el('div', 'dt-theme dt-theme-light', pageMock('light', tall), stage);
      [dark, light].forEach(function (el) { place(el, box[0], box[1], box[2], box[3]); });
      // the wipe starts at the toggle (top-right of the mini header)
      var ox = box[2] - 38, oy = 34, R = Math.ceil(Math.hypot(ox, box[3] - oy)) + 10;
      light.style.setProperty('--dt-x', ox + 'px');
      light.style.setProperty('--dt-y', oy + 'px');
      light.style.setProperty('--dt-r', '0px');
      var toggle = dark.querySelector('.dt-tm-toggle');

      var tl = gsap.timeline();
      tl.fromTo(dark, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .add(kit.cursorTo(toggle, { duration: 0.7 }), 0.5)
        .add(kit.tap(toggle), 1.25)
        .fromTo(light, { '--dt-r': '0px' }, { '--dt-r': R + 'px', duration: 1.1, ease: 'power2.inOut' }, 1.35)
        .add(kit.tap(toggle), 3.7)
        .to(light, { '--dt-r': '0px', duration: 1.0, ease: 'power2.inOut' }, 3.8)
        .to({}, { duration: 1.0 });
      return tl;
    }
  };

  window.DepTourHomeMore = { scenes: [views, bookmark, alerts, theme] };
})();
