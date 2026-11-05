/* ============================================================
   tour/tour-engine.js — site tour player.

   Owns the overlay, the chrome (title, step dots, progress, Skip,
   "Don't show tours again", Demo badge), the camera stage, layout
   (wide / tall), keyboard, the per-scene timelines and closing.
   Scenes are registered by tour/scenes/*.js and drawn with the kit
   (tour/tour-kit.js). Loaded lazily by tour/tour-loader.js.

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §4.1
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTour) return;

  var CANVAS = { wide: [1100, 620], tall: [390, 720] };
  var CHROME = {                     // space reserved around the stage, px
    wide: { top: 118, bottom: 84, side: 40 },
    tall: { top: 112, bottom: 72, side: 10 }
  };
  var LOGO = '/assets/brand/v2-logo.png';   // the V² (V Square) mark, as in the site header
  var SEEN_KEY = 'dep_tour_seen_v1';
  var OFF_KEY = 'dep_tour_off_v1';

  var tours = {};
  var pending = {};                  // keys announced with expect() but not registered yet
  var waiting = null;                // a play() call waiting on a pending registration
  var S = null;                      // the open session, or null

  /* ---------- small helpers ---------- */
  function warn() {
    try { console.warn.apply(console, ['[tour]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function h(tag, cls, html, parent) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    if (parent) parent.appendChild(el);
    return el;
  }
  function button(cls, text, parent) {
    var b = h('button', cls, null, parent);
    b.type = 'button';
    b.textContent = text;
    return b;
  }
  function scaleFor(layout) {
    var dims = CANVAS[layout], room = CHROME[layout];
    return Math.min((window.innerWidth - room.side * 2) / dims[0],
                    (window.innerHeight - room.top - room.bottom) / dims[1]);
  }
  function layoutFor() { return scaleFor('wide') >= scaleFor('tall') ? 'wide' : 'tall'; }
  var MIN_SCALE = 0.5;               // below this the cinematic stage is unreadable
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function lowPower() {
    var c = navigator.hardwareConcurrency, m = navigator.deviceMemory;
    return (typeof c === 'number' && c > 0 && c <= 4) || (typeof m === 'number' && m > 0 && m <= 4);
  }
  function markSeen(key) {
    var L = window.DepTourLoader;
    if (L && L.markSeen) return L.markSeen(key);
    try {
      var s = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
      s[key] = 1;
      localStorage.setItem(SEEN_KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function setOff() {
    var L = window.DepTourLoader;
    if (L && L.setOff) return L.setOff();
    try { localStorage.setItem(OFF_KEY, '1'); } catch (e) {}
  }

  /* ---------- timelines owned by the session ---------- */
  function track(tl) {
    tl.timeScale(S.speed);
    if (S.paused) tl.pause();
    S.tls.push(tl);
    return tl;
  }
  function liveTimelines() {
    S.tls = S.tls.filter(function (t) { return t && !t._dtDead; });
    return S.tls;
  }
  function kill(tl) {
    if (!tl) return;
    tl._dtDead = true;
    try { tl.kill(); } catch (e) {}
  }

  /* ---------- registration + play ---------- */
  function register(key, tour) {
    tours[key] = tour;
    if (pending[key]) { pending[key].resolve(); delete pending[key]; }
  }

  // A scene file calls expect(key) synchronously, then registers after async
  // setup (e.g. loading map data); play(key) waits for it for up to 3 s.
  function expectTour(key) {
    if (tours[key] || pending[key]) return;
    var done;
    var p = new Promise(function (r) { done = r; });
    pending[key] = { promise: p, resolve: done };
  }

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }

  function play(key, opts) {
    if (S) return S.promise;
    if (!tours[key] && pending[key]) {
      if (!waiting) {
        waiting = Promise.race([
          pending[key].promise,
          new Promise(function (r) { setTimeout(r, 3000); })
        ]).then(function () {
          waiting = null;
          if (!tours[key]) { warn('tour "' + key + '" was not registered in time'); return 'error'; }
          return play(key, opts);
        });
      }
      return waiting;
    }
    opts = opts || {};
    var tour = tours[key];
    if (!tour || !tour.scenes || !tour.scenes.length) {
      warn('no tour registered for "' + key + '"');
      return Promise.resolve('error');
    }
    if (typeof window.gsap === 'undefined') {
      warn('GSAP is not loaded');
      return Promise.resolve('error');
    }
    var mode = (opts.mode === 'steps' || opts.mode === 'cinematic') ? opts.mode
      : (reducedMotion() ? 'steps' : 'cinematic');
    if (mode === 'cinematic' && scaleFor(layoutFor()) < MIN_SCALE) mode = 'steps';   // e.g. phone held sideways
    var resolve;
    var promise = new Promise(function (r) { resolve = r; });
    S = {
      key: key, tour: tour, scenes: tour.scenes, mode: mode,
      speed: opts.speed > 0 ? opts.speed : 1,
      resolve: resolve, promise: promise,
      index: -1, phase: 'opening', paused: false, progress: 0,
      built: 0, tls: [], wrap: null, sceneEl: null, retiring: [],
      sceneStart: 0, sceneDuration: 0
    };
    try { open(); }
    catch (err) {
      warn('could not open:', err && err.message);
      close('error');
    }
    return promise;
  }

  /* ---------- overlay DOM ---------- */
  function open() {
    var root = document.documentElement;
    S.prevFocus = document.activeElement;
    S.prevOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    root.classList.add('dt-open');

    S.lowPower = lowPower();
    var ov = S.overlay = h('div', 'dt-overlay dt-mode-' + S.mode + (S.lowPower ? ' dt-low' : ''));
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'dt-title');
    ov.tabIndex = -1;

    S.backdrop = h('div', 'dt-backdrop', null, ov);
    S.aurora = h('div', 'dt-aurora',
      '<i class="dt-aurora-a"></i><i class="dt-aurora-b"></i><i class="dt-aurora-c"></i>', ov);
    S.aurora.setAttribute('aria-hidden', 'true');
    S.layout = layoutFor();

    if (S.mode === 'cinematic') {
      S.stage = h('div', 'dt-stage dt-' + S.layout, null, ov);
      S.stage.setAttribute('aria-hidden', 'true');      // illustrative; the title says what it shows
      S.canvas = h('div', 'dt-canvas', null, S.stage);
      S.camera = h('div', 'dt-camera', null, S.canvas);
      S.headline = h('div', 'dt-headline', null, ov);
      S.headline.setAttribute('aria-hidden', 'true');
      S.cursorLayer = h('div', 'dt-cursor-layer', null, ov);
      S.cursorLayer.setAttribute('aria-hidden', 'true');
    }

    var chrome = S.chrome = h('div', 'dt-chrome', null, ov);
    if (S.mode === 'cinematic') {
      S.head = h('div', 'dt-head', null, chrome);
      S.head.setAttribute('aria-live', 'polite');
      S.titleEl = h('h2', 'dt-title', null, S.head);
      S.titleEl.id = 'dt-title';
    }
    S.skipBtn = button('dt-skip', 'Skip →', chrome);
    S.skipBtn.setAttribute('aria-label', 'Skip the demo');
    var foot = S.footEl = h('div', 'dt-foot', null, chrome);
    S.footLeft = h('span', 'dt-foot-l', null, foot);
    h('span', 'dt-badge', 'Demo · sample data', S.footLeft);
    // V² logo on every step: in the free band left of the stage, or (phones) beside the Demo tag
    S.markEl = h('div', 'dt-mark', '<img src="' + LOGO + '" alt="" decoding="async">', chrome);
    S.markEl.setAttribute('aria-hidden', 'true');
    S.dotsEl = h('div', 'dt-dots', null, foot);
    S.dots = S.scenes.map(function (sc, i) {
      var d = h('button', null, null, S.dotsEl);
      d.type = 'button';
      d.setAttribute('aria-label', 'Go to step ' + (i + 1) + ': ' + sc.title);
      d.addEventListener('click', function () { goTo(i); });
      return d;
    });
    S.offBtn = button('dt-off', "Don't show tours again", foot);
    S.progressBar = h('i', null, null, h('div', 'dt-progress', null, chrome));

    S.skipBtn.addEventListener('click', function () { close('skip'); });
    ov.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a.dt-page-link') : null;
      if (!a) return;
      e.preventDefault();
      if (!S || S.closing || !S.overlay.classList.contains('dt-finale-on')) return;
      S.linkHref = a.getAttribute('href');
      close('link');
    });
    S.offBtn.addEventListener('click', function () { close('off'); });
    S.onKey = onKey;
    S.onResize = onResize;
    document.addEventListener('keydown', S.onKey, true);
    window.addEventListener('resize', S.onResize);

    document.body.appendChild(ov);
    // Everything else on the page is out of reach while the tour is open.
    S.inerted = Array.prototype.filter.call(document.body.children, function (el) {
      return el !== ov && !el.inert;
    });
    S.inerted.forEach(function (el) { el.inert = true; });
    // Phone Back button closes the tour instead of leaving the site.
    try {
      history.pushState(Object.assign({}, history.state, { dtTour: 1 }), '', location.href);
      S.pushed = true;
    } catch (e) {}
    S.onPop = function () { if (S && !S.closing) { S.popped = true; close('skip'); } };
    window.addEventListener('popstate', S.onPop);
    emit('deptour:open', { key: S.key, mode: S.mode });
    fit();
    try { ov.focus({ preventScroll: true }); } catch (e) { ov.focus(); }

    // The opening fade is never paused or sped up: pausing it would leave the
    // page showing through a transparent overlay. It is still killed on close.
    S.openTl = gsap.timeline();
    S.openTl.fromTo(S.backdrop, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
      .fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0.15);

    if (S.mode === 'steps') return renderStep(0);
    if (S.tour.intro && S.tour.intro.headline) runIntro();
    else enterScene(0);
  }

  /* ---------- layout ---------- */
  function fit() {
    if (!S || !S.overlay) return;
    S.overlay.classList.toggle('dt-is-tall', S.layout === 'tall');
    if (!S.canvas) return;
    var dims = CANVAS[S.layout];
    var room = CHROME[S.layout];
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min((vw - room.side * 2) / dims[0], (vh - room.top - room.bottom) / dims[1]);
    s = Math.max(0.3, Math.min(s, 1.35));
    S.scale = s;
    S.stage.className = 'dt-stage dt-' + S.layout;
    S.stage.style.top = room.top + 'px';
    S.stage.style.bottom = room.bottom + 'px';
    S.canvas.style.width = dims[0] + 'px';
    S.canvas.style.height = dims[1] + 'px';
    S.canvas.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
    placeMark();
  }

  // The logo sits centred in the free band left of the stage when there is
  // room (wide screens); otherwise small, beside the Demo tag in the footer.
  function placeMark() {
    if (!S || !S.markEl) return;
    var vw = window.innerWidth, vh = window.innerHeight, gutter = 0, midY = vh / 2;
    if (S.canvas) {
      var room = CHROME[S.layout];
      gutter = (vw - CANVAS[S.layout][0] * S.scale) / 2;
      midY = room.top + (vh - room.top - room.bottom) / 2;
    }
    var side = S.mode === 'cinematic' && gutter >= 76;
    S.markEl.classList.toggle('is-side', side);
    S.markEl.classList.toggle('is-foot', !side);
    if (side) {
      if (S.markEl.parentNode !== S.chrome) S.chrome.appendChild(S.markEl);
      var size = Math.max(44, Math.min(96, gutter - 28));
      S.markEl.style.width = S.markEl.style.height = size + 'px';
      S.markEl.style.left = ((gutter - size) / 2) + 'px';
      S.markEl.style.top = (midY - size / 2) + 'px';
    } else {
      if (S.markEl.parentNode !== S.footLeft) S.footLeft.insertBefore(S.markEl, S.footLeft.firstChild);
      S.markEl.style.width = S.markEl.style.height = S.markEl.style.left = S.markEl.style.top = '';
    }
  }

  function onResize() {
    if (!S) return;
    clearTimeout(S.resizeTimer);
    S.resizeTimer = setTimeout(refit, 200);
  }

  function refit() {
    if (!S || S.closing) return;
    var next = layoutFor();
    var changed = next !== S.layout;
    S.layout = next;
    fit();
    if (changed && S.mode === 'cinematic' && S.phase === 'scene') {
      var i = S.index;
      clearScenes();
      enterScene(i);
    }
  }

  /* ---------- kit ---------- */
  function makeKit() {
    var ctx = {
      overlay: S.overlay, stage: S.stage, canvas: S.canvas, camera: S.camera,
      cursorLayer: S.cursorLayer, layout: S.layout, scale: S.scale, lowPower: lowPower(),
      width: CANVAS[S.layout][0], height: CANVAS[S.layout][1], speed: S.speed
    };
    if (window.DepTourKit && typeof window.DepTourKit.create === 'function') {
      try { return window.DepTourKit.create(ctx); }
      catch (err) { warn('kit failed:', err && err.message); }
    }
    return {
      layout: ctx.layout, lowPower: ctx.lowPower,
      el: function (tag, cls, html, parent) { return h(tag, cls, html, parent); }
    };
  }

  /* ---------- intro ---------- */
  function runIntro() {
    S.phase = 'intro';
    var text = String(S.tour.intro.headline);
    S.titleEl.textContent = text;
    S.head.classList.add('is-hidden');
    var hl = S.headline;
    hl.innerHTML = '';
    text.split(/\s+/).filter(Boolean).forEach(function (word, wi) {
      if (wi) hl.appendChild(document.createTextNode(' '));
      var w = h('span', 'dt-word', null, hl);
      Array.from(word).forEach(function (ch) { h('span', 'dt-ch', null, w).textContent = ch; });
    });
    var chars = hl.querySelectorAll('.dt-ch');
    var brandText = S.tour.intro.brand ? String(S.tour.intro.brand) : '';
    var tl = track(gsap.timeline({
      onComplete: function () {
        if (!S || S.closing) return;
        hl.innerHTML = '';
        if (S.brandEl) { S.brandEl.remove(); S.brandEl = null; }
        S.head.classList.remove('is-hidden');
        enterScene(0);
      }
    }));
    S.introTl = tl;
    tl.fromTo(S.aurora.children, { scale: 0.55, opacity: 0 },
      { scale: 1, opacity: 1, duration: 1.2, ease: 'power2.out', stagger: 0.12 }, 0)
      .fromTo(hl, { letterSpacing: '0.3em' }, { letterSpacing: '0.02em', duration: 1.5, ease: 'power3.out' }, 0.3)
      .fromTo(chars, { opacity: 0, filter: 'blur(12px)', y: 22 },
        { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.035 }, 0.3)
      .to({}, { duration: brandText ? 0.8 : 1 })
      .to(hl, { scale: 1.15, opacity: 0, filter: 'blur(8px)', duration: brandText ? 0.5 : 0.6, ease: 'power2.in' });
    if (brandText) addBrand(tl, brandText);
  }

  // The brand crashes in full-screen and holds, so people remember the name.
  function addBrand(tl, text) {
    var b = S.brandEl = h('div', 'dt-brand' + (S.layout === 'tall' ? ' is-stacked' : ''), null, S.overlay);
    b.setAttribute('aria-hidden', 'true');
    var sp = text.indexOf(' ');
    var first = sp > 0 ? text.slice(0, sp) : text;
    var rest = sp > 0 ? text.slice(sp + 1) : '';
    var tld = (rest.match(/\.[a-z]{2,}$/i) || [''])[0];
    h('span', 'dt-brand-a', null, b).textContent = first;
    if (rest) {
      b.appendChild(document.createTextNode(' '));
      var bWrap = h('span', 'dt-brand-rest', null, b);
      h('span', 'dt-brand-b', null, bWrap).textContent = rest.slice(0, rest.length - tld.length);
      if (tld) h('span', 'dt-brand-tld', null, bWrap).textContent = tld;
    }
    fitBrand(b);
    var shine = b.querySelectorAll('.dt-brand-b, .dt-brand-tld');
    tl.fromTo(b, { opacity: 0, scale: 2.6, filter: 'blur(18px)' },
        { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.9, ease: 'expo.out' }, '-=0.15')
      .fromTo(shine, { backgroundPosition: '100% 0%' }, { backgroundPosition: '0% 0%', duration: 1.1, ease: 'power2.inOut' }, '-=0.35')
      .to({}, { duration: 1.1 })
      .to(b, { opacity: 0, scale: 1.12, filter: 'blur(10px)', duration: 0.6, ease: 'power2.in' });
  }

  // Size the wordmark to ~90 % of the screen width (and never taller than it fits).
  function fitBrand(b) {
    b.style.fontSize = '100px';
    var w = b.offsetWidth || 1, hgt = b.offsetHeight || 1;
    var fs = 100 * (window.innerWidth * 0.88) / w;
    fs = Math.min(fs, 100 * (window.innerHeight * 0.6) / hgt);
    b.style.fontSize = Math.max(16, Math.floor(fs)) + 'px';
  }

  /* ---------- scenes ---------- */
  function setChrome(i) {
    var sc = S.scenes[i];
    if (S.titleEl) S.titleEl.textContent = sc.title || '';
    S.dots.forEach(function (d, k) {
      d.classList.toggle('is-active', k === i);
      d.classList.toggle('is-done', k < i);
      if (k === i) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
    });
  }

  function setProgress(p) {
    S.progress = Math.max(0, Math.min(1, p));
    if (S.progressBar) S.progressBar.style.transform = 'scaleX(' + S.progress.toFixed(4) + ')';
  }

  function clearScenes() {
    kill(S.introTl); S.introTl = null;
    if (S.headline) S.headline.innerHTML = '';
    if (S.brandEl) { S.brandEl.remove(); S.brandEl = null; }       // skipped mid-intro
    if (S.overlay) S.overlay.classList.remove('dt-finale-on');     // leaving a keep-scene finale
    if (S.stage) S.stage.setAttribute('aria-hidden', 'true');
    if (S.head) S.head.classList.remove('is-hidden');
    kill(S.wrap); S.wrap = null;
    if (S.sceneEl) S.sceneEl.remove();
    S.sceneEl = null;
    S.retiring.forEach(function (r) { kill(r.wrap); r.el.remove(); });
    S.retiring = [];
    kill(S.finaleTl); S.finaleTl = null;
    if (S.finaleEl) { S.finaleEl.remove(); S.finaleEl = null; }
    if (S.markEl) gsap.set(S.markEl, { clearProps: 'opacity' });
    if (S.cursorLayer) S.cursorLayer.innerHTML = '';
    if (S.camera) gsap.set(S.camera, { clearProps: 'transform,opacity,filter' });
  }

  function enterScene(i) {
    if (!S || S.closing) return;
    var n = S.scenes.length;
    if (i >= n) return finale();
    S.phase = 'scene';
    S.index = i;
    setChrome(i);
    setProgress(i / n);
    if (S.markEl) S.markEl.classList.add('is-on');
    if (S.mode === 'steps') { placeMark(); return renderStep(i); }

    gsap.set(S.camera, { clearProps: 'transform,opacity,filter' });
    var scene = S.scenes[i];
    var el = h('div', 'dt-scene', null, S.camera);
    el.setAttribute('data-scene', scene.key || String(i));
    var built;
    try {
      built = scene.build(el, makeKit());
      if (!built || typeof built.duration !== 'function') throw new Error('build() must return a GSAP timeline');
    } catch (err) {
      warn('scene "' + (scene.key || i) + '" failed:', err && err.message ? err.message : err);
      el.remove();
      return enterScene(i + 1);
    }
    S.built++;
    Array.prototype.forEach.call(el.querySelectorAll('a[href], button'), function (x) { x.tabIndex = -1; });
    var last = i === n - 1;
    var start = 0.3;
    var dur = built.duration();
    var wrap = gsap.timeline({
      onUpdate: function () {
        if (!S || S.wrap !== wrap) return;
        var t = (wrap.time() - start) / (dur || 1);
        setProgress((i + Math.max(0, Math.min(1, t))) / n);
      }
    });
    wrap.fromTo(el, { opacity: 0, scale: 0.9, filter: 'blur(8px)' },
      { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' }, 0);
    wrap.add(built, start);
    if (last) {
      wrap.call(function () { if (S && S.wrap === wrap) finale(); }, null, start + dur);
    } else {
      wrap.to(el, { opacity: 0, scale: 1.15, filter: 'blur(8px)', duration: 0.6, ease: 'power2.in' }, start + dur);
      // Fly-through: the next scene starts while this one is still flying out.
      wrap.call(function () { if (S && S.wrap === wrap) advance(i, wrap, el); }, null, start + dur + 0.3);
    }
    S.wrap = wrap;
    S.sceneEl = el;
    S.sceneStart = start;
    S.sceneDuration = dur;
    track(wrap);
  }

  function advance(i, wrap, el) {
    S.retiring.push({ wrap: wrap, el: el });
    wrap.eventCallback('onComplete', function () {
      el.remove();
      if (S) S.retiring = S.retiring.filter(function (r) { return r.wrap !== wrap; });
    });
    S.wrap = null;
    S.sceneEl = null;
    enterScene(i + 1);
  }

  function goTo(i) {
    if (!S || S.closing) return;
    var n = S.scenes.length;
    if (S.mode === 'steps') {
      if (i >= n) return close('end');
      return renderStep(Math.max(0, i));
    }
    if (S.phase === 'finale' && i >= n) return;      // already at the end: keep the scene + CTA
    var cta = S.tour.cta;
    if (i >= n && cta && cta.keepScene && S.phase === 'scene' && S.wrap && S.index === n - 1) {
      // skipping past the last step: show it finished (its links are the finale)
      S.wrap.seek(S.sceneStart + S.sceneDuration, true);
      S.wrap.pause();
      return finale();
    }
    clearScenes();
    if (i >= n) return finale();
    enterScene(Math.max(0, i));
  }

  /* ---------- finale ---------- */
  function finale() {
    if (!S || S.closing) return;
    S.phase = 'finale';
    setProgress(1);
    if (!S.built) return close('error');
    var cta = S.tour.cta;
    if (!cta || !cta.label) return close('end');

    var keep = !!cta.keepScene;
    var fin = S.finaleEl = h('div', 'dt-finale' + (keep ? ' is-bottom' : ''), null, S.overlay);
    if (keep) {
      S.overlay.classList.add('dt-finale-on');
      if (S.stage) S.stage.removeAttribute('aria-hidden');          // its page links are real now
      if (S.sceneEl) Array.prototype.forEach.call(S.sceneEl.querySelectorAll('a.dt-page-link'),
        function (a) { a.removeAttribute('tabindex'); });
    }
    var btn = h('button', 'dt-cta', null, fin);
    btn.type = 'button';
    h('span', 'dt-cta-label', null, btn).textContent = cta.label;
    h('span', 'dt-cta-arrow', '→', btn).setAttribute('aria-hidden', 'true');
    btn.addEventListener('click', function () { close('cta'); });

    // A keep-scene finale is a page of links: it stays until the visitor acts.
    var tl = S.finaleTl = track(gsap.timeline({ onComplete: keep ? null : function () { close('end'); } }));
    if (S.camera && !keep) tl.to(S.camera, { opacity: 0.32, filter: 'blur(4px)', duration: 0.7, ease: 'power2.out' }, 0);
    var t0 = keep && S.mode === 'cinematic' && S.tour.signoff ? signoff(tl, fin, S.tour.signoff) : 0;
    tl.fromTo(btn, { opacity: 0, scale: 0.8, y: 24 },
      { opacity: 1, scale: 1, y: 0, duration: 0.8, ease: 'back.out(1.8)' }, t0 + 0.1);
    var kit = makeKit();
    if (typeof kit.burst === 'function') {
      tl.add(function () {
        if (!S || !btn.isConnected) return;
        var r = btn.getBoundingClientRect();
        try { track(kit.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 40 })); }
        catch (err) { warn('burst failed:', err && err.message); }
      }, t0 + 0.45);
    }
    if (!keep) tl.to({}, { duration: 6 });
    try { btn.focus({ preventScroll: true }); } catch (e) {}
  }

  // "A V² product": full-screen over the last screen, then it shrinks to the
  // left of the page grid (phones: just under the title) and stays there.
  // opts.left = free width (design units) left of the finale's content.
  function signoff(tl, fin, opts) {
    var dim = h('div', 'dt-so-dim', null, fin);
    var el = h('div', 'dt-signoff', '<span class="dt-so-w">A</span> <img class="dt-so-logo" src="' + LOGO +
      '" alt="V² (V Square)" decoding="async"> <span class="dt-so-w">product</span>', fin);
    el.setAttribute('aria-label', 'A V² (V Square) product');
    var target = null;
    function T() {
      if (target) return target;
      var vw = window.innerWidth, vh = window.innerHeight, W = el.offsetWidth, H = el.offsetHeight;
      var cv = S.canvas.getBoundingClientRect();
      var free = cv.left + (opts.left || 0) * S.scale;          // viewport left edge → the content
      if (S.layout === 'wide' && free >= 130) {
        var k = Math.min(free - 28, 300) / W;
        target = { x: free / 2 - vw / 2, y: (cv.top + cv.bottom) / 2 - vh / 2, k: k };
      } else {
        var hd = S.head.getBoundingClientRect();
        var th = Math.max(22, Math.min(40, cv.top - hd.bottom - 14));
        var k2 = th / H;
        target = { x: hd.left + W * k2 / 2 - vw / 2, y: hd.bottom + 7 + th / 2 - vh / 2, k: k2 };
      }
      return target;
    }
    gsap.set(el, { xPercent: -50, yPercent: -50 });
    tl.fromTo(dim, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0)
      .fromTo(el, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0)
      .to(el, { x: function () { return T().x; }, y: function () { return T().y; }, scale: function () { return T().k; },
        duration: 0.9, ease: 'power3.inOut' }, 1.9)
      .to(dim, { opacity: 0, duration: 0.7 }, 1.95);
    if (S.markEl) tl.to(S.markEl, { opacity: 0, duration: 0.3 }, 1.9);
    tl.add(function () { el.classList.add('is-docked'); }, 2.8);
    return 2.8;
  }

  /* ---------- steps view (reduced motion) ---------- */
  function renderStep(i) {
    var n = S.scenes.length;
    S.phase = 'scene';
    S.index = i;
    var sc = S.scenes[i];
    if (!S.stepsEl) {
      var card = S.stepsEl = h('div', 'dt-steps', null, S.overlay);
      S.stepTitle = h('h3', null, null, card);
      S.stepTitle.id = 'dt-title';
      S.stepText = h('p', null, null, card);
      var nav = h('div', 'dt-steps-nav', null, card);
      S.backBtn = button('dt-back', '← Back', nav);
      S.stepCount = h('span', 'dt-steps-count', null, nav);
      S.nextBtn = button('dt-next', 'Next →', nav);
      S.backBtn.addEventListener('click', function () { goTo(S.index - 1); });
      S.nextBtn.addEventListener('click', function () {
        var cta = S.tour.cta;
        if (S.index === S.scenes.length - 1 && cta && cta.label) close('cta');
        else goTo(S.index + 1);
      });
    }
    S.stepTitle.textContent = sc.title || '';
    S.stepText.textContent = sc.summary || '';
    S.backBtn.disabled = i === 0;
    var cta = S.tour.cta;
    S.nextBtn.textContent = i < n - 1 ? 'Next →' : (cta && cta.label ? cta.label : 'Done');
    S.stepCount.textContent = (i + 1) + ' / ' + n;
    setChrome(i);
    setProgress((i + 1) / n);
    track(gsap.fromTo([S.stepTitle, S.stepText], { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' }));
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (!S || S.closing) return;
    var t0 = e.target;
    if (t0 && t0 !== document.body && t0 !== document.documentElement && !S.overlay.contains(t0)) return;
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); close('skip'); return; }
    if (k === 'ArrowRight') { e.preventDefault(); goTo(S.index + 1); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); goTo(Math.max(0, S.index - 1)); return; }
    if (k === ' ' || k === 'Spacebar') {
      var t = e.target;
      if (t && t.closest && t.closest('button, a[href]')) return;      // let buttons and links activate
      e.preventDefault();
      if (S.paused) resume(); else pause();
      return;
    }
    if (k === 'Tab') trapFocus(e);
  }

  function trapFocus(e) {
    var items = Array.prototype.filter.call(S.overlay.querySelectorAll(
      'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"])'), function (b) {
      return b.offsetParent !== null;
    });
    if (!items.length) { e.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1];
    var active = document.activeElement;
    var inItems = items.indexOf(active) !== -1;           // the overlay itself counts as outside
    if (e.shiftKey && (active === first || !inItems)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !inItems)) { e.preventDefault(); first.focus(); }
  }

  /* ---------- transport ---------- */
  function pause() {
    if (!S) return;
    S.paused = true;
    liveTimelines().forEach(function (t) { t.pause(); });
    if (S.overlay) S.overlay.classList.add('dt-paused');
  }
  function resume() {
    if (!S) return;
    S.paused = false;
    liveTimelines().forEach(function (t) { t.resume(); });
    if (S.overlay) S.overlay.classList.remove('dt-paused');
  }
  function seek(seconds) {
    if (!S || !S.wrap) return;
    S.wrap.seek(S.sceneStart + Math.max(0, seconds));
  }

  /* ---------- closing ---------- */
  function close(reason) {
    if (!S || S.closing) return;
    var sess = S;
    sess.closing = true;
    if (reason === 'off') { setOff(); reason = 'skip'; }
    markSeen(sess.key);
    document.removeEventListener('keydown', sess.onKey, true);
    window.removeEventListener('resize', sess.onResize);
    if (sess.onPop) window.removeEventListener('popstate', sess.onPop);
    clearTimeout(sess.resizeTimer);
    sess.tls.forEach(kill);
    kill(sess.openTl);
    sess.retiring.forEach(function (r) { kill(r.wrap); });

    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      if (sess.overlay) sess.overlay.remove();
      (sess.inerted || []).forEach(function (el) { el.inert = false; });
      if (sess.pushed && !sess.popped && history.state && history.state.dtTour) {
        try {
          if (reason === 'link') {            // leaving the page: don't race a Back traversal
            var st = Object.assign({}, history.state); delete st.dtTour;
            history.replaceState(st, '', location.href);
          } else history.back();
        } catch (e) {}
      }
      var root = document.documentElement;
      root.classList.remove('dt-open');
      if (!root.getAttribute('class')) root.removeAttribute('class');
      root.style.overflow = sess.prevOverflow || '';
      var back = sess.prevFocus;
      if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') {
        try { back.focus({ preventScroll: true }); } catch (e) {}
      }
      S = null;
      if (reason === 'cta' && sess.tour.cta && typeof sess.tour.cta.action === 'function') {
        try { sess.tour.cta.action(); } catch (err) { warn('CTA action failed:', err && err.message); }
      }
      emit('deptour:close', { key: sess.key, reason: reason });
      sess.resolve(reason);
      if (reason === 'link' && sess.linkHref) {
        try { location.assign(sess.linkHref); } catch (e) {}
      }
    }
    try {
      if (sess.overlay && window.gsap) {
        gsap.to(sess.overlay, { opacity: 0, duration: 0.3, ease: 'power1.out', onComplete: done });
        setTimeout(done, 800);                 // safety net if the ticker is throttled
      } else { done(); }
    } catch (e) { done(); }
  }

  function state() {
    if (!S) {
      return { open: false, key: null, mode: null, sceneIndex: -1, sceneDuration: 0,
               progress: 0, layout: layoutFor(), phase: null, paused: false };
    }
    return { open: true, key: S.key, mode: S.mode, sceneIndex: S.index, sceneDuration: S.sceneDuration,
             progress: S.progress, layout: S.layout, phase: S.phase, paused: S.paused };
  }

  window.DepTour = {
    register: register,
    expect: expectTour,
    play: play,
    close: function (reason) { close(reason || 'skip'); },
    isOpen: function () { return !!S; },
    pause: pause,
    resume: resume,
    goTo: goTo,
    seek: seek,
    state: state
  };
})();
