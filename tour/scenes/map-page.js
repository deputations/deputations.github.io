/* ============================================================
   tour/scenes/map-page.js — the India Map page tour (india-map.html).

   1 "Every state at a glance": the map draws itself, glows as a heat
     map; hovering a state shows its tooltip card.
   2 "Filter the whole map": Pay Level 8, then Finance; every state
     recolours and the count rolls down.
   3 "Dive into a state": Karnataka; its districts rise; Back to India.
   4 "Posts in every district": Bengaluru Urban; posts slide up; one
     opens and is saved.
   5 "Zoom, list and go back": the state's list, zoom in and reset,
     then Back to India flies out to the whole map.

   Uses the helpers in tour/scenes/map.js (loaded first).
   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3.2
   ============================================================ */
(function () {
  'use strict';
  if (!window.DepTour || !window.DepTourMap) return;
  DepTour.expect('map');
  var M = window.DepTourMap;

  var HEADLINE = 'Vacancies across India, on one map';
  var FOCUS = 'Bengaluru Urban';
  var HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 ' +
    '7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  var POSTS = [
    { t: 'Section Officer', o: 'Department of Space', l: 8, d: 12 },
    { t: 'Assistant Director (OL)', o: "Employees' Provident Fund Organisation", l: 10, d: 19 },
    { t: 'Accounts Officer', o: 'Defence Accounts Department', l: 8, d: 26 }
  ];
  var LIST = [['Section Officer', 'Bengaluru Urban'], ['Senior Accountant', 'Mysuru'],
              ['Deputy Director', 'Bengaluru Urban'], ['Assistant Section Officer', 'Dharwad']];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function place(el, xy) { el.style.left = xy[0] + 'px'; el.style.top = xy[1] + 'px'; if (xy[2]) el.style.width = xy[2] + 'px'; }
  function localCentre(el, scene, kit) {
    var r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
    var k = s.width / kit.width || 1;
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
  }
  function hideCursor(tl, at) {
    var bits = Array.prototype.slice.call(document.querySelectorAll('.dt-cursor, .dt-trail'));
    if (bits.length) tl.to(bits, { opacity: 0, duration: 0.35 }, at);
  }

  function layout(kit) {
    return kit.layout === 'tall'
      ? { map: { x: 10, y: 120, w: 370, h: 430 }, count: [14, 18], panel: [10, 54, 370], state: [14, 58],
          back: [16, 128], posts: [10, 418, 370], detail: [20, 200, 350], listBtn: [10, 566, 370],
          list: [20, 190, 350], zoom: [334, 132] }
      : { map: { x: 340, y: 0, w: 750, h: 610 }, count: [24, 8], panel: [24, 70, 296], state: [24, 70],
          back: [362, 14], posts: [24, 128, 296], detail: [24, 360, 296], listBtn: [24, 128, 296],
          list: [24, 188, 296], zoom: [1042, 214] };
  }

  // The map as it looks at the start of a step (drawn, tilted, maybe dived).
  function mapAt(stage, kit, L, stateDive) {
    var v = M.drawIndia(stage, M.data, kit, L.map);
    v.tl.progress(1);
    if (stateDive) {
      M.diveTo(v, M.data.focus.abbr, kit).progress(1);
      M.raiseDistricts(v, M.data, kit).progress(1);
    }
    return v;
  }
  function counter(stage, kit, L, value) {
    var el = kit.el('div', 'dt-mcount-wrap', '<b class="dt-mcount"></b><span>sample vacancies</span>', stage);
    place(el, L.count);
    var num = el.querySelector('.dt-mcount');
    num.textContent = value.toLocaleString('en-IN');
    num.setAttribute('aria-label', String(value));
    return { el: el, num: num };
  }
  function backButton(stage, kit, L) {
    var b = kit.el('span', 'dt-mback', '‹ Back to India', stage);
    place(b, L.back);
    return b;
  }
  function stateChip(stage, kit, L) {
    var c = kit.el('div', 'dt-chip dt-mstate', '<span class="dt-chip-k">' + M.data.focus.state +
      '</span><b>96</b><span class="dt-chip-k">sample posts</span>', stage);
    place(c, L.state);
    return c;
  }
  function districtPath(v) {
    return v.districts.filter(function (p) { return p.getAttribute('data-name') === FOCUS; })[0];
  }
  // deterministic "filtered" counts for the recolour steps
  function scaled(heat, f) {
    var out = {};
    Object.keys(heat).forEach(function (k, i) {
      var r = ((k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1) * 17 + i * 7) % 100) / 100;
      out[k] = Math.max(0, Math.round(heat[k] * f * (0.3 + 1.4 * r)));
    });
    return out;
  }

  /* ---------- 1. every state at a glance ---------- */
  var glance = {
    key: 'glance',
    label: 'STEP 1',
    title: 'Every state at a glance',
    summary: "The map shows every state's vacancies at a glance; hover a state to see its details.",
    build: function (stage, kit) {
      var L = layout(kit);
      var v = M.drawIndia(stage, M.data, kit, L.map);
      var cnt = counter(stage, kit, L, 1240);
      var mh = v.states.get('MH');
      var tip = kit.el('div', 'dt-maptip', '<b>Maharashtra</b><span>' + (kit.sample.heat.MH || 0) +
        ' sample posts</span><em>Most from Finance · Railways</em>', stage);
      var c = null;
      function C() { return c || (c = localCentre(mh, stage, kit)); }
      var tipW = kit.layout === 'tall' ? 190 : 230;
      function X() { return Math.max(8, Math.min(C().x + 18, kit.width - tipW - 8)); }
      function Y() { return Math.max(40, C().y - 80); }

      var tl = gsap.timeline();
      tl.add(v.tl, 0)
        .fromTo(cnt.el, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5 }, 1.2)
        .add(kit.odometer(cnt.num, 0, 1240, { duration: 1.6 }), 1.4)
        .add(kit.cursorTo(mh, { duration: 0.8 }), 3.4)
        .to(mh, { fillOpacity: 1, duration: 0.3 }, 4.2)
        .fromTo(tip, { opacity: 0, x: X, y: function () { return Y() + 10; } },
          { opacity: 1, x: X, y: Y, duration: 0.35, ease: 'power2.out', immediateRender: false }, 4.25)
        .add(kit.sweep(tip), 4.6)
        .to({}, { duration: 2.6 });
      return tl;
    }
  };

  /* ---------- 2. filter the whole map ---------- */
  var filters = {
    key: 'mfilters',
    label: 'STEP 2',
    title: 'Filter the whole map',
    summary: 'Use the filters — For me, Pay Level, Ministry and more — and the whole map recolours.',
    build: function (stage, kit) {
      var L = layout(kit);
      var v = mapAt(stage, kit, L, false);
      var cnt = counter(stage, kit, L, 1240);
      var panel = kit.el('div', 'dt-mfilter' + (kit.layout === 'tall' ? ' is-tall' : ''), null, stage);
      place(panel, L.panel);
      panel.innerHTML = '<div class="dt-mftabs"><span>Search</span><span>For me</span><span class="dt-mft-pay">Pay Level</span>' +
        '<span class="dt-mft-min">Ministry</span></div>' +
        '<div class="dt-mfrow dt-mf-pay"><em>Pay Level</em><span class="dt-mfv"><i class="is-empty">Any</i><i class="is-set">Level 8</i></span></div>' +
        '<div class="dt-mfrow dt-mf-min"><em>Ministry</em><span class="dt-mfv"><i class="is-empty">Any</i><i class="is-set">Finance</i></span></div>';
      var pay = panel.querySelector('.dt-mf-pay'), min = panel.querySelector('.dt-mf-min');
      var heat8 = scaled(kit.sample.heat, 0.25), heatF = scaled(heat8, 0.2);

      var tl = gsap.timeline();
      tl.fromTo(panel, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power2.out' }, 0.2);
      [[pay, panel.querySelector('.dt-mft-pay'), heat8, 1240, 312, 0.7],
       [min, panel.querySelector('.dt-mft-min'), heatF, 312, 58, 3.0]].forEach(function (s) {
        var row = s[0], at = s[5];
        tl.add(kit.cursorTo(row, { duration: 0.6 }), at)
          .add(kit.tap(row), at + 0.6)
          .set(s[1], { attr: { class: s[1].getAttribute('class') + ' is-on' } }, at + 0.65)
          .set(row, { attr: { class: row.getAttribute('class') + ' is-on' } }, at + 0.65)
          .to(row.querySelector('.is-empty'), { opacity: 0, y: -8, duration: 0.25 }, at + 0.7)
          .fromTo(row.querySelector('.is-set'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 }, at + 0.75)
          .add(M.recolour(v, s[2], kit), at + 0.75)
          .add(kit.odometer(cnt.num, s[3], s[4], { duration: 1.0 }), at + 0.75);
      });
      tl.add(kit.sweep(cnt.el), 5.2).to({}, { duration: 1.8 });
      return tl;
    }
  };

  /* ---------- 3. dive into a state ---------- */
  var dive = {
    key: 'dive',
    label: 'STEP 3',
    title: 'Dive into a state',
    summary: 'Tap a state to dive in and see its districts.',
    build: function (stage, kit) {
      var L = layout(kit);
      var v = mapAt(stage, kit, L, false);
      counter(stage, kit, L, 1240);
      var back = backButton(stage, kit, L), chip = stateChip(stage, kit, L);
      var ka = v.states.get(M.data.focus.abbr);
      var tl = gsap.timeline();
      tl.add(kit.cursorTo(ka, { duration: 0.8 }), 0.5)
        .add(kit.tap(ka), 1.3);
      hideCursor(tl, 1.7);
      tl.add(M.diveTo(v, M.data.focus.abbr, kit), 1.5)
        .add(M.raiseDistricts(v, M.data, kit), 3.4)
        .fromTo(back, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.4 }, 3.5)
        .fromTo(chip, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out' }, 3.7)
        .to({}, { duration: 2.6 });
      return tl;
    }
  };

  /* ---------- 4. posts in every district ---------- */
  var posts = {
    key: 'posts',
    label: 'STEP 4',
    title: 'Posts in every district',
    summary: 'Tap a district to see its posts, open one and save it.',
    build: function (stage, kit) {
      var L = layout(kit);
      var v = mapAt(stage, kit, L, true);
      counter(stage, kit, L, 1240);
      backButton(stage, kit, L);
      stateChip(stage, kit, L).style.opacity = 0;          // the posts panel takes its place
      var bu = M.data.focus.districts.filter(function (d) { return d.name === FOCUS; })[0];
      var buPath = districtPath(v);
      var panel = kit.el('div', 'dt-mposts', null, stage);
      place(panel, L.posts);
      panel.innerHTML = '<div class="dt-mposts-h"><b>' + FOCUS + '</b><span>24 sample posts</span></div>' +
        POSTS.map(function (p) {
          return '<div class="dt-mpost"><b>' + esc(p.t) + '</b><span>' + esc(p.o) + '</span>' +
            '<span class="dt-trow-chips"><i>Level ' + p.l + '</i><i class="dt-days">' + p.d + 'd left</i></span></div>';
        }).join('');
      var rows = panel.querySelectorAll('.dt-mpost');
      var detail = kit.el('div', 'dt-mdetail', null, stage);
      place(detail, L.detail);
      detail.innerHTML = '<b>' + POSTS[0].t + '</b><span>' + POSTS[0].o + ' · ' + FOCUS + '</span>' +
        '<span class="dt-trow-chips"><i>Level 8</i><i class="dt-open">Open to L-7 · 3 yrs</i><i class="dt-days">12d left</i></span>' +
        '<span class="dt-heart">' + HEART + '</span>';
      var heart = detail.querySelector('.dt-heart');

      var tl = gsap.timeline();
      tl.add(kit.cursorTo(buPath, { duration: 0.7 }), 0.6)
        .add(kit.tap(buPath), 1.3)
        .to(buPath, { fill: '#a78bfa', fillOpacity: 0.85, duration: 0.4 }, 1.35)
        .add(M.pin(v, bu.cx, bu.cy, kit), 1.4)
        .fromTo(panel, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 2.2)
        .fromTo(rows, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.08 }, 2.4)
        .add(kit.cursorTo(rows[0], { duration: 0.6 }), 3.4)
        .add(kit.tap(rows[0]), 4.0)
        .fromTo(detail, { opacity: 0, scale: 0.92, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.5)' }, 4.1)
        .add(kit.cursorTo(heart, { duration: 0.5 }), 5.0)
        .add(kit.tap(heart), 5.55)
        .set(heart, { attr: { class: 'dt-heart is-saved' } }, 5.6)
        .fromTo(heart, { scale: 1 }, { scale: 1.3, duration: 0.15, yoyo: true, repeat: 1 }, 5.6)
        .add(kit.burst(heart, { count: 18 }), 5.62)
        .to({}, { duration: 2.0 });
      return tl;
    }
  };

  /* ---------- 5. zoom, list and go back ---------- */
  var zoom = {
    key: 'zoom',
    label: 'STEP 5',
    title: 'Zoom, list and go back',
    summary: 'See every post in a state as a list, zoom in or out, and go back to the whole of India.',
    build: function (stage, kit) {
      var L = layout(kit);
      var v = mapAt(stage, kit, L, true);
      var bu = M.data.focus.districts.filter(function (d) { return d.name === FOCUS; })[0];
      M.pin(v, bu.cx, bu.cy, kit).progress(1);
      var cnt = counter(stage, kit, L, 1240);
      var back = backButton(stage, kit, L);
      var listBtn = kit.el('span', 'dt-mlistbtn', 'View all 96 vacancies in ' + M.data.focus.state, stage);
      place(listBtn, L.listBtn);
      var zoomBox = kit.el('div', 'dt-mzoom', '<span>+</span><span>−</span><span>⌂</span>', stage);
      place(zoomBox, L.zoom);
      var zIn = zoomBox.children[0], zHome = zoomBox.children[2];
      var list = kit.el('div', 'dt-mlist', null, stage);
      place(list, L.list);
      list.innerHTML = '<div class="dt-mlist-h"><b>' + M.data.focus.state + '</b><span>96 sample vacancies</span>' +
        '<i class="dt-mlist-x">×</i></div>' + LIST.map(function (r) {
          return '<div class="dt-mlist-r"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>';
        }).join('');
      var closeX = list.querySelector('.dt-mlist-x');
      var vb0 = v.svg.getAttribute('viewBox').split(/\s+/).map(Number);
      var k = 1 / 1.45, cx = vb0[0] + vb0[2] / 2, cy = vb0[1] + vb0[3] / 2;
      var vbIn = [cx - vb0[2] * k / 2, cy - vb0[3] * k / 2, vb0[2] * k, vb0[3] * k].map(function (n) { return n.toFixed(2); }).join(' ');

      var tl = gsap.timeline();
      tl.add(kit.cursorTo(listBtn, { duration: 0.6 }), 0.4)
        .add(kit.tap(listBtn), 1.0)
        .fromTo(list, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.1)
        .add(kit.cursorTo(closeX, { duration: 0.5 }), 2.4)
        .add(kit.tap(closeX), 2.9)
        .to(list, { opacity: 0, y: 10, duration: 0.3 }, 3.0)
        .add(kit.cursorTo(zIn, { duration: 0.5 }), 3.3)
        .add(kit.tap(zIn), 3.8)
        .to(v.svg, { attr: { viewBox: vbIn }, duration: 0.8, ease: 'power2.inOut' }, 3.85)
        .add(kit.cursorTo(zHome, { duration: 0.4 }), 4.7)
        .add(kit.tap(zHome), 5.15)
        .to(v.svg, { attr: { viewBox: vb0.join(' ') }, duration: 0.7, ease: 'power2.inOut' }, 5.2)
        .add(kit.cursorTo(back, { duration: 0.6 }), 5.9)
        .add(kit.tap(back), 6.5)
        .to([back, listBtn, zoomBox], { opacity: 0, duration: 0.3 }, 6.6)
        .add(M.flyOut(v, kit), 6.6)
        .add(kit.sweep(cnt.el), 8.0)
        .to({}, { duration: 1.0 });
      return tl;
    }
  };

  M.load().then(function () {
    DepTour.register('map', {
      intro: { headline: HEADLINE },
      scenes: [glance, filters, dive, posts, zoom],
      cta: { label: 'Explore the map', action: function () {} }
    });
  }, function (err) {
    try { console.warn('[tour] map data unavailable:', err && err.message); } catch (e) {}
  });
})();
