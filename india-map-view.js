// ===== india-map-view.js =====
// Production India Map view — adapted from prototype map-view.js
// Integrates with alldeputations.com's existing DOM and data layer.

(() => {
  'use strict';

  // ---- state ----
  let mapInitialised = false;
  let viewMode = 'national'; // 'national' | 'state' | 'district'
  let selectedAbbr = null;
  let selectedDistrict = null;
  let generation = 0;
  let statesGeo = null;
  let districtsGeo = null;
  let projection = null;
  let particleSystem = null;
  let rafId = null;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---- projection (same as prototype) ----
  function computeProjection(features) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    features.forEach(f => {
      if (!f.geometry) return;
      const coords = flattenCoords(f.geometry);
      coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      });
    });
    if (!isFinite(minLon)) { minLon = 68; maxLon = 97; minLat = 6; maxLat = 36; }
    const lonRange = (maxLon - minLon) || 1;
    const latRange = (maxLat - minLat) || 1;
    const scale = Math.min(1000 / (lonRange * 1.04), 800 / (latRange * 1.04));
    const offsetX = (1000 - lonRange * scale) / 2;
    const offsetY = (800 + latRange * scale) / 2;
    projection = { minLon, maxLon, minLat, maxLat, scale, offsetX, offsetY };
  }

  function project(lon, lat) {
    if (!projection) return [500, 400];
    const p = projection;
    return [(lon - p.minLon) * p.scale + p.offsetX, p.offsetY - (lat - p.minLat) * p.scale];
  }

  function flattenCoords(geom) {
    const result = [];
    if (geom.type === 'Polygon') {
      geom.coordinates.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => {
        poly.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
      });
    }
    return result;
  }

  function hasRealExtent(ring) { return ring.length > 3 && ring.some(([x,y]) => Math.abs(x) > 0.01 || Math.abs(y) > 0.01); }

  function getPolygonCentroid(rings) {
    const coords = Array.isArray(rings[0]?.[0]) ? rings[0] : rings;
    const proj = coords.map(c => project(c[0], c[1]));
    const cx = proj.reduce((s, p) => s + p[0], 0) / proj.length;
    const cy = proj.reduce((s, p) => s + p[1], 0) / proj.length;
    return { x: cx, y: cy };
  }

  function getCentroid(geometry) {
    if (!geometry) return null;
    const coords = geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat().flat()
      : geometry.coordinates[0];
    if (!coords || !coords.length) return null;
    const proj = coords.map(c => project(c[0], c[1]));
    return {
      x: proj.reduce((s, p) => s + p[0], 0) / proj.length,
      y: proj.reduce((s, p) => s + p[1], 0) / proj.length,
    };
  }

  function polygonToPath(coords) {
    const pts = coords.map(c => project(c[0], c[1])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pts.length < 2) return '';
    return 'M ' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ') + ' Z';
  }

  function multiPolygonToPath(coords) {
    return coords.map(poly => {
      const pts = poly[0].map(c => project(c[0], c[1])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (pts.length < 2) return '';
      return 'M ' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ') + ' Z';
    }).join(' ');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- SVG builders ----
  function buildSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"
      preserveAspectRatio="xMidYMid meet" id="map-svg" role="img" aria-label="India map showing job counts">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="state-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g id="map-group">
        <g id="shapes-layer"></g>
        <g id="labels-layer"></g>
      </g>
    </svg>`;
  }

  function createPath(feature, className, id, count, ariaLabel) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = feature.geometry.type === 'MultiPolygon'
      ? multiPolygonToPath(feature.geometry.coordinates)
      : polygonToPath(feature.geometry.coordinates);
    path.setAttribute('d', d);
    path.setAttribute('class', className);
    if (id) path.setAttribute('id', id);
    path.dataset.count = count;
    path.setAttribute('role', 'button');
    path.setAttribute('aria-label', ariaLabel || '');
    path.setAttribute('tabindex', '0');
    return path;
  }

  function createText(x, y, content, className) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('class', className);
    text.setAttribute('text-anchor', 'middle');
    text.textContent = content;
    return text;
  }

  // ---- data helpers ----
  function getStateCount(abbr) {
    if (window.IndiaMapData) return IndiaMapData.getStateCount(abbr);
    return 0;
  }
  function getTotalCount() {
    if (window.IndiaMapData) return IndiaMapData.getTotal();
    return 0;
  }
  function getFiltered(abbr, filters) {
    if (window.IndiaMapData) return IndiaMapData.getFiltered(abbr, filters);
    return [];
  }
  function getListingsForDistrict(abbr, district) {
    if (window.IndiaMapData) return IndiaMapData.getListingsForDistrict(abbr, district);
    return [];
  }

  // ---- rendering ----
  function renderNationalMap(animate = true) {
    viewMode = 'national';
    selectedAbbr = null;
    selectedDistrict = null;
    resetViewBox();

    const shapesLayer = $('#shapes-layer');
    const labelsLayer = $('#labels-layer');
    if (!shapesLayer) return;
    shapesLayer.innerHTML = '';
    labelsLayer.innerHTML = '';

    if (!statesGeo) return;

    const data = window.IndiaMapData || {};
    const maxCount = Math.max(1, ...Object.values(data.stateCounts || {}));

    statesGeo.features.forEach((feature, idx) => {
      const abbr = feature.properties.abbr || '';
      const name = feature.properties.NAME_1 || feature.properties.name || abbr;
      const count = getStateCount(abbr);
      const cls = count === 0 ? 'ad-state empty-state' : 'ad-state';

      const path = createPath(feature, cls, abbr, count, `${name}: ${count} jobs`);
      if (animate) {
        path.style.opacity = '0';
        path.style.strokeDasharray = '800';
        path.style.strokeDashoffset = '800';
        setTimeout(() => {
          path.style.transition = 'opacity 0.5s ease, stroke-dashoffset 1s ease-out';
          path.style.opacity = '1';
          path.style.strokeDashoffset = '0';
        }, 50 + idx * 35);
      }
      path.addEventListener('click', (e) => onStateClick(abbr, name, e));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') onStateClick(abbr, name, e);
      });
      path.addEventListener('mouseenter', () => onStateHover(abbr, path));
      path.addEventListener('mouseleave', () => onStateLeave(path));
      shapesLayer.appendChild(path);

      // Label
      const centroid = getCentroid(feature.geometry);
      if (centroid && abbr.length <= 3) {
        const label = createText(centroid.x, centroid.y + 4, name || abbr, 'ad-state-label');
        label.setAttribute('fill', '#94a3b8');
        label.setAttribute('font-size', count > 20 ? '9' : count > 5 ? '8' : '7');
        labelsLayer.appendChild(label);

        if (count > 0) {
          const badge = createText(centroid.x, centroid.y - 8, String(count), 'ad-count-badge');
          badge.setAttribute('fill', '#22d3ee');
          badge.setAttribute('font-size', '8');
          badge.setAttribute('font-weight', '700');
          labelsLayer.appendChild(badge);
        }
      }
    });

    updateCounter();
    updateURL('national', null, null);
  }

  function onStateClick(abbr, name, event) {
    if (viewMode === 'state' && selectedAbbr === abbr) return;
    const gen = ++generation;
    burstParticles(event.clientX, event.clientY, 60);
    drillToState(abbr, name, gen);
  }

  async function drillToState(abbr, name, gen) {
    if (!districtsGeo) {
      try {
        const resp = await fetch('prototypes/india-map/geo/india-districts-all.geojson');
        if (resp.ok) districtsGeo = await resp.json();
      } catch (e) {
        console.warn('[map] districts geo load failed:', e);
      }
    }
    if (gen !== generation) return;

    // Cinematic zoom
    const svg = $('#map-svg');
    const vb = svg ? svg.viewBox.baseVal : { x: 0, y: 0, width: 1000, height: 800 };
    const stateCode = ABBR_TO_CODE[abbr] || abbr;
    const stateDistricts = (districtsGeo?.features || []).filter(f => f.properties.st_code === stateCode);
    let centroid = { x: 500, y: 400 };
    if (stateDistricts.length > 0) {
      const allCoords = stateDistricts.flatMap(f =>
        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat().flat() : f.geometry.coordinates[0]
      );
      centroid = getPolygonCentroid(allCoords);
    }
    const targetW = vb.width / 2.2;
    const targetH = vb.height / 2.2;
    const targetVB = {
      x: centroid.x - targetW / 2,
      y: centroid.y - targetH / 2,
      w: targetW,
      h: targetH
    };
    const startVB = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    await animateViewBox(svg, startVB, targetVB, 550);

    if (gen !== generation) return;
    renderStateMap(abbr, name);
    selectedAbbr = abbr;
    viewMode = 'state';
    $('#mapBackBtn').hidden = false;
    updateURL('state', abbr, null);
  }

  function animateViewBox(svg, start, target, duration) {
    return new Promise(resolve => {
      const vb = svg.viewBox.baseVal;
      const startTime = performance.now();
      function frame(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        vb.x = start.x + (target.x - start.x) * e;
        vb.y = start.y + (target.y - start.y) * e;
        vb.width = start.w + (target.w - start.w) * e;
        vb.height = start.h + (target.h - start.h) * e;
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function resetViewBox() {
    const svg = $('#map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    vb.x = 0; vb.y = 0; vb.width = 1000; vb.height = 800;
  }

  function renderStateMap(abbr, stateName) {
    const shapesLayer = $('#shapes-layer');
    const labelsLayer = $('#labels-layer');
    if (!shapesLayer) return;
    shapesLayer.innerHTML = '';
    labelsLayer.innerHTML = '';

    const stateCode = ABBR_TO_CODE[abbr] || abbr;
    const stateFeatures = (districtsGeo?.features || []).filter(f => f.properties.st_code === stateCode);

    stateFeatures.forEach((feature, idx) => {
      const geoName = feature.properties.district || `District ${idx}`;
      const count = getCountForDistrict(abbr, geoName);
      const cls = count === 0 ? 'ad-district empty-state' : 'ad-district';
      const path = createPath(feature, cls, `d-${idx}`, count, `${geoName}: ${count} jobs`);
      path.style.opacity = '0';
      setTimeout(() => {
        path.style.transition = 'opacity 0.4s ease';
        path.style.opacity = '1';
      }, 30 + idx * 25);
      path.addEventListener('click', (e) => onDistrictClick(abbr, geoName, count, e, path));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') onDistrictClick(abbr, geoName, count, e, path);
      });
      path.addEventListener('mouseenter', () => {
        path.setAttribute('filter', 'url(#state-glow)');
        showTooltip(geoName, count, abbr, path);
      });
      path.addEventListener('mouseleave', () => {
        path.removeAttribute('filter');
        hideTooltip();
      });
      shapesLayer.appendChild(path);

      const centroid = getCentroid(feature.geometry);
      if (centroid) {
        const label = createText(centroid.x, centroid.y + 3, geoName, 'ad-district-label');
        label.setAttribute('fill', '#94a3b8');
        label.setAttribute('font-size', '7');
        label.style.opacity = '0';
        labelsLayer.appendChild(label);
        setTimeout(() => { label.style.transition = 'opacity 0.3s'; label.style.opacity = '1'; }, 500 + idx * 20);

        if (count > 0) {
          const badge = createText(centroid.x, centroid.y - 7, String(count), 'ad-count-badge');
          badge.setAttribute('fill', '#a78bfa');
          badge.setAttribute('font-size', '7');
          badge.setAttribute('font-weight', '700');
          badge.style.opacity = '0';
          labelsLayer.appendChild(badge);
          setTimeout(() => { badge.style.transition = 'opacity 0.3s'; badge.style.opacity = '1'; }, 550 + idx * 20);
        }
      }
    });
  }

  function getCountForDistrict(abbr, districtName) {
    const listings = getListingsForDistrict(abbr, districtName);
    const seen = new Set();
    let count = 0;
    listings.forEach(l => { if (!seen.has(l.id)) { seen.add(l.id); count++; } });
    return count;
  }

  function onDistrictClick(abbr, districtName, count, event, pathEl) {
    selectedDistrict = districtName;
    viewMode = 'district';
    pathEl.style.animation = 'none';
    pathEl.offsetHeight;
    pathEl.style.animation = 'ad-pulse-ring 0.6s ease-out';
    updateURL('district', abbr, districtName);

    // Show listings in the production modal
    const listings = getListingsForDistrict(abbr, districtName);
    const seen = new Set();
    const unique = listings.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });

    const modalTitle = $('#modalTitle');
    const modalBody = $('#modalBody');
    const modal = $('#modal');
    if (modalTitle) modalTitle.textContent = `${unique.length} Vacancy${unique.length !== 1 ? 'ies' : ''} in ${districtName}`;
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="vacancy-card" style="animation-delay:${i * 50}ms">
          <div class="vacancy-card-title">${esc(l.title)}</div>
          <div class="vacancy-card-meta">
            ${l.ministry ? `<span>${esc(l.ministry)}</span>` : ''}
            ${l.payLevel ? `<span>Pay Level ${esc(l.payLevel)}</span>` : ''}
          </div>
          <div class="vacancy-card-footer">
            ${l.closingDate ? `<span class="close-date">Closes ${esc(l.closingDate)}</span>` : ''}
            <span class="status-badge active">Active</span>
          </div>
        </div>
      `).join('') || '<p>No vacancies found.</p>';
    }
    if (modal) modal.showModal();
  }

  // ---- back navigation ----
  function goBack() {
    if (viewMode === 'district') {
      closeModal();
      if (selectedAbbr) {
        drillToState(selectedAbbr, selectedAbbr, ++generation);
      } else {
        resetToNational();
      }
    } else if (viewMode === 'state') {
      resetToNational();
    }
  }

  function resetToNational() {
    const gen = ++generation;
    const svg = $('#map-svg');
    if (svg) {
      const vb = svg.viewBox.baseVal;
      const startVB = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      animateViewBox(svg, startVB, { x: 0, y: 0, w: 1000, h: 800 }, 400).then(() => {
        if (gen !== generation) return;
        renderNationalMap(true);
        $('#mapBackBtn').hidden = true;
        updateURL('national', null, null);
      });
    } else {
      renderNationalMap(true);
      $('#mapBackBtn').hidden = true;
    }
  }

  function closeModal() {
    const modal = $('#modal');
    if (modal) modal.close();
  }

  // ---- tooltip ----
  function showTooltip(name, count, abbr, pathEl) {
    const tooltip = $('#mapTooltip');
    if (!tooltip) return;
    const nameEl = $('#mapTooltipName');
    const countEl = $('#mapTooltipCount');
    const metaEl = $('#mapTooltipMeta');
    if (nameEl) nameEl.textContent = name;
    if (countEl) countEl.textContent = `${count} vacancy${count !== 1 ? 'ies' : ''}`;
    if (metaEl) metaEl.textContent = abbr;
    tooltip.hidden = false;
    tooltip.classList.add('visible');
    positionTooltip(pathEl);
  }

  function positionTooltip(pathEl) {
    const tooltip = $('#mapTooltip');
    if (!tooltip || !pathEl) return;
    const rect = pathEl.getBoundingClientRect();
    const wrapRect = $('#mapSvgWrap')?.getBoundingClientRect() || { left: 0, top: 0 };
    tooltip.style.left = (rect.left - wrapRect.left + rect.width / 2 - 80) + 'px';
    tooltip.style.top = (rect.top - wrapRect.top - 70) + 'px';
  }

  function hideTooltip() {
    const tooltip = $('#mapTooltip');
    if (tooltip) { tooltip.classList.remove('visible'); tooltip.hidden = true; }
  }

  // ---- counter ----
  function updateCounter() {
    const valEl = $('#mapCounterValue');
    if (valEl) valEl.textContent = getTotalCount().toLocaleString();
  }

  // ---- URL ----
  function updateURL(mode, abbr, district) {
    const url = new URL(location.href);
    if (mode === 'national') { url.search = ''; }
    else {
      url.search = `?view=${mode}${abbr ? '&state=' + abbr : ''}${district ? '&district=' + district : ''}`;
    }
    history.replaceState(null, '', url);
  }

  function restoreFromURL() {
    const params = new URLSearchParams(location.search);
    const mode = params.get('view');
    const abbr = params.get('state');
    const district = params.get('district');
    if (mode === 'state' && abbr) {
      drillToState(abbr, abbr, ++generation);
    } else if (mode === 'district' && abbr && district) {
      drillToState(abbr, abbr, ++generation).then(() => {
        setTimeout(() => {
          selectedDistrict = district;
          viewMode = 'district';
          const path = document.getElementById(abbr);
          if (path) onDistrictClick(abbr, district, getCountForDistrict(abbr, district), { clientX: 0, clientY: 0 }, path);
        }, 600);
      });
    }
  }

  // ---- particle burst ----
  function burstParticles(cx, cy, count) {
    const canvas = $('#particleCanvas');
    if (!canvas) return;
    if (!particleSystem) {
      particleSystem = {
        particles: [],
        init() {
          this.particles = [];
          for (let i = 0; i < 60; i++) {
            this.particles.push({
              x: Math.random() * canvas.width,
              y: Math.random() * canvas.height,
              vx: (Math.random() - 0.5) * 0.3,
              vy: (Math.random() - 0.5) * 0.3,
              r: Math.random() * 1.5 + 0.5,
              alpha: Math.random() * 0.4 + 0.1,
            });
          }
          this.animate();
        },
        burst(bx, by, n) {
          for (let i = 0; i < n; i++) {
            this.particles.push({
              x: bx, y: by,
              vx: (Math.random() - 0.5) * 6,
              vy: (Math.random() - 0.5) * 6,
              r: Math.random() * 2.5 + 1,
              alpha: 0.8,
              life: 1,
            });
          }
        },
        animate() {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          this.particles = this.particles.filter(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.life !== undefined) { p.life -= 0.02; p.alpha = p.life * 0.8; }
            p.vx *= 0.98; p.vy *= 0.98;
            if (p.life !== undefined && p.life <= 0) return false;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 211, 238, ${p.alpha})`;
            ctx.fill();
            return true;
          });
          rafId = requestAnimationFrame(() => this.animate());
        }
      };
    }
    const rect = canvas.getBoundingClientRect();
    particleSystem.burst(cx - rect.left, cy - rect.top, count);
  }

  // ---- main init ----
  window.initIndiaMap = async function() {
    if (mapInitialised) return;
    mapInitialised = true;

    const wrap = $('#mapSvgWrap');
    if (!wrap) return;
    wrap.innerHTML = buildSVG();

    // Load geometry
    try {
      const resp = await fetch('prototypes/india-map/geo/india-states.geojson');
      if (resp.ok) {
        statesGeo = await resp.json();
        computeProjection(statesGeo.features);
      }
    } catch (e) {
      console.error('[map] geometry load failed:', e);
    }

    // Load data
    if (window.IndiaMapData) {
      await IndiaMapData.load();
    }

    // Start particles
    const canvas = $('#particleCanvas');
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particleSystem = {
        particles: [],
        init() {
          this.particles = [];
          for (let i = 0; i < 70; i++) {
            this.particles.push({
              x: Math.random() * canvas.width,
              y: Math.random() * canvas.height,
              vx: (Math.random() - 0.5) * 0.4,
              vy: (Math.random() - 0.5) * 0.4,
              r: Math.random() * 1.2 + 0.3,
              alpha: Math.random() * 0.25 + 0.05,
            });
          }
          this.animate();
        },
        animate() {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Draw connections
          for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
              const dx = this.particles[i].x - this.particles[j].x;
              const dy = this.particles[i].y - this.particles[j].y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 120) {
                ctx.beginPath();
                ctx.moveTo(this.particles[i].x, this.particles[i].y);
                ctx.lineTo(this.particles[j].x, this.particles[j].y);
                ctx.strokeStyle = `rgba(34, 211, 238, ${0.06 * (1 - dist / 120)})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
              }
            }
          }
          this.particles.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 211, 238, ${p.alpha})`;
            ctx.fill();
          });
          rafId = requestAnimationFrame(() => this.animate());
        },
        burst(bx, by, n) {
          for (let i = 0; i < n; i++) {
            this.particles.push({
              x: bx, y: by,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              r: Math.random() * 2 + 0.8,
              alpha: 0.7,
              life: 1,
            });
          }
        }
      };
      particleSystem.init();
    }

    renderNationalMap(true);

    // Wire back button
    $('#mapBackBtn')?.addEventListener('click', goBack);

    // Wire filters
    $$('.map-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.map-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilter(btn.dataset.filter);
      });
    });

    // Wire zoom
    $('#zoomInBtn')?.addEventListener('click', () => zoomBy(1.3));
    $('#zoomOutBtn')?.addEventListener('click', () => zoomBy(0.7));
    $('#zoomResetBtn')?.addEventListener('click', () => { resetViewBox(); });

    // Wire modal close
    $('#closeModal')?.addEventListener('click', closeModal);
    $('#modal')?.addEventListener('click', (e) => {
      if (e.target === $('#modal')) closeModal();
    });

    // Restore deep link
    restoreFromURL();

    // Resize handler
    window.addEventListener('resize', () => {
      const canvas = $('#particleCanvas');
      if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    });
  };

  function applyFilter(filterType) {
    const shapesLayer = $('#shapes-layer');
    const labelsLayer = $('#labels-layer');
    if (!shapesLayer) return;
    const paths = shapesLayer.querySelectorAll('.ad-state');
    paths.forEach(path => {
      const abbr = path.id;
      const count = getStateCount(abbr);
      let visible = true;
      if (filterType === 'functional') {
        const filtered = getFiltered(abbr, { functional: 'functional' });
        visible = filtered.length > 0;
      } else if (filterType === 'education') {
        const filtered = getFiltered(abbr, { education: 'education' });
        visible = filtered.length > 0;
      }
      path.style.opacity = visible ? '1' : '0.12';
    });
  }

  function zoomBy(factor) {
    const svg = $('#map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    const newW = vb.width / factor;
    const newH = vb.height / factor;
    vb.x = cx - newW / 2;
    vb.y = cy - newH / 2;
    vb.width = newW;
    vb.height = newH;
  }

  // ---- state abbr map (for districts lookup) ----
  const ABBR_TO_CODE = {
    'JK':'01','HP':'02','PB':'03','CH':'04','UT':'05','HR':'06','DL':'07','RJ':'08',
    'UP':'09','BR':'10','SK':'11','AR':'12','NL':'13','MN':'14','MZ':'15','TR':'16',
    'ML':'17','AS':'18','WB':'19','JH':'20','OD':'21','CG':'22','MP':'23','GJ':'24',
    'DD':'25','DN':'26','MH':'27','AP':'28','KA':'29','GA':'30','LD':'31','KL':'32',
    'TN':'33','PY':'34','AN':'35','TS':'36'
  };

  // ---- CSS injection ----
  function injectStyles() {
    if (document.getElementById('india-map-styles')) return;
    const style = document.createElement('style');
    style.id = 'india-map-styles';
    style.textContent = `
      #map-view { display: flex; flex-direction: column; height: 100vh; width: 100vw; background: transparent; }
      .map-container { position: relative; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      #mapSvgWrap { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; }
      #mapSvgWrap svg { width: 100%; height: 100%; max-height: 75vh; }
      .ad-state { transition: opacity 0.3s ease, filter 0.2s ease; cursor: pointer; }
      .ad-state:hover { filter: url(#state-glow); }
      .ad-state.empty-state { opacity: 0.2; }
      .ad-state-label { font-family: "Plus Jakarta Sans", sans-serif; pointer-events: none; user-select: none; }
      .ad-district-label { font-family: "Plus Jakarta Sans", sans-serif; pointer-events: none; user-select: none; }
      .ad-count-badge { font-family: "Sora", sans-serif; pointer-events: none; user-select: none; }
      .map-particles { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
      .map-header { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; gap: 16px; }
      .map-back-btn { display: flex; align-items: center; gap: 8px; background: rgba(148,163,184,0.08); border: 1px solid rgba(148,163,184,0.15); color: #94a3b8; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-size: 13px; font-family: "Plus Jakarta Sans", sans-serif; transition: all 0.2s; }
      .map-back-btn:hover { background: rgba(148,163,184,0.15); color: #f8fafc; }
      .map-title h2 { font-family: "Sora", sans-serif; font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0; }
      .map-subtitle { font-size: 12px; color: #64748b; margin: 0; }
      .map-counter { display: flex; flex-direction: column; align-items: center; padding: 10px 18px; border-radius: 14px; background: rgba(15,23,42,0.7); border: 1px solid rgba(34,211,238,0.2); }
      .map-counter-label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
      .map-counter-value { font-family: "Sora", sans-serif; font-size: 22px; font-weight: 800; color: #22d3ee; }
      .map-tooltip { position: absolute; z-index: 10; padding: 12px 16px; border-radius: 12px; background: rgba(15,23,42,0.92); border: 1px solid rgba(34,211,238,0.25); backdrop-filter: blur(12px); pointer-events: none; opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
      .map-tooltip.visible { opacity: 1; transform: translateY(0); }
      .map-tooltip-name { font-family: "Sora", sans-serif; font-size: 14px; font-weight: 700; color: #f8fafc; }
      .map-tooltip-count { font-size: 12px; color: #22d3ee; margin-top: 2px; }
      .map-tooltip-meta { font-size: 10px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
      .map-controls { position: relative; z-index: 2; display: flex; justify-content: space-between; align-items: center; padding: 10px 24px; gap: 12px; }
      .map-filters { display: flex; gap: 6px; }
      .map-filter-btn { padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.12); background: rgba(15,23,42,0.5); color: #64748b; font-size: 12px; font-family: "Plus Jakarta Sans", sans-serif; cursor: pointer; transition: all 0.2s; }
      .map-filter-btn.active { background: rgba(34,211,238,0.12); border-color: rgba(34,211,238,0.3); color: #22d3ee; }
      .map-filter-btn:hover { color: #f8fafc; }
      .map-zoom-controls { display: flex; gap: 4px; }
      .map-zoom-btn { width: 34px; height: 34px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.12); background: rgba(15,23,42,0.5); color: #94a3b8; font-size: 16px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
      .map-zoom-btn:hover { background: rgba(34,211,238,0.1); color: #22d3ee; border-color: rgba(34,211,238,0.3); }
      .map-drilldown { position: absolute; right: 0; top: 0; bottom: 0; width: 380px; max-width: 90vw; background: rgba(10,15,30,0.95); border-left: 1px solid rgba(148,163,184,0.12); backdrop-filter: blur(20px); z-index: 20; transform: translateX(100%); transition: transform 0.35s cubic-bezier(0.4,0,0.2,1); overflow-y: auto; }
      .map-drilldown.open { transform: translateX(0); }
      .map-drilldown-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid rgba(148,163,184,0.1); }
      .map-drilldown-header h3 { font-family: "Sora", sans-serif; font-size: 16px; color: #f8fafc; margin: 0; }
      .map-drilldown-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.12); background: transparent; color: #94a3b8; font-size: 18px; cursor: pointer; transition: all 0.2s; }
      .map-drilldown-close:hover { background: rgba(244,63,94,0.1); color: #f43f5e; border-color: rgba(244,63,94,0.3); }
      .map-drilldown-content { padding: 16px 24px; }
      .vacancy-card { padding: 16px; border-radius: 12px; background: rgba(30,41,59,0.5); border: 1px solid rgba(148,163,184,0.08); margin-bottom: 10px; opacity: 0; transform: translateY(8px); animation: cardIn 0.35s ease-out forwards; }
      .vacancy-card-title { font-family: "Sora", sans-serif; font-size: 14px; font-weight: 600; color: #f8fafc; margin-bottom: 6px; }
      .vacancy-card-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
      .vacancy-card-meta span { font-size: 11px; color: #64748b; }
      .vacancy-card-footer { display: flex; justify-content: space-between; align-items: center; }
      .close-date { font-size: 11px; color: #f59e0b; }
      .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
      .status-badge.active { background: rgba(34,197,94,0.12); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
      @keyframes cardIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes ad-pulse-ring {
        0% { stroke-opacity: 0.8; stroke-width: 2; }
        100% { stroke-opacity: 0; stroke-width: 8; }
      }
      /* Vacancy modal overrides for map context */
      .vxd { background: rgba(10,15,30,0.95); border: 1px solid rgba(148,163,184,0.15); }
      .vxd .modal-content { background: rgba(15,23,42,0.98); }
    `;
    document.head.appendChild(style);
  }

  // ---- boot ----
  injectStyles();
})();
