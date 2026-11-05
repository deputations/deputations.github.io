/* ============================================================
   tour/scenes/map.js — India map helpers + the map teaser scene.

   Draws the pre-baked map (tour/tour-map.json) as a glowing
   "hologram table", dives into a state by animating the SVG
   viewBox (vector-crisp at any zoom), raises that state's
   districts and drops a pin with a light beam.

   DepTourMap.load() must resolve before a scene using the map is
   built; tour/scenes/home.js awaits it before registering.

   Design: docs/superpowers/specs/2026-11-04-site-tour-design.md §3
   ============================================================ */
(function () {
  'use strict';
  if (window.DepTourMap) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var FOCUS_DISTRICT = 'Bengaluru Urban';
  var loading = null;

  function load() {
    if (api.data) return Promise.resolve(api.data);
    if (!loading) {
      loading = fetch('/tour/tour-map.json?v=1', { credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error('tour-map.json HTTP ' + r.status);
          return r.json();
        })
        .then(function (json) { api.data = json; return json; });
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function box(str) { return String(str).trim().split(/\s+/).map(Number); }
  function mix(a, b, t) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }); }
  function heatColour(t) {
    var low = [16, 74, 104], mid = [34, 211, 238], high = [167, 139, 250];
    var c = t < 0.5 ? mix(low, mid, t / 0.5) : mix(mid, high, (t - 0.5) / 0.5);
    return 'rgb(' + c.join(',') + ')';
  }

  /* ---------- the map ---------- */
  // box (optional, scene units): where the map goes; default fills the stage.
  function drawIndia(parent, data, kit, box) {
    var tall = kit.layout === 'tall';
    var margin = tall ? { x: 10, top: 64, bottom: 56 } : { x: 20, top: 10, bottom: 10 };
    if (box) margin = { x: box.x, top: box.y };
    var vw = box ? box.w : kit.width - margin.x * 2;
    var vh = box ? box.h : kit.height - margin.top - margin.bottom;
    var INSET = 0.05;                                   // map sits inside the plane's soft-faded edges
    var sw = vw * (1 - 2 * INSET), sh = vh * (1 - 2 * INSET);

    var el = kit.el('div', 'dt-map-view', null, parent);
    Object.assign(el.style, { left: margin.x + 'px', top: margin.top + 'px', width: vw + 'px', height: vh + 'px' });
    kit.el('div', 'dt-map-floor', null, el);
    var plane = kit.el('div', 'dt-map-plane', null, el);
    var svg = svgEl('svg', { viewBox: data.viewBox, preserveAspectRatio: 'xMidYMid meet',
                             width: sw, height: sh, class: 'dt-map-svg', 'aria-hidden': 'true' }, plane);
    Object.assign(svg.style, { left: (vw * INSET) + 'px', top: (vh * INSET) + 'px' });
    var defs = svgEl('defs', null, svg);
    var beam = svgEl('linearGradient', { id: 'dt-beam-grad', x1: '0', y1: '1', x2: '0', y2: '0' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#a5f3fc', 'stop-opacity': '0.95' }, beam);
    svgEl('stop', { offset: '1', 'stop-color': '#a78bfa', 'stop-opacity': '0' }, beam);

    var gStates = svgEl('g', { class: 'dt-states', 'stroke-width': '1.1' }, svg);
    var states = new Map();
    data.states.forEach(function (s) {
      var p = svgEl('path', { d: s.d, class: 'dt-state', 'data-abbr': s.abbr, pathLength: '1' }, gStates);
      states.set(s.abbr, p);
    });
    var gDistricts = svgEl('g', { class: 'dt-districts', 'stroke-width': '0.3' }, svg);
    var gMarks = svgEl('g', { class: 'dt-marks' }, svg);
    var scan = kit.el('div', 'dt-map-scan', null, plane);

    var view = { el: el, plane: plane, svg: svg, states: states, gStates: gStates,
                 gDistricts: gDistricts, gMarks: gMarks, data: data, width: sw, height: sh,
                 unitsPerPx: 1000 / Math.min(sw, sh * 1.25) };

    // Heat glow, hotspots on the busiest states.
    var heat = kit.sample.heat;
    var max = Math.max.apply(null, Object.keys(heat).map(function (k) { return heat[k]; }));
    var paths = Array.from(states.values());
    gsap.set(paths, { strokeDasharray: 1, strokeDashoffset: 1, fillOpacity: 0 });
    var hot = data.states.slice().sort(function (a, b) { return (heat[b.abbr] || 0) - (heat[a.abbr] || 0); })
      .slice(0, tall ? 4 : 6)
      .map(function (s) {
        var g = svgEl('g', { class: 'dt-hot', transform: 'translate(' + s.cx + ',' + s.cy + ')' }, gMarks);
        svgEl('circle', { r: '14', class: 'dt-hot-ring' }, g);
        svgEl('circle', { r: '4.5', class: 'dt-hot-core' }, g);
        return g;
      });

    var tl = gsap.timeline();
    tl.fromTo(plane, { opacity: 0, scale: 0.94, rotationX: 0 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power2.out' }, 0)
      .to(paths, { strokeDashoffset: 0, duration: 1.3, ease: 'power2.inOut', stagger: 0.02 }, 0.1);
    paths.forEach(function (p, i) {
      var t = Math.log(1 + (heat[p.getAttribute('data-abbr')] || 0)) / Math.log(1 + max);
      p.style.fill = p._dtColour = heatColour(t);
      p._dtOpacity = 0.22 + 0.62 * t;
      tl.to(p, { fillOpacity: p._dtOpacity, duration: 0.8, ease: 'power1.out' }, 1.15 + i * 0.012);
    });
    view.baseUnits = view.unitsPerPx;
    tl.to(plane, { rotationX: 28, duration: 1.5, ease: 'power2.inOut' }, 1.3)
      .fromTo(hot, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.09, ease: 'power1.out' }, 2.0)
      .fromTo(scan, { yPercent: -120, opacity: 0 }, { yPercent: 320, opacity: 0.9, duration: 1.5, ease: 'power1.inOut' }, 2.1)
      .to(scan, { opacity: 0, duration: 0.3 }, 3.3);

    view.hot = hot;
    view.tl = tl;
    return view;
  }

  function diveTo(view, abbr, kit) {
    var b;
    if (view.data.focus && view.data.focus.abbr === abbr) b = box(view.data.focus.viewBox);
    else {
      var bb = view.states.get(abbr).getBBox();
      b = [bb.x, bb.y, bb.width, bb.height];
    }
    var cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    var aspect = view.width / view.height;
    var w = b[2] / 0.7, h = b[3] / 0.7;                // the state fills ~70 % of the view
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    var target = [cx - w / 2, cy - h / 2, w, h];
    view.unitsPerPx = w / view.width;

    var chosen = view.states.get(abbr);
    var others = Array.from(view.states.values()).filter(function (p) { return p !== chosen; });
    var tl = gsap.timeline();
    tl.to(view.plane, { rotationX: 0, duration: 1.7, ease: 'power3.inOut' }, 0)
      .to(view.svg, { attr: { viewBox: target.map(function (v) { return v.toFixed(2); }).join(' ') },
                      duration: 1.9, ease: 'power3.inOut' }, 0)
      .to(view.gStates, { attr: { 'stroke-width': (1.1 * w / 1000).toFixed(3) }, duration: 1.9, ease: 'power3.inOut' }, 0)
      .to(others, { fillOpacity: 0.08, strokeOpacity: 0.3, duration: 1.2, ease: 'power1.out' }, 0.2)
      .to(view.hot, { opacity: 0, duration: 0.5 }, 0)
      .to(chosen, { fill: '#22d3ee', fillOpacity: 0.32, duration: 1, ease: 'power1.out' }, 0.5)
      .add(kit.camera({ z: 1.04, ry: -4 }, { duration: 1.9, ease: 'power3.inOut' }), 0);
    view.focusAbbr = abbr;
    return tl;
  }

  function raiseDistricts(view, data, kit) {
    var paths = data.focus.districts.map(function (d) {
      return svgEl('path', { d: d.d, class: 'dt-district', 'data-name': d.name || '' }, view.gDistricts);
    });
    view.districts = paths;
    var lift = 6 * view.unitsPerPx;
    gsap.set(paths, { opacity: 0, y: lift });
    return gsap.timeline()
      .to(paths, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.03 }, 0)
      .to(view.states.get(view.focusAbbr || data.focus.abbr), { fillOpacity: 0.1, duration: 0.6 }, 0);
  }

  function pin(view, x, y, kit) {
    var u = view.unitsPerPx;                            // keep the pin a constant on-screen size
    var g = svgEl('g', { class: 'dt-pin', transform: 'translate(' + x + ',' + y + ')' }, view.gMarks);
    var bw = 10 * u, bh = 150 * u;
    var beamRect = svgEl('rect', { class: 'dt-beam', x: -bw / 2, y: -bh, width: bw, height: bh, fill: 'url(#dt-beam-grad)' }, g);
    var shadow = svgEl('ellipse', { class: 'dt-pin-shadow', cx: 0, cy: 0, rx: 9 * u, ry: 3.2 * u }, g);
    var ring = svgEl('circle', { class: 'dt-pin-ring', cx: 0, cy: 0, r: 6 * u }, g);
    var head = svgEl('path', {
      class: 'dt-pin-head',
      d: 'M0,0 C' + (-4 * u) + ',' + (-9 * u) + ' ' + (-11 * u) + ',' + (-14 * u) + ' ' + (-11 * u) + ',' + (-22 * u) +
         ' A' + (11 * u) + ',' + (11 * u) + ' 0 1 1 ' + (11 * u) + ',' + (-22 * u) +
         ' C' + (11 * u) + ',' + (-14 * u) + ' ' + (4 * u) + ',' + (-9 * u) + ' 0,0 Z'
    }, g);
    svgEl('circle', { class: 'dt-pin-eye', cx: 0, cy: -22 * u, r: 4 * u }, g);
    var eye = g.lastChild;
    var tl = gsap.timeline();
    tl.fromTo([head, eye], { y: -60 * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'bounce.out' }, 0)
      .fromTo(shadow, { opacity: 0, scale: 0.3, transformOrigin: '50% 50%' }, { opacity: 0.8, scale: 1, duration: 0.6 }, 0.25)
      .fromTo(beamRect, { scaleY: 0, opacity: 0, transformOrigin: '50% 100%' }, { scaleY: 1, opacity: 1, duration: 0.9, ease: 'power3.out' }, 0.55)
      .fromTo(ring, { scale: 0.4, opacity: 0.9, transformOrigin: '50% 50%' }, { scale: 3.2, opacity: 0, duration: 1.1, ease: 'power2.out' }, 0.7);
    return tl;
  }

  /* ---------- the teaser scene (Home, step 3) ---------- */
  // Recolour every state for a new set of counts (e.g. after a filter).
  function recolour(view, heat, kit) {
    var keys = Object.keys(heat);
    var max = Math.max.apply(null, keys.map(function (k) { return heat[k]; }).concat([1]));
    var tl = gsap.timeline();
    if (view.hot) tl.to(view.hot, { opacity: 0, duration: 0.3 }, 0);
    Array.from(view.states.values()).forEach(function (p, i) {
      var t = Math.log(1 + (heat[p.getAttribute('data-abbr')] || 0)) / Math.log(1 + max);
      p._dtColour = heatColour(t);
      p._dtOpacity = 0.12 + 0.72 * t;
      tl.to(p, { fill: p._dtColour, fillOpacity: p._dtOpacity, duration: 0.7, ease: 'power2.inOut' }, 0.05 + i * 0.01);
    });
    return tl;
  }

  // Fly back out to the whole of India (the page's "Back to India").
  function flyOut(view, kit) {
    var paths = Array.from(view.states.values());
    var tl = gsap.timeline();
    tl.to(view.svg, { attr: { viewBox: view.data.viewBox }, duration: 1.6, ease: 'power3.inOut' }, 0)
      .to(view.gStates, { attr: { 'stroke-width': 1.1 }, duration: 1.6, ease: 'power3.inOut' }, 0)
      .to(view.districts || [], { opacity: 0, duration: 0.5, ease: 'power1.out' }, 0)
      .to(view.gMarks.querySelectorAll('.dt-pin'), { opacity: 0, duration: 0.3 }, 0)
      .add(kit.camera({ z: 1, ry: 0 }, { duration: 1.6, ease: 'power3.inOut' }), 0)
      .to(view.plane, { rotationX: 28, duration: 1.4, ease: 'power2.inOut' }, 0.3);
    paths.forEach(function (p) {
      tl.to(p, { fill: p._dtColour || '#0b2233', fillOpacity: p._dtOpacity == null ? 0.5 : p._dtOpacity,
                 strokeOpacity: 1, duration: 1.0, ease: 'power1.out' }, 0.4);
    });
    view.unitsPerPx = view.baseUnits || view.unitsPerPx;
    view.focusAbbr = null;
    return tl;
  }

  var teaserScene = {
    key: 'mapTeaser',
    label: 'STEP 3',
    title: "See India's vacancies on a map",
    summary: 'Open the India Map to see vacancies state by state and district by district.',
    build: function (stage, kit) {
      var data = api.data;
      if (!data) throw new Error('map data not loaded');
      var tall = kit.layout === 'tall';
      var s = kit.sample;
      var tl = gsap.timeline();
      var view = drawIndia(stage, data, kit);
      tl.add(view.tl, 0);

      var count = kit.el('div', 'dt-chip dt-map-count',
        '<span class="dt-chip-k">Sample vacancies</span><b class="dt-chip-v"></b>', stage);
      Object.assign(count.style, tall ? { left: '16px', top: '8px' } : { left: '28px', top: '26px' });
      tl.fromTo(count, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 1.5)
        .add(kit.odometer(count.querySelector('.dt-chip-v'), 0, s.total, { duration: 1.7 }), 1.6);

      var ka = view.states.get(data.focus.abbr);
      tl.add(kit.cursorTo(ka, { duration: 0.9 }), 3.3)
        .add(kit.tap(ka), 4.25);
      // The cursor lives in screen space, so it fades out while the map dives
      // under it; the next cursorTo() brings it back.
      var cursorBits = Array.prototype.slice.call(document.querySelectorAll('.dt-cursor, .dt-trail'));
      if (cursorBits.length) tl.to(cursorBits, { opacity: 0, duration: 0.35, ease: 'power1.out' }, 4.75);
      tl
        .to(count, { opacity: 0, y: -12, duration: 0.4, ease: 'power1.in' }, 4.5)
        .add(diveTo(view, data.focus.abbr, kit), 4.5);

      var stateChip = kit.el('div', 'dt-chip dt-map-state',
        '<span class="dt-chip-k">' + data.focus.state + '</span><b>' + (s.heat[data.focus.abbr] || 0) + '</b><span class="dt-chip-k">sample posts</span>', stage);
      Object.assign(stateChip.style, tall ? { left: '16px', top: '8px' } : { left: '28px', top: '26px' });
      tl.fromTo(stateChip, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power2.out' }, 6.2)
        .add(raiseDistricts(view, data, kit), 6.2);

      var bu = data.focus.districts.filter(function (d) { return d.name === FOCUS_DISTRICT; })[0];
      var buPath = view.districts.filter(function (p) { return p.getAttribute('data-name') === FOCUS_DISTRICT; })[0];
      tl.add(kit.cursorTo(buPath, { duration: 0.7 }), 7.1)
        .add(kit.tap(buPath), 7.8)
        .to(buPath, { fill: '#a78bfa', fillOpacity: 0.85, duration: 0.5, ease: 'power1.out' }, 7.85)
        .add(pin(view, bu.cx, bu.cy, kit), 7.95);

      var dChip = kit.el('div', 'dt-chip dt-map-district',
        '<span class="dt-dot"></span><b>' + FOCUS_DISTRICT + '</b><span class="dt-chip-k">24 posts in this district</span>', stage);
      Object.assign(dChip.style, tall ? { left: '50%', bottom: '10px' } : { left: '50%', bottom: '22px' });
      tl.fromTo(dChip, { opacity: 0, y: 16, xPercent: -50 }, { opacity: 1, y: 0, xPercent: -50, duration: 0.6, ease: 'back.out(1.6)' }, 8.6)
        .to({}, { duration: 1.2 });
      return tl;
    }
  };

  var api = {
    data: null,
    load: load,
    drawIndia: drawIndia,
    diveTo: diveTo,
    raiseDistricts: raiseDistricts,
    pin: pin,
    recolour: recolour,
    flyOut: flyOut,
    heatColour: heatColour,
    teaserScene: teaserScene
  };
  window.DepTourMap = api;
})();
