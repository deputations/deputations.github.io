/* ============================================================
   tour/scenes/pages.js — Home step 8 "Explore more pages".

   Each of the site's other pages appears large for ~2 s with a
   mini animation, then shrinks into its slot in a grid (wide 3 x 2,
   phone 2 x 3). Last, "Join us on WhatsApp" (Channel for latest
   updates, Group for discussions) does the same and becomes a
   full-width bar under the grid, linking to the Contact page. The
   cards are real links: at the finale (engine keepScene) a click
   closes the tour and opens that page.

   Registered by tour/scenes/home.js via window.DepTourPages.
   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourPages) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var PAGES = [
    { key: 'map', title: 'India Map', text: 'Vacancies state by state', href: '/india-map.html' },
    { key: 'defex', title: 'DeFeX', text: 'Deputation Friendliness Index', href: '/defex.html', beta: true },
    { key: 'mydep', title: 'My Deputation', text: 'Track applications and dates', href: '/my-deputation.html' },
    { key: 'report', title: 'Report Vacancy', text: 'Just paste the vacancy link, or upload the PDF', href: '/report-vacancy.html' },
    { key: 'rules', title: 'Rules', text: 'All rules at one place, easy to search', href: '/rules.html' },
    { key: 'faq', title: 'FAQs', text: 'Answers to common questions', href: '/faq.html' }
  ];
  var WHATSAPP = { href: '/contact.html', title: 'Join us on WhatsApp',
                   channel: 'Channel · latest updates', group: 'Group · discussions' };
  var CHAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm-4 8.2h8v1.6H8v-1.6zm0-3h8v1.6H8V8.2zm0 6h5v1.6H8v-1.6z"/></svg>';

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
    // a link is enough; a PDF works too (the page's "Submit Link" / "Upload PDF" tabs)
    report: function (art, kit) {
      art.innerHTML = '<div class="dt-pm-rv"><span class="dt-pm-url"><i>🔗</i><em></em></span>' +
        '<span class="dt-pm-or">or</span><span class="dt-pm-pdf">PDF</span></div><span class="dt-pm-status">Under review ✓</span>';
      var url = art.querySelector('.dt-pm-url em'), or = art.querySelector('.dt-pm-or'),
          pdf = art.querySelector('.dt-pm-pdf'), st = art.querySelector('.dt-pm-status');
      return gsap.timeline()
        .add(kit.type(url, 'https://ministry.gov.in/vacancy', { cps: 42 }), 0)
        .fromTo(or, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.75)
        .fromTo(pdf, { y: -40, rotation: -14, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.6, ease: 'bounce.out' }, 0.8)
        .fromTo(st, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 }, 1.3);
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
    whatsapp: function (art) {
      art.innerHTML = '<div class="dt-wa-chat">' +
        '<span class="dt-wa-msg is-ch"><em>Channel</em>New vacancy · Section Officer, Level 8</span>' +
        '<span class="dt-wa-msg is-in"><em>Group</em>Has anyone applied for this one?</span>' +
        '<span class="dt-wa-msg is-out">Yes, my NOC came through today</span></div>';
      return gsap.timeline().fromTo(art.querySelectorAll('.dt-wa-msg'), { opacity: 0, y: 12, scale: 0.92 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.38 }, 0);
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
    title: 'Explore more pages',
    summary: 'India Map, DeFeX (beta), My Deputation, Report Vacancy, Rules and FAQs each have their own page. ' +
      'Join our WhatsApp Channel for the latest updates and the Group for discussions (Contact page).',
    build: function (stage, kit) {
      var tall = kit.layout === 'tall';
      var G = tall
        ? { cols: 2, w: 178, h: 160, gx: 14, gy: 14, x0: 10, y0: 0, big: 1.85, cx: 195, cy: 300, barH: 64 }
        : { cols: 3, w: 300, h: 210, gx: 30, gy: 24, x0: 70, y0: 16, big: 1.75, cx: 550, cy: 270, barH: 58 };
      var cards = PAGES.map(function (p, i) {
        var a = kit.el('a', 'dt-page-card dt-page-link dt-pc-' + p.key + (tall ? ' is-tall' : ''), null, stage);
        a.href = p.href;
        a.innerHTML = '<span class="dt-page-art"></span><span class="dt-page-meta"><b>' + p.title + '</b><span>' + p.text +
          '</span><i class="dt-page-go" aria-hidden="true">→</i></span>' + (p.beta ? '<i class="dt-beta">Beta</i>' : '');
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
          .add(ART[c.p.key](c.art, kit), t + 0.3)
          .add(kit.sweep(c.el), t + 1.2)
          .to(c.el, { x: 0, y: 0, scale: 1, duration: 0.6, ease: 'power3.inOut' }, t + 1.7)
          .set(c.el, { attr: { class: c.el.getAttribute('class') } }, t + 1.75);
      });
      // WhatsApp: shown big like the pages, then a full-width bar under the grid
      var rows = Math.ceil(PAGES.length / G.cols);
      var bar = { x: G.x0, y: G.y0 + rows * (G.h + G.gy), w: G.cols * G.w + (G.cols - 1) * G.gx, h: G.barH };
      var bigW = G.w * G.big, bigH = G.h * G.big;
      var BAR = 'dt-wa-bar dt-page-link' + (tall ? ' is-tall' : ''), CARD = BAR + ' is-card is-big';
      var wa = kit.el('a', BAR, null, stage);
      wa.href = WHATSAPP.href;
      wa.innerHTML = '<span class="dt-wa-art" aria-hidden="true"></span><span class="dt-wa-ico">' + CHAT_ICON + '</span>' +
        '<span class="dt-wa-meta"><b>' + WHATSAPP.title + '</b><span class="dt-wa-pills"><i>' + WHATSAPP.channel +
        '</i><i>' + WHATSAPP.group + '</i></span></span><i class="dt-page-go" aria-hidden="true">→</i>';
      var waIn = wa.querySelectorAll('.dt-wa-art, .dt-wa-ico, .dt-wa-meta');
      var tw = 0.2 + PAGES.length * STEP;
      tl.set(wa, { attr: { class: CARD } }, tw)
        .fromTo(wa, { opacity: 0, left: G.cx - bigW / 2, top: G.cy - bigH / 2 + 30, width: bigW, height: bigH },
          { opacity: 1, top: G.cy - bigH / 2, duration: 0.45, ease: 'power3.out' }, tw)
        .add(ART.whatsapp(wa.querySelector('.dt-wa-art')), tw + 0.3)
        .add(kit.sweep(wa), tw + 1.5)
        .to(waIn, { opacity: 0, duration: 0.15 }, tw + 2.0)
        .set(wa, { attr: { class: BAR } }, tw + 2.15)
        .to(wa, { left: bar.x, top: bar.y, width: bar.w, height: bar.h, duration: 0.6, ease: 'power3.inOut' }, tw + 2.15)
        .to(waIn, { opacity: 1, duration: 0.3 }, tw + 2.6);
      tl.to({}, { duration: 1.0 });
      return tl;
    }
  };

  window.DepTourPages = { montageScene: montageScene, pages: PAGES, whatsapp: WHATSAPP };
})();
