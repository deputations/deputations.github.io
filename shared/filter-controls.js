/* shared/filter-controls.js — the dashboard's filter dropdown widgets
 * (createMultiSelect / createSingleSelect) and their helpers, shared by the
 * home page (app.js) and the India map (india-map-filters.js). Plain globals,
 * loaded before either page script. Moved verbatim from the top of app.js. */

// Shared open/close positioning for the filter dropdowns.
//  • elevates the (sticky → own stacking context) sidebar so the open panel
//    paints OVER the page content and the visitor counter, not behind them;
//  • flips the panel upward when there isn't room below (desktop only).
function flipIfNeeded(root, trigger, panel) {
  const desktop = window.innerWidth > 768;
  const sb = root && root.closest && root.closest('.filters-sidebar');
  if (sb && desktop) sb.classList.add('ms-elevated');
  if (!desktop) { panel.classList.remove('ms-open-up'); return; }
  const tr = trigger.getBoundingClientRect();
  const ph = panel.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - tr.bottom;
  panel.classList.toggle('ms-open-up', spaceBelow < ph + 12 && tr.top > spaceBelow);
}
function dropElevation() {
  // remove elevation once nothing is open (defer so the just-closed panel counts as hidden)
  setTimeout(() => {
    if (!document.querySelector('.ms-panel:not([hidden])')) {
      document.querySelectorAll('.filters-sidebar.ms-elevated')
        .forEach(s => s.classList.remove('ms-elevated'));
    }
  }, 0);
}

// Inline SVG sprite reference (symbols live in index.html — no icon CDN).
function svgIcon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// ----- Multi-select widget (popover + checkbox list) ---------------------
// Returns a controller that mirrors enough of a <select>'s surface area
// (`.value`, `.value = ''`, `addEventListener('change', …)`) plus multi-value
// helpers (`.values`, `.setValues(arr)`, `.populate(arr)`).
function createMultiSelect(root, opts = {}) {
  const trigger = root.querySelector('.ms-trigger');
  const label   = root.querySelector('.ms-trigger-label');
  const panel   = root.querySelector('.ms-panel');
  const search  = root.querySelector('.ms-search');
  const list    = root.querySelector('.ms-list');
  const empty   = root.querySelector('.ms-empty');
  const noneBtn = root.querySelector('[data-ms-none]');
  const doneBtns = root.querySelectorAll('[data-ms-done]');
  const countEl = root.querySelector('[data-ms-count]');

  const placeholder    = opts.placeholder || 'All';
  const singularPattern = opts.singularPattern || ((v) => v);
  const multiPattern    = opts.multiPattern    || ((n) => `${n} selected`);
  // Optional: an option's displayed label (HTML) and the text the panel's search
  // box matches against, when they differ from the raw value (e.g. Organisation:
  // value = full name, label = "Full Name (ACR)" / "ACR" by screen width).
  const labelHTML  = opts.labelHTML  || null;
  const searchText = opts.searchText || ((v) => v);
  const changeListeners = [];

  let items = [];
  let selected = new Set();
  let countMap = {};   // optional { value: number } → renders a gradient "(N)"

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
  }
  function countHTML(v) {
    const c = countMap[v];
    return c == null ? '' : `<span class="ss-opt-count">(${c})</span>`;
  }

  function renderList(filter = '') {
    const f = filter.trim().toLowerCase();
    const visible = f ? items.filter(i => String(searchText(i)).toLowerCase().includes(f)) : items;
    if (!visible.length) {
      list.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.innerHTML = visible.map(v => `
        <li><button type="button" class="ms-opt ${selected.has(v) ? 'is-selected' : ''}"
              role="option" aria-selected="${selected.has(v)}" data-value="${esc(v)}">
          <span class="ms-opt-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
          <span class="ms-opt-label">${labelHTML ? labelHTML(v) : esc(v)}</span>${countHTML(v)}
        </button></li>`).join('');
    }
    syncCount();
  }

  function syncCount() {
    if (!countEl) return;
    const n = selected.size;
    countEl.textContent = n === 0 ? 'None selected' : (n === 1 ? '1 selected' : `${n} selected`);
    countEl.setAttribute('data-active', n > 0 ? 'true' : 'false');
  }

  function syncTrigger() {
    label.removeAttribute('title');
    if (!selected.size) {
      label.textContent = placeholder;
      trigger.classList.remove('ms-trigger--active');
    } else if (selected.size === 1) {
      const only = [...selected][0];
      if (labelHTML) {
        label.innerHTML = labelHTML(only);
        // the trigger truncates long labels — keep the full one on hover
        label.title = (label.firstElementChild || label).textContent;
      } else {
        label.textContent = singularPattern(only);
      }
      trigger.classList.add('ms-trigger--active');
    } else {
      label.textContent = multiPattern(selected.size);
      trigger.classList.add('ms-trigger--active');
    }
  }

  function emitChange() {
    changeListeners.forEach(fn => {
      try { fn({ type: 'change', target: api }); } catch (e) { console.warn(e); }
    });
  }

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = ''; renderList();
    flipIfNeeded(root, trigger, panel);
    setTimeout(() => search.focus(), 0);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    dropElevation();
  }

  trigger.addEventListener('click', () => panel.hidden ? open() : close());
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target) && !panel.hidden) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); }
  });

  search.addEventListener('input', () => renderList(search.value));

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ms-opt');
    if (!btn) return;
    const v = btn.dataset.value;
    if (selected.has(v)) selected.delete(v); else selected.add(v);
    // Animate just this row, don't full-rerender (preserves scroll position)
    const nowSelected = selected.has(v);
    btn.classList.toggle('is-selected', nowSelected);
    btn.setAttribute('aria-selected', String(nowSelected));
    syncCount(); syncTrigger(); emitChange();
  });

  noneBtn.addEventListener('click', () => {
    selected.clear();
    renderList(search.value); syncTrigger(); emitChange();
  });
  doneBtns.forEach(b => b.addEventListener('click', close));

  const api = {
    populate(arr, counts) {
      items = (arr || []).slice();
      countMap = counts || {};
      // drop selections that are no longer present
      [...selected].forEach(v => { if (!items.includes(v)) selected.delete(v); });
      renderList(search.value); syncTrigger();   // keep any text typed in the open panel
    },
    get values() { return [...selected]; },
    setValues(arr) {
      selected = new Set((arr || []).filter(v => items.includes(v)));
      renderList(search.value); syncTrigger();
    },
    // Compatibility shims so legacy `.value`/`.value = ''` code keeps working.
    get value() { return selected.size === 1 ? [...selected][0] : ''; },
    set value(v) {
      if (!v) { selected.clear(); }
      else { selected = new Set([v]); }
      renderList(search.value); syncTrigger();
    },
    addEventListener(name, fn) {
      if (name === 'change') changeListeners.push(fn);
    },
    isEmpty() { return selected.size === 0; },
    has(v) { return selected.has(v); },
  };
  return api;
}

