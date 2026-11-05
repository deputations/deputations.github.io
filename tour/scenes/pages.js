/* ============================================================
   tour/scenes/pages.js — Home step 8 "Explore more pages".

   Each of the site's other pages appears large for ~2 s with a
   mini animation, then shrinks into its slot in a grid (wide 3 x 2,
   phone 2 x 3). The cards are real links: at the finale (engine
   keepScene) a click closes the tour and opens that page.

   Registered by tour/scenes/home.js via window.DepTourPages.
   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourPages) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var PAGES = [
    { key: 'map', title: 'India Map', text: 'Vacancies state by state', href: '/india-map.html' },
    { key: 'defex', title: 'DeFeX', text: 'Deputation Friendliness Index', href: '/defex.html' },
    { key: 'mydep', title: 'My Deputation', text: 'Track applications and dates', href: '/my-deputation.html' },
    { key: 'report', title: 'Report Vacancy', text: 'Share a notification you found', href: '/report-vacancy.html' },
    { key: 'rules', title: 'Rules', text: 'Every circular in one place', href: '/rules.html' },
    { key: 'faq', title: 'FAQs', text: 'Answers to common questions', href: '/faq.html' }
  ];

  function svg(viewBox, inner) {
    return '<svg viewBox="' + viewBox + '" aria-hidden="true" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>';
  }

  /* ---------- mini animations: each fills `art` and returns a timeline ---------- */
  var ART = {
    map: function (art) {
      var data = window.DepTourMap && window.DepTourMap.data;
      if (!data) return gsap.timeline();
      var s = document.createElementNS(SVGNS, 'svg');
      s.setAttribute('viewBox', '60 0 880 800');
      s.setAttribute('aria-hidden', 'true');
      var paths = data.states.map(function (st, i) {
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', st.d);
        p.setAttribute('pathLength', '1');
        p.setAttribute('class', 'dt-pm-state' + (i % 5 === 0 ? ' is-hot' : ''));
        s.appendChild(p);
        return p;
      });
      art.appendChild(s);
      gsap.set(paths, { strokeDasharray: 1, strokeDashoffset: 1, fillOpacity: 0 });
      return gsap.timeline()
        .to(paths, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.008 }, 0)
        .to(paths, { fillOpacity: 1, duration: 0.5, stagger: 0.006 }, 0.7);
    },
    defex: function (art) {
      art.innerHTML = svg('0 0 200 120',
        '<path class="dt-pm-arc" d="M20 105 A80 80 0 0 1 180 105" pathLength="1"/>' +
        '<path class="dt-pm-arc is-fg" d="M20 105 A80 80 0 0 1 180 105" pathLength="1"/>' +
        '<g class="dt-pm-needle"><line x1="100" y1="105" x2="100" y2="40"/><circle cx="100" cy="105" r="7"/></g>' +
        '<text class="dt-pm-score" x="100" y="88">78</text>');
      var fg = art.querySelector('.is-fg'), needle = art.querySelector('.dt-pm-needle');
      gsap.set(fg, { strokeDasharray: 1, strokeDashoffset: 1 });
      gsap.set(needle, { rotation: -90, svgOrigin: '100 105' });
      return gsap.timeline()
        .to(fg, { strokeDashoffset: 0.22, duration: 1.1, ease: 'power3.out' }, 0)
        .to(needle, { rotation: 50, duration: 1.1, ease: 'back.out(1.4)' }, 0)
        .fromTo(art.querySelector('.dt-pm-score'), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.6);
    },
    mydep: function (art) {
      var steps = ['Saved', 'Applied', 'NOC', 'Interview'];
      art.innerHTML = '<div class="dt-pm-track"><i class="dt-pm-rail"><b></b></i>' + steps.map(function (s) {
        return '<span><i></i><em>' + s + '</em></span>';
      }).join('') + '</div>';
      var fill = art.querySelector('.dt-pm-rail b'), dots = art.querySelectorAll('.dt-pm-track span');
      gsap.set(fill, { scaleX: 0, transformOrigin: '0 50%' });
      var tl = gsap.timeline().to(fill, { scaleX: 1, duration: 1.2, ease: 'none' }, 0);
      Array.prototype.forEach.call(dots, function (d, i) {
        tl.set(d, { attr: { class: 'is-on' } }, i * 0.4)
          .fromTo(d.querySelector('i'), { scale: 0.6 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, i * 0.4);
      });
      return tl;
    },
    report: function (art) {
      art.innerHTML = '<div class="dt-pm-drop"><span class="dt-pm-pdf">PDF</span></div><span class="dt-pm-status">Under review ✓</span>';
      var pdf = art.querySelector('.dt-pm-pdf'), st = art.querySelector('.dt-pm-status');
      return gsap.timeline()
        .fromTo(pdf, { y: -70, rotation: -14, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7, ease: 'bounce.out' }, 0)
        .fromTo(st, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 }, 0.8);
    },
    rules: function (art) {
      art.innerHTML = '<div class="dt-pm-book">' + [3, 2, 1].map(function (n) {
        return '<span class="dt-pm-sheet"><i></i><i></i><i></i><em>' + n + '</em></span>';
      }).join('') + '</div>';
      var sheets = art.querySelectorAll('.dt-pm-sheet');
      var tl = gsap.timeline();
      [sheets[2], sheets[1]].forEach(function (s, i) {
        tl.to(s, { rotationY: -165, duration: 0.6, ease: 'power2.inOut', transformOrigin: '0% 50%' }, i * 0.45);
      });
      return tl;
    },
    faq: function (art) {
      art.innerHTML = '<div class="dt-pm-faq">' +
        '<span class="is-open"><b>Who can apply on deputation?</b><em>Officers at the feeder grades the circular lists.</em></span>' +
        '<span><b>What is the cooling-off period?</b></span><span><b>How long is a tenure?</b></span></div>';
      var ans = art.querySelector('.is-open em');
      return gsap.timeline().fromTo(ans, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.3);
    }
  };

  var montageScene = {
    key: 'pages',
    label: 'STEP 8',
    title: 'Explore more pages',
    summary: 'India Map, DeFeX, My Deputation, Report Vacancy, Rules and FAQs each have their own page.',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var G = tall
        ? { cols: 2, w: 178, h: 172, gx: 14, gy: 14, x0: 10, y0: 0, big: 1.85, cx: 195, cy: 300 }
        : { cols: 3, w: 300, h: 210, gx: 30, gy: 24, x0: 70, y0: 16, big: 1.75, cx: 550, cy: 270 };
      var cards = PAGES.map(function (p, i) {
        var a = kit.el('a', 'dt-page-card dt-page-link dt-pc-' + p.key + (tall ? ' is-tall' : ''), null, stage);
        a.href = p.href;
        a.innerHTML = '<span class="dt-page-art"></span><span class="dt-page-meta"><b>' + p.title + '</b><span>' + p.text +
          '</span><i class="dt-page-go" aria-hidden="true">→</i></span>';
        var col = i % G.cols, row = Math.floor(i / G.cols);
        var x = G.x0 + col * (G.w + G.gx), y = G.y0 + row * (G.h + G.gy);
        a.style.left = x + 'px'; a.style.top = y + 'px'; a.style.width = G.w + 'px'; a.style.height = G.h + 'px';
        return { el: a, art: a.querySelector('.dt-page-art'), p: p,
                 dx: G.cx - (x + G.w / 2), dy: G.cy - (y + G.h / 2) };
      });
      cards.forEach(function (c) { gsap.set(c.el, { opacity: 0 }); });

      var tl = gsap.timeline();
      var STEP = 2.3;
      cards.forEach(function (c, i) {
        var t = 0.2 + i * STEP;
        tl.fromTo(c.el, { opacity: 0, x: c.dx, y: c.dy + 30, scale: G.big * 0.9 },
            { opacity: 1, x: c.dx, y: c.dy, scale: G.big, duration: 0.45, ease: 'power3.out' }, t)
          .set(c.el, { attr: { class: c.el.getAttribute('class') + ' is-big' } }, t)
          .add(ART[c.p.key](c.art), t + 0.3)
          .add(kit.sweep(c.el), t + 1.2)
          .to(c.el, { x: 0, y: 0, scale: 1, duration: 0.6, ease: 'power3.inOut' }, t + 1.7)
          .set(c.el, { attr: { class: c.el.getAttribute('class') } }, t + 1.75);
      });
      tl.to({}, { duration: 1.0 });
      return tl;
    }
  };

  window.DepTourPages = { montageScene: montageScene, pages: PAGES };
})();
