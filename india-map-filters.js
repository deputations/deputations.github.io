/* india-map-filters.js — the home page's sidebar filters on the India map.
 *
 * Same dropdowns (shared/filter-controls.js), same rules and option counts
 * (shared/vacancy-filters.js) and the same saved selection: a filter chosen
 * on the home page is already applied when the map opens, and one changed
 * here is still set when the home page opens again (sessionStorage, this
 * tab). The map shows active vacancies only, so Status is not offered; it,
 * the home page's quick chips and its watchlist toggle are kept as they were
 * when the selection is saved back.
 *
 * india-map-view.js calls init() once the data is loaded and place() to put
 * the panel on the left (India), under the state's name (a state) or in a
 * sheet behind a Filters button (narrow screens). The sheet shows a row of
 * tabs and one filter at a time, so the map stays in view above it. A change
 * dispatches 'map:filtersChanged'; the view redraws with the new counts.
 */
(function () {
  'use strict';
  const F = window.DepFilters;
  if (!F || typeof createSingleSelect !== 'function' || typeof createMultiSelect !== 'function') return;

  const CARET = '<svg class="ms-caret" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const SEARCH_ICON = '<svg class="ms-search-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const SLIDERS_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2"/></svg>';

  // The sheet's tabs; each opens the filter groups with that data-group
  const TABS = [
    ['search', 'Search'], ['me', 'For me'], ['level', 'Pay Level'], ['ministry', 'Ministry'],
    ['org', 'Organisation'], ['orgType', 'Type'], ['location', 'Location'], ['region', 'Region'],
  ];

  // ----- Markup (the home page's sidebar dropdowns) -----
  function single(id, group, label, placeholder, aria) {
    return `<div class="filter-group" data-group="${group}">
        <label id="${id}Lbl">${label}</label>
        <div class="ms ss" id="${id}SS">
          <button type="button" class="ms-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}Lbl">
            <span class="ms-trigger-label">${placeholder}</span>${CARET}
          </button>
          <div class="ms-panel ss-panel" hidden>
            <ul class="ms-list ss-list" role="listbox" aria-label="${aria}"></ul>
          </div>
        </div>
      </div>`;
  }
  function multi(id, group, label, placeholder, searchPh, aria, hint) {
    return `<div class="filter-group" data-group="${group}">
        <label id="${id}Lbl">${label}</label>
        <div class="ms" id="${id}MS">
          <button type="button" class="ms-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}Lbl">
            <span class="ms-trigger-label">${placeholder}</span>${CARET}
          </button>
          <div class="ms-panel" hidden role="dialog" aria-label="${aria}">
            <header class="ms-panel-head">
              <div class="ms-search-wrap">${SEARCH_ICON}<input type="search" class="ms-search" placeholder="${searchPh}" aria-label="${searchPh}"></div>
              <button type="button" class="ms-close" data-ms-done aria-label="Close">${CLOSE_ICON}</button>
            </header>
            <p class="ms-hint">${hint}</p>
            <ul class="ms-list" role="listbox" aria-multiselectable="true" aria-label="${aria}"></ul>
            <div class="ms-empty" hidden>No matches</div>
            <footer class="ms-panel-foot">
              <span class="ms-count" data-ms-count>0 selected</span>
              <div class="ms-foot-actions">
                <button type="button" class="ms-action" data-ms-none>Clear all</button>
                <button type="button" class="ms-action ms-action--primary" data-ms-done>Done</button>
              </div>
            </footer>
          </div>
        </div>
      </div>`;
  }

  function build(host) {
    const panel = document.createElement('aside');
    panel.className = 'map-filter-panel';
    panel.id = 'mapFilterPanel';
    panel.setAttribute('aria-label', 'Filter vacancies');
    panel.dataset.tab = '';
    panel.innerHTML = `
      <div class="mfp-head">
        <h2 class="mfp-title">Filters</h2>
        <button type="button" class="text-btn mfp-clear" id="mfClear" hidden>Clear All</button>
        <button type="button" class="mfp-close" id="mfClose" aria-label="Close filters">${CLOSE_ICON}</button>
      </div>
      <div class="mfp-tabs" role="tablist" aria-label="Choose a filter">
        ${TABS.map(([id, label]) => `<button type="button" class="mfp-tab" role="tab" aria-selected="false" data-tab="${id}">${label}</button>`).join('')}
      </div>
      <div class="mfp-body">
        <div class="filter-group fg-search" data-group="search">
          <label for="mfSearch">Search</label>
          <div class="input-icon">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="text" id="mfSearch" placeholder="Search by post, dept, keywords…" autocomplete="off">
          </div>
        </div>
        ${single('mfMyPayLevel', 'me', 'Display deputations for me', 'Your Pay Level', 'Select your pay level')}
        ${single('mfExperience', 'me', 'My Years of Experience', 'Select Pay Level first', 'Select years of experience')}
        ${multi('mfLevel', 'level', 'Pay Level', 'All Levels', 'Search levels…', 'Select pay levels', 'Pick one or more levels · click again to deselect')}
        ${single('mfMinistry', 'ministry', 'Ministry', 'All Ministries', 'Select ministry')}
        ${multi('mfOrganisation', 'org', 'Organisation', 'All Organisations', 'Search organisations…', 'Select organisations', 'Pick one or more organisations · click again to deselect')}
        ${single('mfOrgType', 'orgType', 'Organisation Type', 'All Types', 'Select organisation type')}
        ${multi('mfLocation', 'location', 'Location', 'All Locations', 'Search locations…', 'Select locations', 'Click a location to select it · click again to deselect')}
        ${single('mfRegion', 'region', 'Region', 'All Regions', 'Select region')}
        <p class="mfp-note">The map shows active vacancies. Filters are shared with the home page.</p>
      </div>`;
    host.appendChild(panel);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mapFiltersBtn';
    btn.className = 'map-filters-btn';
    btn.setAttribute('aria-controls', 'mapFilterPanel');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `${SLIDERS_ICON}<span>Filters</span><span class="mfp-badge" hidden></span>`;
    host.appendChild(btn);
    return { panel, btn };
  }

  // ----- Controls -----
  const byId = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ctl = null, els = null, rows = [], orgIndex = { names: {}, short: {} }, kept = F.emptyState();
  let stateAbbr = null;
  const orgFull = (key) => {
    const name = orgIndex.names[key] || key;
    return (window.DepEnrich && window.DepEnrich.withAcronym) ? window.DepEnrich.withAcronym(name) : name;
  };
  const orgLabelHTML = (key) => {
    const full = orgFull(key);
    const short = orgIndex.short[key];
    if (!short || short === full) return esc(full);
    return `<span class="org-full">${esc(full)}</span><span class="org-short">${esc(short)}</span>`;
  };

  function makeControls() {
    return {
      search: byId('mfSearch'),
      myPayLevel: createSingleSelect(byId('mfMyPayLevelSS'), { placeholder: 'Your Pay Level' }),
      experience: createSingleSelect(byId('mfExperienceSS'), { placeholder: 'Any' }),
      level: createMultiSelect(byId('mfLevelMS'), {
        placeholder: 'All Levels', singularPattern: (v) => v, multiPattern: (n) => `${n} levels`,
      }),
      ministry: createSingleSelect(byId('mfMinistrySS'), { placeholder: 'All Ministries' }),
      org: createMultiSelect(byId('mfOrganisationMS'), {
        placeholder: 'All Organisations', multiPattern: (n) => `${n} organisations`,
        labelHTML: orgLabelHTML, searchText: (key) => `${orgFull(key)} ${orgIndex.short[key] || ''}`,
      }),
      orgType: createSingleSelect(byId('mfOrgTypeSS'), { placeholder: 'All Types' }),
      location: createMultiSelect(byId('mfLocationMS'), {
        placeholder: 'All Locations', singularPattern: (v) => v, multiPattern: (n) => `${n} locations`,
      }),
      region: createSingleSelect(byId('mfRegionSS'), { placeholder: 'All Regions' }),
    };
  }

  // The selection on screen, plus what this page doesn't offer (Status,
  // quick chips, watchlist) kept from the saved selection
  function current() {
    return Object.assign({}, kept, {
      search: ctl.search.value.trim(),
      myPayLevel: ctl.myPayLevel.value,
      experience: ctl.myPayLevel.value ? ctl.experience.value : '',
      levels: ctl.level.values,
      ministry: ctl.ministry.value,
      orgs: ctl.org.values,
      orgType: ctl.orgType.value,
      region: ctl.region.value,
      locations: ctl.location.values,
    });
  }

  // ----- Options with faceted "(N)" counts, as the home page builds them -----
  function populate(s) {
    const without = (facet) => rows.filter(r => F.matches(r, s, { exclude: facet, applyStatus: false }));
    const tally = (list, keyFn) => {
      const counts = {};
      list.forEach(r => { const k = keyFn(r); if (k) counts[k] = (counts[k] || 0) + 1; });
      return counts;
    };
    // Options with a match, plus whatever is selected (shown as "(0)")
    const withSelected = (counts, selected) => {
      [].concat(selected || []).forEach(v => { if (v && !(v in counts)) counts[v] = 0; });
      return counts;
    };
    const isEligible = window.DepEnrich && window.DepEnrich.isEligible;

    const myLevelRows = without('myPayLevel');
    ctl.myPayLevel.populate([{ value: '', name: 'Any Level', count: null }].concat(
      F.myPayLevelValues().map(v => ({
        value: v, name: `Level ${v}`,
        count: isEligible ? myLevelRows.filter(r => isEligible(r, v, '')).length : null,
      }))));

    const exp = [{ value: '', name: 'Any', count: null }];
    for (let y = 0; y <= 10; y++) {
      exp.push({ value: String(y), name: y === 10 ? '10+ years' : (y === 1 ? '1 year' : `${y} years`), count: null });
    }
    ctl.experience.populate(exp);

    const levelCounts = withSelected(tally(without('level'), r => F.safe(r.Level_Text)), s.levels);
    ctl.level.populate(Object.keys(levelCounts).sort(F.compareLevels), levelCounts);

    const ministryCounts = withSelected(tally(without('ministry'), r => F.safe(r.Ministry)), s.ministry);
    ctl.ministry.populate([{ value: '', name: 'All Ministries', count: null }].concat(
      Object.keys(ministryCounts).sort((a, b) => a.localeCompare(b))
        .map(m => ({ value: m, name: m, count: ministryCounts[m] }))));

    const orgCounts = withSelected(tally(without('organisation'), r => F.orgKey(r.Organisation)), s.orgs);
    ctl.org.populate(Object.keys(orgCounts).sort((a, b) => orgFull(a).localeCompare(orgFull(b))), orgCounts);

    const typeCounts = withSelected(tally(without('orgType'), r => F.safe(r.Organisation_Type)), s.orgType);
    ctl.orgType.populate([{ value: '', name: 'All Types', count: null }].concat(
      Object.keys(typeCounts).sort((a, b) => (typeCounts[b] - typeCounts[a]) || a.localeCompare(b))
        .map(t => ({ value: t, name: t, count: typeCounts[t] }))));

    const locCounts = withSelected(tally(without('location'), r => F.formatLocation(r)), s.locations);
    ctl.location.populate(Object.keys(locCounts).sort((a, b) => a.localeCompare(b)), locCounts);

    const regionCounts = withSelected(tally(without('region'), r => F.safe(r.Region)), s.region);
    ctl.region.populate([{ value: '', name: 'All Regions', count: null }].concat(
      Object.keys(regionCounts).sort((a, b) => {
        const ia = F.REGION_ORDER.indexOf(a), ib = F.REGION_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      }).map(r => ({ value: r, name: F.REGION_LABEL[r] || r, count: regionCounts[r] }))));
  }

  // Put a selection on the controls (options first, so it isn't dropped)
  function show(s) {
    populate(s);
    ctl.search.value = s.search || '';
    ctl.myPayLevel.value = s.myPayLevel || '';
    ctl.experience.value = s.myPayLevel ? (s.experience || '') : '';
    ctl.level.setValues(s.levels || []);
    ctl.ministry.value = s.ministry || '';
    ctl.org.setValues(s.orgs || []);
    ctl.orgType.value = s.orgType || '';
    ctl.location.setValues(s.locations || []);
    ctl.region.value = s.region || '';
    syncExperience();
  }

  // Years of experience only mean something with a pay level (as at home)
  function syncExperience() {
    if (ctl.myPayLevel.value) {
      ctl.experience.disabled = false;
      ctl.experience.setPlaceholder('Any');
    } else {
      if (ctl.experience.value) ctl.experience.value = '';
      ctl.experience.disabled = true;
      ctl.experience.setPlaceholder('Select Pay Level first');
    }
  }

  // The data layer counts only rows that pass; badge + Clear All follow
  function apply(s, notify) {
    const n = F.activeCount(s);
    if (window.IndiaMapData && window.IndiaMapData.setRowFilter) {
      window.IndiaMapData.setRowFilter(n ? (row => F.matches(row, s, { applyStatus: false })) : null);
    }
    els.panel.classList.toggle('has-filters', n > 0);
    byId('mfClear').hidden = n === 0;
    // A tab whose filter is set is marked, so a closed one still shows it
    const set = {
      search: !!s.search, me: !!s.myPayLevel, level: s.levels.length > 0, ministry: !!s.ministry,
      org: s.orgs.length > 0, orgType: !!s.orgType, location: s.locations.length > 0, region: !!s.region,
    };
    els.panel.querySelectorAll('.mfp-tab').forEach(b => b.classList.toggle('is-set', !!set[b.dataset.tab]));
    const badge = els.btn.querySelector('.mfp-badge');
    badge.hidden = n === 0;
    badge.textContent = String(n);
    if (notify) document.dispatchEvent(new CustomEvent('map:filtersChanged', { detail: { count: n } }));
  }

  function onChange() {
    syncExperience();
    const s = current();
    populate(s);
    F.save(s);
    apply(s, true);
  }

  // Geography belongs to map navigation, not the saved sidebar selection.
  // Keep selected options available at (0) when they have no local matches.
  function setState(abbr) {
    const next = abbr || null;
    if (!ctl || next === stateAbbr) return;
    stateAbbr = next;
    rows = window.IndiaMapData.getActiveRows(stateAbbr);
    populate(current());
  }

  // ----- Placement (called by the view) -----
  function place(opts) {
    if (!els) return;
    const p = els.panel;
    const sheet = opts.mode === 'sheet';
    p.classList.toggle('is-sheet', sheet);
    p.classList.toggle('is-left', opts.mode === 'left');
    p.classList.toggle('is-right', opts.mode === 'right');
    els.btn.hidden = !sheet;
    if (sheet) {
      ['left', 'right', 'top', 'width', 'maxHeight'].forEach(k => { p.style[k] = ''; });
      if (!p.classList.contains('open')) p.hidden = true;
      return;
    }
    setOpen(false);
    p.hidden = false;
    p.style.top = `${Math.round(opts.top)}px`;
    p.style.left = opts.mode === 'left' ? `${Math.round(opts.left)}px` : '';
    p.style.right = opts.mode === 'right' ? `${Math.round(opts.right)}px` : '';
    p.style.width = `${Math.round(opts.width)}px`;
    p.style.maxHeight = `${Math.max(120, Math.round(opts.maxHeight))}px`;
  }
  function setOpen(open) {
    const was = sheetOpen();
    els.panel.classList.toggle('open', open);
    els.btn.setAttribute('aria-expanded', String(open));
    if (els.panel.classList.contains('is-sheet')) els.panel.hidden = !open;
    if (sheetOpen() !== was) document.dispatchEvent(new CustomEvent('map:filterSheet', { detail: { open: !was } }));
  }
  function sheetOpen() {
    return els.panel.classList.contains('is-sheet') && !els.panel.hidden;
  }
  // The sheet shows one filter at a time: its tab's groups. The open tab
  // again closes it, leaving just the tabs.
  function setTab(id) {
    const tab = els.panel.dataset.tab === id ? '' : id;
    els.panel.dataset.tab = tab;
    els.panel.querySelectorAll('.mfp-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    els.panel.querySelectorAll('.mfp-body .filter-group').forEach(g => g.classList.toggle('is-current', g.dataset.group === tab));
    if (tab === 'search') ctl.search.focus();
    if (sheetOpen()) document.dispatchEvent(new CustomEvent('map:filterSheet', { detail: { open: true } }));
  }

  // ----- Start -----
  function init() {
    const host = byId('mapContainer');
    if (!host || els) return;
    els = build(host);
    ctl = makeControls();
    rows = (window.IndiaMapData && window.IndiaMapData.getActiveRows) ? window.IndiaMapData.getActiveRows() : [];
    orgIndex = F.buildOrgIndex(rows);

    // A link's own ?level=…&org=… wins; otherwise this tab's saved selection
    const fromUrl = new URLSearchParams(location.search);
    const start = F.hasFilterParams(fromUrl) ? F.fromParams(fromUrl) : (F.load() || F.emptyState());
    kept = start;
    show(start);
    apply(start, false);

    let typing = null;
    ctl.search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(onChange, 200); });
    ['myPayLevel', 'experience', 'level', 'ministry', 'org', 'orgType', 'location', 'region']
      .forEach(k => ctl[k].addEventListener('change', onChange));
    byId('mfClear').addEventListener('click', () => {
      const s = Object.assign(F.emptyState(), { status: kept.status, quick: kept.quick, watchlist: kept.watchlist });
      show(s);
      F.save(s);
      apply(s, true);
    });
    // An opened dropdown scrolls into view inside the panel
    els.panel.addEventListener('click', (e) => {
      const trigger = e.target.closest('.ms-trigger');
      if (!trigger) return;
      requestAnimationFrame(() => {
        const list = trigger.parentElement.querySelector('.ms-panel');
        if (list && !list.hidden) list.scrollIntoView({ block: 'nearest' });
      });
    });
    els.panel.querySelector('.mfp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.mfp-tab');
      if (!b) return;
      setTab(b.dataset.tab);
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    els.btn.addEventListener('click', () => setOpen(!els.panel.classList.contains('open')));
    byId('mfClose').addEventListener('click', () => { setOpen(false); els.btn.focus(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.panel.classList.contains('is-sheet') && els.panel.classList.contains('open')
          && !document.querySelector('.ms-panel:not([hidden])')) setOpen(false);
    });
  }

  window.IndiaMapFilters = {
    init, place, setState, current: () => (ctl ? current() : null),
    // The sheet's top edge while it is open, for the view to keep the map above it
    sheetTop: () => (els && sheetOpen() ? els.panel.getBoundingClientRect().top : null),
  };
})();