/* Themed single-select dropdown (used for Pay Level). Reuses the .ms-* panel
   styling but renders each option as a name + a gradient-coloured "(N …)"
   count. Exposes the same `.value` / change shims as a native <select>. */
function createSingleSelect(root, opts = {}) {
  const trigger = root.querySelector('.ms-trigger');
  const label   = root.querySelector('.ms-trigger-label');
  const panel   = root.querySelector('.ms-panel');
  const list    = root.querySelector('.ms-list');
  let placeholder = opts.placeholder || 'All';
  const fmtCount = opts.countFormat || ((n) => String(n));   // text inside "(…)"
  const changeListeners = [];

  let items = [];   // [{ value, name, count }]  (count null = no count shown)
  let selected = '';
  let disabled = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
  }
  function countHTML(it) {
    if (it.count == null) return '';
    return `<span class="ss-opt-count">(${esc(fmtCount(it.count))})</span>`;
  }
  function renderList() {
    list.innerHTML = items.map(it => {
      const sel = it.value === selected;
      return `<li><button type="button" class="ms-opt ss-opt${sel ? ' is-selected' : ''}"
            role="option" aria-selected="${sel}" data-value="${esc(it.value)}">
          <span class="ss-opt-name">${esc(it.name)}</span>${countHTML(it)}
        </button></li>`;
    }).join('');
  }
  function syncTrigger() {
    const it = items.find(i => i.value === selected);
    if (!selected) {
      // Empty = the "All / Any" default → show the placeholder, no active glow.
      label.innerHTML = esc(placeholder);
      trigger.classList.remove('ms-trigger--active');
    } else if (!it) {
      label.innerHTML = esc(selected);
      trigger.classList.add('ms-trigger--active');
    } else {
      label.innerHTML = `${esc(it.name)}${countHTML(it)}`;
      trigger.classList.add('ms-trigger--active');
    }
  }
  function emitChange() {
    changeListeners.forEach(fn => { try { fn({ type: 'change', target: api }); } catch (e) { console.warn(e); } });
  }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    flipIfNeeded(root, trigger, panel);
  }
  function close() { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); dropElevation(); }

  trigger.addEventListener('click', () => { if (disabled) return; panel.hidden ? open() : close(); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target) && !panel.hidden) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); } });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ss-opt');
    if (!btn) return;
    selected = btn.dataset.value;
    renderList(); syncTrigger(); close(); emitChange();
  });

  const api = {
    populate(arr) {
      items = (arr || []).slice();
      if (selected && !items.some(i => i.value === selected)) selected = '';
      renderList(); syncTrigger();
    },
    get value() { return selected; },
    set value(v) { selected = v || ''; renderList(); syncTrigger(); },
    addEventListener(name, fn) { if (name === 'change') changeListeners.push(fn); },
    // Native-<select> compatibility shims used by legacy call-sites.
    get options() { return items.map(it => ({ value: it.value, textContent: it.name })); },
    dispatchEvent(evt) { if (evt && evt.type === 'change') emitChange(); return true; },
    has(v) { return items.some(it => it.value === v); },
    get disabled() { return disabled; },
    set disabled(b) {
      disabled = !!b;
      trigger.classList.toggle('ms-trigger--disabled', disabled);
      trigger.setAttribute('aria-disabled', String(disabled));
      if (disabled) close();
    },
    setPlaceholder(p) { placeholder = p; if (!selected) syncTrigger(); },
  };
  return api;
}
