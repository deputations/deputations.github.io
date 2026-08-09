/* ============================================================
   DeFeX — Deputation Friendliness Index (client)
   Static data, deep-linkable, no backend.
   ============================================================ */
(() => {
  "use strict";

  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const RANKED_MIN_REPORTS = 1;          // MVP: one anonymised row is the starter signal
  const RANKED_MIN_CONF    = 0.20;       // require at least Low confidence to rank
  const PAGE_SIZE          = 50;         // leaderboard rows per page ("Show more" reveals the next 50)

  /* ══ BEGIN scope-limit ═════════════════════════════════════════════════════
     Phase 1 of the public rollout publishes Ministries and Departments only.
     Everything else — attached and subordinate offices, autonomous and
     statutory bodies, PSUs, academies — stays untouched in data/defex/*.json
     and reappears the moment this switch is off.

     TO REVERT: set `on: false`. That is the whole change. The filter is
     applied once, right after load(), so every downstream view (explorer,
     hero search, leaderboard, ministry dropdowns, readiness checklist, deep
     links) derives from it; the copy overrides, the scope note and the
     recomputed coverage counters are all no-ops when `on` is false.

     TO REMOVE ENTIRELY: delete this block, the call sites tagged `scope-limit`
     (load, bindMeta, handleHash, applyScope, scopeDeepLinkNotice), the three
     `SCOPE.typeLabel(...)` calls in orgCard / suggRow / openDrawer — each
     reverts to the plain `.type` field — and the matching fenced block at the
     end of defex.css.
     ════════════════════════════════════════════════════════════════════════ */
  const SCOPE = {
    on: true,
    types: ["Ministry", "Department"],

    // Source-data quirk, not an exception to the rule: the Railway Board *is*
    // the Ministry of Railways' secretariat, but the xlsx types it "Attached
    // Office". On a strict type filter the whole Ministry of Railways — a
    // rated, Deputation-friendly entry — disappears from the view. Pinned in
    // by id until the type is corrected upstream; delete this line to go back
    // to the strict rule.
    alsoInclude: ["ministry-of-railways__ministry-of-railways-railway-board"],

    // Is this organisation part of the currently published scope?
    has(o) {
      return !this.on || this.types.includes(o.type) || this.alsoInclude.includes(o.id);
    },

    // A pinned entry carries the wrong `type` upstream, and printing "Attached
    // Office" inside a Ministries-and-Departments view contradicts the view.
    // Show the label its name already implies. Falls through to the raw field
    // for everything else, and for everything once `on` is false.
    typeLabel(o) {
      return this.on && this.alsoInclude.includes(o.id) ? "Ministry" : (o.type || "");
    },

    // Coverage-strip counters, recomputed over the visible set so the numbers
    // never claim more than the page will actually show.
    counts(list) {
      return {
        organisations_mapped:  list.length,
        ministries_covered:    new Set(list.map(o => o.ministry)).size,
        organisations_rated:   list.filter(o => o.rated).length,
        organisations_with_om: list.filter(o => o.has_om).length,
        reports_total:         list.reduce((n, o) => n + (o.reports || 0), 0),
      };
    },

    // Copy that would otherwise promise more than the page now shows.
    // Selector -> HTML. Authored constants only; never user data.
    copy: {
      ".dex-hero-lede":
        "A transparency layer for India's deputation system. Search any parent " +
        "Ministry or Department and see what its <strong>rules</strong> say, what " +
        "<strong>reports</strong> show, and what you should <strong>do next</strong> — " +
        "with the signal strength always shown next to the signal.",
      '.dex-hero-actions a[href="#explorer"]': "Explore ministries &amp; departments",
      "#explorer-h": "Explore ministries &amp; departments",
      "#explorer .dex-section-sub":
        "Featured ministries and departments across friendliness bands. " +
        "Search above or open any card.",
      ".dex-coverage-tile:first-child .dex-tile-label": "Ministries &amp; departments mapped",
    },

    // Same idea, attribute surfaces. The hero placeholder matters most — its
    // examples (CBIC, Railway Board) are out of scope and would dead-end.
    attrs: {
      "#dex-search-hero": {
        placeholder: "Try “Ministry of Home Affairs”, “Department of Revenue”…",
        "aria-label": "Search ministries and departments",
      },
    },

    // The only element the scope limit adds to the page.
    noteHtml:
      '<p class="dex-scope-note" id="dex-scope-note">' +
        '<span class="dex-scope-note-tag">Phase 1</span>' +
        '<span>DeFeX currently publishes <strong>Ministries and Departments</strong> only. ' +
        'Attached and subordinate offices, autonomous and statutory bodies, PSUs and ' +
        'institutes are still being verified and will appear here in a later release.</span>' +
      '</p>',
  };
  /* ══ END scope-limit ═══════════════════════════════════════════════════════ */

  const state = {
    organisations: [],
    allOrganisations: [],                // pre-scope list — see SCOPE above
    scores: new Map(),
    reports: new Map(),                  // org_id -> [reports]
    methodology: null,
    updates: null,
    fuse: null,
    tab: "ranked",
    explorerBand: "all",
    sort: { key: "dex", dir: "desc" },
    filters: { q: "", ministry: "", band: "", confidence: "", om: false },
    limit: PAGE_SIZE,
  };

  // Pagination + drawer-history bookkeeping (module scope).
  let lastTableSig = "";        // (tab+filters+sort) signature — resets pagination on change
  let drawerReturnFocus = null; // element to refocus when the drawer closes
  let drawerPushed = false;     // did we push a history entry for the open drawer?

  // ---------- load ----------------------------------------------------------
  async function load() {
    // Cache-bust by version — bump along with defex.js's ?v= query.
    const V = "ms16";
    const get = (p) => fetch(`${p}?v=${V}`).then(r => r.json());
    const [orgs, scores, reports, method, upd] = await Promise.all([
      get("data/defex/organisations.json"),
      get("data/defex/scores.json"),
      get("data/defex/reports.json"),
      get("data/defex/methodology.json"),
      get("data/defex/updates.json"),
    ]);
    // scope-limit: one filter, applied once — every view below derives from it.
    state.allOrganisations = orgs;
    state.organisations = orgs.filter(o => SCOPE.has(o));
    state.scores = new Map(scores.map(s => [s.org_id, s]));
    reports.forEach(r => {
      if (!state.reports.has(r.org_id)) state.reports.set(r.org_id, []);
      state.reports.get(r.org_id).push(r);
    });
    state.methodology = method;
    state.updates = upd;

    state.fuse = new Fuse(state.organisations, {   // scope-limit: search the visible set
      keys: [
        { name: "name", weight: 0.55 },
        { name: "ministry", weight: 0.30 },
        { name: "type", weight: 0.15 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
    });
  }

  // ---------- bindings ------------------------------------------------------
  function bindMeta() {
    const u = state.updates, m = state.methodology;
    $("[data-bind='methodology_version']").textContent = m.version;

    // scope-limit: counters follow the visible set, not the full dataset.
    const c = SCOPE.on ? SCOPE.counts(state.organisations) : u.counts;
    setCounter("organisations_mapped", c.organisations_mapped);
    setCounter("ministries_covered", c.ministries_covered);
    setCounter("organisations_rated", c.organisations_rated);
    setCounter("organisations_with_om", c.organisations_with_om);
    setCounter("reports_total", c.reports_total);

    const dt = new Date(u.generated_at_utc);
    $("[data-bind='generated_at_human']").textContent =
      dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    $("[data-bind='formula_expression']").textContent = m.formula.expression;

    const gap = c.organisations_mapped - c.organisations_rated;
    $("[data-coverage-gap]").textContent = gap.toLocaleString("en-IN");

    // Survey links
    $("#dex-survey-link").href = u.survey_url;
    $("#drawer-survey").href = u.survey_url;

    // Changelog
    const cl = $("#dex-changelog");
    cl.innerHTML = m.changelog.map(e =>
      `<li><strong>v${e.version}</strong> · ${e.date} — ${escapeHtml(e.note)}</li>`
    ).join("");
  }

  function setCounter(key, val) {
    const els = document.querySelectorAll(`[data-counter="${key}"]`);
    const text = (Number(val) || 0).toLocaleString("en-IN");
    els.forEach(el => { el.textContent = text; });
  }

  // ---------- helpers -------------------------------------------------------
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g,
    m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // The policy snapshot for an org — never assume it's reports[0]; the reports
  // array may include other record types (e.g. experience timelines) in any order.
  const policyOf = (reports) => (reports || []).find(r => r.type === "policy") || null;

  function bandColor(band) {
    return {
      "Deputation-friendly":  "var(--dex-mint)",
      "Generally supportive": "var(--dex-cyan)",
      "Mixed":                "var(--dex-violet)",
      "Restrictive":          "var(--dex-amber)",
      "Very restrictive":     "var(--dex-rose)",
    }[band] || "var(--dex-mint)";
  }

  function confDots(band) {
    const filled = { High: 4, Medium: 3, Low: 2, Insufficient: 1 }[band] ?? 0;
    let html = '<span class="dex-conf-dots" title="Confidence: ' + escapeHtml(band) + '">';
    for (let i = 0; i < 4; i++) html += `<i class="${i < filled ? "on" : ""}"></i>`;
    return html + "</span>";
  }

  function mainSignal(org) {
    const s = state.scores.get(org.id);
    if (!s || !s.signals?.length) {
      if (!org.rated) return "No reports yet — be the first to contribute.";
      return "No specific friction signals on record.";
    }
    const neg = s.signals.filter(x => x.weight < 0);
    if (neg.length) return neg[0].label + (neg.length > 1 ? ` (+${neg.length - 1} more)` : "");
    return s.signals[0].label;
  }

  // ---------- explorer (featured cards) -------------------------------------
  function renderFeatured() {
    const grid = $("#dex-featured");
    const band = state.explorerBand;
    let pool = state.organisations.filter(o => o.rated);
    if (band === "om") pool = pool.filter(o => o.has_om);
    else if (band !== "all") pool = pool.filter(o => o.band === band);

    // Sort by confidence desc then dex desc, take top 9
    pool.sort((a, b) => (b.confidence - a.confidence) || (b.dex - a.dex));
    pool = pool.slice(0, 9);

    if (!pool.length) {
      grid.innerHTML = `<div class="dex-empty"><p>No organisations match this filter yet.</p></div>`;
      return;
    }
    grid.innerHTML = pool.map(orgCard).join("");
    // Cards open via a delegated listener bound once in bindExplorerChips().
  }

  function orgCard(o) {
    const ring = o.rated
      ? `<div class="dex-ring-mini" style="--ring-pct:${o.dex};--ring-color:${bandColor(o.band)}">
           <span class="dex-ring-mini-value">${o.dex}</span></div>`
      : `<div class="dex-ring-mini dex-ring-mini--unrated">
           <span class="dex-ring-mini-value">N/R</span></div>`;
    return `
      <article class="dex-card" data-org-id="${escapeHtml(o.id)}" tabindex="0" role="button" aria-label="${escapeHtml(o.name)} — open profile">
        <header class="dex-card-head">
          <div>
            <div class="dex-card-min">${escapeHtml(o.ministry)}</div>
            <h3 class="dex-card-name">${escapeHtml(o.name)}</h3>
            <div class="dex-card-type">${escapeHtml(SCOPE.typeLabel(o))}</div>
          </div>
          ${ring}
        </header>
        <p class="dex-card-signal">${escapeHtml(mainSignal(o))}</p>
        <footer class="dex-card-foot">
          <span class="dex-band-pill" data-band="${escapeHtml(o.band)}">${escapeHtml(o.band)}</span>
          ${confDots(o.confidence_band)}
        </footer>
      </article>`;
  }

  // ---------- search --------------------------------------------------------
  function bindSearch() {
    const input = $("#dex-search-hero");
    const box   = $("#dex-search-suggestions");

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault(); input.focus();
      }
      if (e.key === "Escape") { box.hidden = true; }
    });

    let active = -1;
    let results = [];

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      results = state.fuse.search(q, { limit: 8 });
      if (!results.length) {
        box.hidden = false;
        box.innerHTML = `<div class="dex-suggestion"><div><div class="dex-suggestion-name">No match for "${escapeHtml(q)}"</div><div class="dex-suggestion-min">Try a ministry name, e.g. “Finance”</div></div></div>`;
        return;
      }
      box.hidden = false;
      active = 0;
      box.innerHTML = results.map((r, i) => suggRow(r.item, i === active)).join("");
      $$(".dex-suggestion", box).forEach((el, i) => el.addEventListener("click", () => {
        openDrawer(results[i].item.id); box.hidden = true; input.blur();
      }));
    });

    input.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); highlight(); }
      if (e.key === "ArrowUp")   { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
      if (e.key === "Enter")     { e.preventDefault(); if (results[active]) { openDrawer(results[active].item.id); box.hidden = true; input.blur(); } }
    });

    function highlight() {
      $$(".dex-suggestion", box).forEach((el, i) => el.classList.toggle("dex-suggestion--active", i === active));
    }

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target) && e.target !== input) box.hidden = true;
    });
  }

  function suggRow(o, active) {
    const score = o.rated
      ? `<span class="dex-suggestion-score">${o.dex}</span>`
      : `<span class="dex-suggestion-score" style="background:rgba(148,163,184,0.12);color:var(--text-secondary)">N/R</span>`;
    return `<div class="dex-suggestion ${active ? "dex-suggestion--active" : ""}">
      <div><div class="dex-suggestion-name">${escapeHtml(o.name)}</div>
      <div class="dex-suggestion-min">${escapeHtml(o.ministry)} · ${escapeHtml(SCOPE.typeLabel(o) || "—")}</div></div>
      ${score}</div>`;
  }

  // ---------- explorer chips -----------------------------------------------
  function bindExplorerChips() {
    $$("[data-explorer-band]").forEach(b => b.addEventListener("click", () => {
      $$("[data-explorer-band]").forEach(x => x.classList.remove("dex-chip--active"));
      b.classList.add("dex-chip--active");
      state.explorerBand = b.dataset.explorerBand;
      renderFeatured();
    }));
    // Featured cards open via delegation (one listener; survives re-renders).
    $("#dex-featured").addEventListener("click", (e) => {
      const card = e.target.closest(".dex-card[data-org-id]");
      if (card) openDrawer(card.dataset.orgId);
    });
  }

  // ---------- leaderboard ---------------------------------------------------
  function populateFilters() {
    const mins = [...new Set(state.organisations.map(o => o.ministry))].sort();
    $("#filter-ministry").innerHTML = '<option value="">All</option>' +
      mins.map(m => `<option>${escapeHtml(m)}</option>`).join("");

    // The Readiness Checklist is currently commented out of defex.html. Fill its
    // ministry select only if the markup is on the page, so un-commenting the
    // section is all it takes to bring the feature back.
    const chkMin = $("#chk-ministry");
    if (chkMin) chkMin.innerHTML = '<option value="">Select…</option>' +
      mins.map(m => `<option>${escapeHtml(m)}</option>`).join("");
  }

  function tabPool() {
    if (state.tab === "ranked") {
      return state.organisations.filter(o =>
        o.rated && o.reports >= RANKED_MIN_REPORTS && o.confidence >= RANKED_MIN_CONF);
    }
    if (state.tab === "needs") {
      return state.organisations.filter(o =>
        !o.rated || o.confidence_band === "Low" || o.confidence_band === "Insufficient");
    }
    // default — only rated
    return state.organisations.filter(o =>
      o.rated && o.reports >= RANKED_MIN_REPORTS && o.confidence >= RANKED_MIN_CONF);
  }

  function applyFilters(pool) {
    const f = state.filters;
    return pool.filter(o => {
      if (f.q) {
        const q = f.q.toLowerCase();
        if (!o.name.toLowerCase().includes(q) && !o.ministry.toLowerCase().includes(q)) return false;
      }
      if (f.ministry && o.ministry !== f.ministry) return false;
      if (f.band && o.band !== f.band) return false;
      if (f.confidence && o.confidence_band !== f.confidence) return false;
      if (f.om && !o.has_om) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const { key, dir } = state.sort;
    const mul = dir === "asc" ? 1 : -1;
    const getter = {
      name: o => o.name.toLowerCase(),
      ministry: o => o.ministry.toLowerCase(),
      type: o => (o.type || "").toLowerCase(),
      dex: o => o.rated ? o.dex : -1,
      band: o => o.band,
      confidence: o => o.confidence,
      reports: o => o.reports,
    }[key] || (o => o.name);
    return rows.slice().sort((a, b) => {
      const va = getter(a), vb = getter(b);
      if (va < vb) return -1 * mul;
      if (va > vb) return  1 * mul;
      return 0;
    });
  }

  function renderTable() {
    // Reflect the current sort on the headers: visual caret (CSS) + aria-sort for AT.
    $$(".dex-table th[data-sort]").forEach(th => {
      if (th.dataset.sort === state.sort.key)
        th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      else
        th.removeAttribute("aria-sort");
    });
    const base = tabPool();
    let pool = applyFilters(base);
    pool = sortRows(pool);

    // Reset pagination whenever the result context (tab/filters/sort) changes.
    const sig = JSON.stringify([state.tab, state.filters, state.sort]);
    if (sig !== lastTableSig) { state.limit = PAGE_SIZE; lastTableSig = sig; }

    // "Showing X of Y" count
    const countEl = $("#dex-result-count");
    if (countEl) countEl.textContent = (pool.length === base.length)
      ? `${base.length} organisation${base.length === 1 ? "" : "s"}`
      : `Showing ${pool.length} of ${base.length}`;

    const tbody = $("#dex-tbody");
    if (!pool.length) {
      tbody.innerHTML = ""; $("#dex-empty").hidden = false; $("#dex-more").hidden = true; return;
    }
    $("#dex-empty").hidden = true;

    const shown = pool.slice(0, state.limit);
    tbody.innerHTML = shown.map((o, i) => row(o, i + 1)).join("");
    // Rows open via a delegated listener bound once in bindLeaderboard().

    const more = $("#dex-more");
    if (pool.length > state.limit) {
      more.hidden = false;
      $("#dex-more-btn").textContent = `Show ${Math.min(PAGE_SIZE, pool.length - state.limit)} more — ${state.limit} of ${pool.length}`;
    } else {
      more.hidden = true;
    }

    // tab counts
    $("[data-tab-count='ranked']").textContent =
      state.organisations.filter(o => o.rated && o.reports >= RANKED_MIN_REPORTS && o.confidence >= RANKED_MIN_CONF).length;
    const needsEl = document.querySelector("[data-tab-count='needs']");
    if (needsEl) needsEl.textContent =
      state.organisations.filter(o => !o.rated || o.confidence_band === "Low" || o.confidence_band === "Insufficient").length;
  }

  function row(o, rank) {
    const dexCell = o.rated
      ? `<span class="dex-row-dex" style="color:${bandColor(o.band)}">${o.dex}</span>`
      : `<span class="dex-row-dex" style="color:var(--text-muted)">—</span>`;
    return `<tr data-org-id="${escapeHtml(o.id)}" tabindex="0">
      <td class="num dex-row-rank">${rank}</td>
      <td><div class="dex-row-name">${escapeHtml(o.name)}</div></td>
      <td class="dex-row-min">${escapeHtml(o.ministry)}</td>
      <td class="num">${dexCell}</td>
      <td><span class="dex-band-pill" data-band="${escapeHtml(o.band)}">${escapeHtml(o.band)}</span></td>
      <td>${confDots(o.confidence_band)}</td>
      <td class="num">${o.reports}</td>
      <td>→</td>
    </tr>`;
  }

  function bindLeaderboard() {
    $$("[data-tab]").forEach(t => t.addEventListener("click", () => {
      $$("[data-tab]").forEach(x => x.classList.remove("dex-tab--active"));
      t.classList.add("dex-tab--active");
      state.tab = t.dataset.tab;
      if (state.tab === "needs") state.sort = { key: "ministry", dir: "asc" };
      else state.sort = { key: "dex", dir: "desc" };
      renderTable();
    }));

    $("#filter-ministry").addEventListener("change", e => { state.filters.ministry = e.target.value; renderTable(); });
    $("#filter-band").addEventListener("change",     e => { state.filters.band = e.target.value; renderTable(); });
    $("#filter-confidence").addEventListener("change", e => { state.filters.confidence = e.target.value; renderTable(); });
    $("#filter-om").addEventListener("change",       e => { state.filters.om = e.target.checked; renderTable(); });
    $("#filter-reset").addEventListener("click", () => {
      state.filters = { q: "", ministry: "", band: "", confidence: "", om: false };
      const s = $("#filter-search"); if (s) s.value = "";
      $("#filter-ministry").value = "";
      $("#filter-band").value = ""; $("#filter-confidence").value = "";
      $("#filter-om").checked = false;
      renderTable();
    });

    $$(".dex-table th[data-sort]").forEach(th => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.sort.key === k) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key: k, dir: k === "dex" || k === "confidence" || k === "reports" ? "desc" : "asc" };
      renderTable();
    }));

    // Rows open via delegation (one listener; survives re-render + pagination).
    $("#dex-tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-org-id]");
      if (tr) openDrawer(tr.dataset.orgId);
    });
    // In-table search
    const search = $("#filter-search");
    if (search) search.addEventListener("input", (e) => { state.filters.q = e.target.value.trim(); renderTable(); });
    // Pagination
    $("#dex-more-btn").addEventListener("click", () => { state.limit += PAGE_SIZE; renderTable(); });
  }

  // ---------- drawer --------------------------------------------------------
  function openDrawer(orgId, opts = {}) {
    const org = state.organisations.find(o => o.id === orgId);
    if (!org) return;
    const score = state.scores.get(orgId);
    const reports = state.reports.get(orgId) || [];

    $("#drawer-ministry").textContent = org.ministry;
    $("#drawer-title").textContent = org.name;
    $("#drawer-type").textContent = SCOPE.typeLabel(org) || "Organisation";
    $("#drawer-reports").textContent = `${org.reports} report${org.reports === 1 ? "" : "s"}`;

    const ring = $("#drawer-ring");
    if (org.rated) {
      ring.classList.remove("dex-ring--unrated");
      ring.style.setProperty("--ring-pct", org.dex);
      ring.style.setProperty("--ring-color", bandColor(org.band));
      $("#drawer-dex").textContent = org.dex;
      $(".dex-ring-suffix", ring).style.display = "";
    } else {
      ring.classList.add("dex-ring--unrated");
      $("#drawer-dex").textContent = "Unrated";
      $(".dex-ring-suffix", ring).style.display = "none";
    }

    const bandEl = $("#drawer-band");
    bandEl.textContent = org.band;
    bandEl.setAttribute("data-band", org.band);

    $("#drawer-conf-fill").style.width = `${Math.round((org.confidence || 0) * 100)}%`;
    $("#drawer-conf-band").textContent = org.confidence_band + (org.rated ? ` · ${(org.confidence * 100).toFixed(0)}%` : "");

    renderPaneRules(org, reports);
    renderPaneReports(org, reports);
    renderPaneActions(org, score, reports);

    // share + survey
    $("#drawer-share").onclick = (e) => {
      e.preventDefault();
      const url = `${location.origin}${location.pathname}#org=${encodeURIComponent(orgId)}`;
      navigator.clipboard?.writeText(url);
      e.target.textContent = "Copied!"; setTimeout(() => e.target.textContent = "Copy share link", 1500);
    };
    $("#drawer-why").onclick = () => toggleWhy(org, score);

    // open
    const drawer = $("#dex-drawer");
    drawerReturnFocus = opts.restoreTo || document.activeElement;
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("dex-drawer-open");           // scroll-lock the page behind
    if (opts.push !== false) {
      history.pushState({ dexDrawer: orgId }, "", `#org=${encodeURIComponent(orgId)}`);  // Back closes it
      drawerPushed = true;
    } else {
      drawerPushed = false;
    }
    ($(".dex-drawer-close", drawer) || drawer).focus();        // move focus into the dialog

    // default tab
    $$(".dex-drawer-tab").forEach(t => t.classList.toggle("dex-drawer-tab--active", t.dataset.drawerTab === "rules"));
    $$(".dex-drawer-pane").forEach(p => p.classList.toggle("dex-drawer-pane--active", p.dataset.drawerPane === "rules"));
  }

  function closeDrawer(opts = {}) {
    const drawer = $("#dex-drawer");
    if (drawer.getAttribute("aria-hidden") === "true") return;   // already closed
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dex-drawer-open");           // unlock page scroll
    const hadPush = drawerPushed;
    drawerPushed = false;
    if (opts.pop !== false && hadPush && location.hash.startsWith("#org=")) {
      history.back();                                            // pop our pushed entry
    } else if (location.hash.startsWith("#org=")) {
      history.replaceState(null, "", location.pathname);         // deep-link open: just clear the hash
    }
    drawerReturnFocus?.focus?.();                                // restore focus to the opener
    drawerReturnFocus = null;
  }

  function bindDrawer() {
    $$("[data-drawer-close]").forEach(el => el.addEventListener("click", () => closeDrawer()));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
    $$(".dex-drawer-tab").forEach(t => t.addEventListener("click", () => {
      $$(".dex-drawer-tab").forEach(x => x.classList.remove("dex-drawer-tab--active"));
      t.classList.add("dex-drawer-tab--active");
      const target = t.dataset.drawerTab;
      $$(".dex-drawer-pane").forEach(p => p.classList.toggle("dex-drawer-pane--active", p.dataset.drawerPane === target));
    }));

    // Focus trap — keep Tab within the open dialog.
    $("#dex-drawer").addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const panel = $(".dex-drawer-panel");
      const f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])', panel)
        .filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function renderPaneRules(org, reports) {
    const p = policyOf(reports); // the policy snapshot — not necessarily reports[0]
    if (!p) {
      $("#pane-rules").innerHTML = `<p>We don't yet have a policy snapshot on file for this organisation. Once a community member submits the relevant OM or a structured report, it appears here.</p>`;
      return;
    }
    const c = p.conditions || {};
    const s = p.sources || {};
    const lines = [];
    lines.push(factRow("Deputation allowed", p.deputation_allowed || "Unknown"));
    if (c.vacancy_based) lines.push(factRow("Vacancy-based release", c.vacancy_based));
    if (c.fcfs)          lines.push(factRow("FCFS / quota condition", c.fcfs));
    lines.push(factRow("Senior-only release", c.senior_only ? "Yes" : "No"));
    lines.push(factRow("“Highly beneficial to parent” condition", c.highly_beneficial ? "Cited" : "Not cited"));
    if (c.details) lines.push(factRow("Conditional details", c.details));
    lines.push(factRow("Source — official OM", s.om ? "On file" : "Not on file"));
    lines.push(factRow("Source — community", s.personal ? "Yes" : "No"));

    $("#pane-rules").innerHTML = `
      <h4>What the rules say</h4>
      ${lines.join("")}
      <div class="dex-why-box" id="drawer-why-box" hidden></div>
    `;
  }

  function factRow(k, v) {
    return `<div class="dex-fact-row"><span class="dex-fact-key">${escapeHtml(k)}</span><span class="dex-fact-val">${escapeHtml(v)}</span></div>`;
  }

  function renderPaneReports(org, reports) {
    if (!org.rated) {
      $("#pane-reports").innerHTML = `
        <h4>Reports</h4>
        <p>No structured reports yet. Be the first to share your timeline through the
        <a href="${escapeHtml(state.updates.survey_url)}" target="_blank" rel="noopener">community survey</a>.</p>`;
      return;
    }
    const n = reports.length;
    const om = reports.some(r => r.sources?.om);
    const pers = reports.some(r => r.sources?.personal);
    $("#pane-reports").innerHTML = `
      <h4>Aggregate signals</h4>
      ${factRow("Records on file", String(n))}
      ${factRow("Official OM available", om ? "Yes" : "No")}
      ${factRow("Community reports", pers ? "Yes" : "No")}
      <p style="margin-top:1rem">Per-applicant timelines (forwarding, NOC, vigilance, relieving) will populate this view as survey submissions are reviewed. Individual reports are never shown — only aggregated stage-wise medians.</p>`;
  }

  function renderPaneActions(org, score, reports) {
    const p = policyOf(reports) || {};
    const c = p.conditions || {};
    const actions = [];

    if (!org.rated) {
      actions.push(action("info", "Treat this organisation as unknown",
        "We have no policy snapshot or reports yet. Default DoPT timelines apply (30 days for NOC). Set calendar reminders accordingly."));
    } else {
      if (p.deputation_allowed === "No") {
        actions.push(action("risk", "Parent does not currently permit deputation",
          "Confirm via RTI or written request before investing time in the application. Ask for the specific OM cited."));
      } else if (p.deputation_allowed === "Allowed with conditions" || p.deputation_allowed === "Allow for some") {
        actions.push(action("warn", "Eligibility is conditional",
          "Read the conditions in the Rules tab carefully before applying. Save copies of any relevant OMs."));
      } else {
        actions.push(action("ok", "Deputation allowed in principle",
          "Proceed with the application. Maintain a dated record of every submission and acknowledgement."));
      }

      if (c.vacancy_based || (c.vacancy_based && /vacancy/i.test(c.vacancy_based))) {
        actions.push(action("warn", "Release depends on parent's own vacancy position",
          "Ask your establishment section in writing whether your post is currently within the permitted vacancy headroom. Without this, NOC may be denied without reason cited."));
      }
      if (c.senior_only) {
        actions.push(action("warn", "Senior-rank-only release pattern reported",
          "If you are below the senior rank typically released, prepare a representation citing DoPT's general deputation OMs in advance."));
      }
      if (c.fcfs) {
        actions.push(action("warn", "FCFS / quota condition reported",
          "Submit early. Once the quota is exhausted, applications may be held without explicit rejection."));
      }
      if (org.has_om === false) {
        actions.push(action("info", "No official OM on file",
          "Request the applicable deputation OM in writing from your establishment section. Attach a copy when you submit."));
      }
    }

    actions.push(action("info", "Set reminders",
      "NOC: follow up at day 15 and day 25. Vigilance: follow up at day 21. Relieving: send a written reminder at day 10 after selection."));
    actions.push(action("info", "Keep paper trail",
      `Track every submission in <a href="/my-deputation.html">My Deputation</a>. If a stage exceeds DoPT's prescribed timeline, file a polite reminder citing the specific OM.`));

    $("#pane-actions").innerHTML = `
      <h4>Recommended next steps</h4>
      ${actions.join("")}`;
  }

  function action(kind, title, body) {
    const icon = { ok: "✓", warn: "!", risk: "×", info: "i" }[kind];
    return `<div class="dex-checklist-item">
      <div class="dex-checklist-icon dex-checklist-icon--${kind}">${icon}</div>
      <div class="dex-checklist-body"><strong>${escapeHtml(title)}</strong><p>${body}</p></div>
    </div>`;
  }

  function toggleWhy(org, score) {
    const box = $("#drawer-why-box");
    if (!box) return;
    if (!org.rated) {
      box.hidden = false;
      box.innerHTML = `Unrated — no scoring applied. Submit a report to start populating this profile.`;
      return;
    }
    const m = state.methodology;
    const p = policyOf(state.reports.get(org.id));
    const base = m.formula.base_scores[p?.deputation_allowed] ?? "?";
    let lines = [`<strong>B</strong> = ${base}  <span style="color:var(--text-muted)">(${p?.deputation_allowed ?? "—"})</span>`];
    (score?.signals || []).forEach(s => {
      if (s.weight < 0) lines.push(`<strong>P</strong> ${escapeHtml(s.label)} <span class="delta-neg">${s.weight}</span>`);
    });
    const personal = p?.sources?.personal;
    const om = p?.sources?.om;
    if (om) lines.push(`<strong>E</strong> Official OM on file <span class="delta-pos">+8</span>`);
    else if (personal) lines.push(`<strong>E</strong> Community source <span class="delta-pos">+2</span>`);
    lines.push(`<strong>= DeFeX ${org.dex}</strong>`);
    box.hidden = false;
    box.innerHTML = lines.join("<br>");
  }

  // ---------- deep link -----------------------------------------------------
  function handleHash() {
    const h = location.hash;
    if (h.startsWith("#org=")) {
      const id = decodeURIComponent(h.slice("#org=".length));
      if (state.organisations.find(o => o.id === id)) { openDrawer(id, { push: false }); return; }
      // scope-limit: a link shared before the limit landed shouldn't dead-end
      // silently — say why the organisation isn't there.
      const hidden = state.allOrganisations.find(o => o.id === id);
      if (hidden) scopeDeepLinkNotice(hidden);
    }
  }

  // ---------- readiness checklist ------------------------------------------
  // The section is commented out of defex.html for now; bail out rather than
  // throwing on the missing markup. Un-commenting the section re-arms this.
  function bindChecklist() {
    if (!$("#chk-ministry")) return;

    $("#chk-ministry").addEventListener("change", e => {
      const sel = $("#chk-org");
      const m = e.target.value;
      if (!m) { sel.disabled = true; sel.innerHTML = '<option value="">Select ministry first</option>'; return; }
      const orgs = state.organisations.filter(o => o.ministry === m)
        .sort((a, b) => a.name.localeCompare(b.name));
      sel.disabled = false;
      sel.innerHTML = '<option value="">Select organisation…</option>' +
        orgs.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("");
    });

    $("#chk-run").addEventListener("click", () => {
      const orgId = $("#chk-org").value;
      const level = $("#chk-level").value;
      const deadline = $("#chk-deadline").value;
      const nocNeeded = $("#chk-noc-needed").checked;
      const vigNeeded = $("#chk-vig-needed").checked;
      const out = $("#dex-checklist-output");

      if (!orgId) {
        out.hidden = false;
        out.innerHTML = `<p style="color:var(--dex-amber)">Pick a parent organisation to generate your checklist.</p>`;
        return;
      }
      const org = state.organisations.find(o => o.id === orgId);
      const reports = state.reports.get(orgId) || [];
      const items = [];

      // Headline
      items.push(`<h3>${escapeHtml(org.name)} — readiness</h3>
        <p style="color:var(--text-secondary); margin: 0 0 1rem">
          <span class="dex-band-pill" data-band="${escapeHtml(org.band)}">${escapeHtml(org.band)}</span>
          &nbsp;Confidence: <strong>${escapeHtml(org.confidence_band)}</strong> · ${org.reports} report${org.reports === 1 ? "" : "s"}
        </p>`);

      // Deadline urgency
      if (deadline) {
        const days = Math.ceil((new Date(deadline) - Date.now()) / 86400000);
        if (days < 0) items.push(action("risk", "Vacancy deadline has passed", "Submit only if the receiving organisation has extended the date — verify in writing."));
        else if (days < 7) items.push(action("risk", `${days} day(s) to deadline`, "Tight window. Prepare a one-page covering letter today and hand-deliver where possible."));
        else if (days < 21) items.push(action("warn", `${days} days to deadline`, "Submit application within 3 working days to leave time for NOC and vigilance follow-up."));
        else items.push(action("ok", `${days} days to deadline`, "Adequate window. Submit within the next 5 working days."));
      }

      // Org-specific
      const p = policyOf(reports) || {};
      const c = p.conditions || {};
      if (p.deputation_allowed === "No") {
        items.push(action("risk", "Parent does not currently permit deputation on file",
          "Confirm via RTI before proceeding. Do not assume informal channels will work."));
      }
      if (c.senior_only) {
        items.push(action("warn", "Senior-rank-only release pattern",
          `Your level: ${escapeHtml(level || "not specified")}. If you are below the typical senior threshold, prepare a representation citing DoPT's general deputation OMs.`));
      }
      if (c.vacancy_based) {
        items.push(action("warn", "Release depends on parent's vacancy position",
          "Send a written query to your establishment section now asking whether your post is within permitted vacancy headroom."));
      }
      if (c.fcfs) {
        items.push(action("warn", "FCFS / quota condition reported",
          "Submit the same day you finalise your application. Note your dated acknowledgement."));
      }

      // NOC / vigilance
      if (nocNeeded) {
        items.push(action("info", "NOC follow-up plan",
          "Day 15: written reminder. Day 25: escalate to the next level. Day 30: representation citing DoPT timelines."));
      }
      if (vigNeeded) {
        items.push(action("info", "Vigilance clearance plan",
          "Day 21: written reminder to the vigilance section. Keep your file movement number on record."));
      }

      // Documents
      items.push(action("info", "Document checklist",
        "Application form · ACR/APAR summary · Service book extract · Integrity certificate · Vigilance clearance request · NOC request · Covering letter."));

      // CTA
      items.push(`<div style="margin-top:1rem">
        <a class="dex-btn dex-btn-ghost" href="/my-deputation.html">Track this in My Deputation →</a>
      </div>`);

      out.hidden = false;
      out.innerHTML = items.join("");
    });
  }

  // ---------- scroll progress + back to top --------------------------------
  function bindScroll() {
    const progress = document.getElementById("dex-progress");
    const toTop = document.getElementById("dex-to-top");
    if (!progress || !toTop) return;
    function onScroll() {
      const h = document.documentElement;
      const max = (h.scrollHeight - h.clientHeight) || 1;
      progress.style.width = ((h.scrollTop / max) * 100) + "%";
      toTop.classList.toggle("show", h.scrollTop > 520);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  // ---------- keyboard activation for click-only widgets -------------------
  // Cards, table rows and sortable headers are activated by click; mirror that
  // for keyboard users (Enter/Space) without re-binding on every re-render.
  function bindKeyActivation() {
    const sel = ".dex-card, #dex-tbody tr, .dex-table th[data-sort]";
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.matches?.(sel)) { e.preventDefault(); e.target.click(); }
    });
  }

  // ---------- loading / error states ---------------------------------------
  function showSkeleton() {
    const grid = $("#dex-featured");
    if (grid) grid.innerHTML = Array.from({ length: 6 },
      () => `<div class="dex-card dex-card--skeleton" aria-hidden="true"></div>`).join("");
  }
  function showLoadError() {
    const host = $("#dex-featured");
    if (!host) return;
    host.innerHTML = `<div class="dex-empty dex-load-error" role="alert">
      <p><strong>Couldn't load DeFeX data.</strong> Please check your connection and try again.</p>
      <button class="dex-btn dex-btn-primary" id="dex-reload">Reload</button>
    </div>`;
    const b = $("#dex-reload");
    if (b) b.addEventListener("click", () => location.reload());
  }

  // ---------- scope limit (copy + note) -------------------------------------
  // scope-limit: swaps the copy the limit invalidates and drops the "Phase 1"
  // note above the explorer. Called synchronously at the bottom of this file —
  // defex.js sits at the end of <body>, so the DOM is parsed and the wider
  // copy never flashes before the swap.
  function applyScope() {
    if (!SCOPE.on) return;
    Object.entries(SCOPE.copy).forEach(([sel, html]) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
    Object.entries(SCOPE.attrs).forEach(([sel, attrs]) => {
      const el = $(sel);
      if (el) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    });
    const anchor = $("#explorer");
    if (anchor && !$("#dex-scope-note")) anchor.insertAdjacentHTML("beforebegin", SCOPE.noteHtml);
  }

  // scope-limit: explain an out-of-scope deep link instead of doing nothing.
  function scopeDeepLinkNotice(org) {
    const note = $("#dex-scope-note");
    if (!note) return;
    note.innerHTML =
      '<span class="dex-scope-note-tag">Not shown yet</span>' +
      `<span><strong>${escapeHtml(org.name)}</strong> (${escapeHtml(org.type || "Organisation")}) ` +
      "isn't in the current view — DeFeX publishes Ministries and Departments only for now. " +
      "It returns here when coverage expands.</span>";
    note.classList.add("dex-scope-note--alert");
    note.setAttribute("role", "status");
    note.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- manpower section: word-by-word reveal -------------------------
  // Wraps every word of #manpower in a span carrying its ordinal, then hands the
  // timing to CSS (transition-delay: calc(var(--w) * 11ms)) so one attribute flip
  // drives the whole cascade — no per-word timers, no reflow, since only opacity
  // moves. Delete the typeManpower() call in init() to drop the effect; the
  // markup and copy are untouched by it.
  function typeManpower() {
    const host = $("#manpower");
    if (!host) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Per-word stagger, in ms — the one knob for the pace. 55ms over 242 words
    // is ~13s end to end. Literal reading speed (~230 wpm) would be 260ms and a
    // 63-second animation, so this sits deliberately above reading pace: the
    // reveal always stays ahead of the reader and never makes them wait, while
    // still being slow enough to follow word by word.
    const WORD_MS = 55;

    // Collect first, then replace — mutating during the walk would invalidate it.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let n = 0;
    textNodes.forEach(node => {
      if (!node.nodeValue.trim()) return;                  // pure whitespace — leave it
      const frag = document.createDocumentFragment();
      // Capturing split keeps the original whitespace, so wrapping cannot change
      // where lines break or how <strong> runs sit against their punctuation.
      node.nodeValue.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        const w = document.createElement("span");
        w.className = "dex-type-w";
        w.style.setProperty("--w", n++);
        w.textContent = part;
        frag.appendChild(w);
      });
      node.parentNode.replaceChild(frag, node);
    });
    if (!n) return;

    host.style.setProperty("--word-ms", `${WORD_MS}ms`);
    host.dataset.typing = "pending";
    const run = () => requestAnimationFrame(() => { host.dataset.typing = "run"; });

    // On desktop the section is in view at load, so this fires straight away; on
    // a phone it waits for the scroll rather than playing to nobody.
    if (!("IntersectionObserver" in window)) { run(); return; }
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some(e => e.isIntersecting)) { obs.disconnect(); run(); }
    }, { threshold: 0.05 });
    io.observe(host);
  }

  // ---------- init ---------------------------------------------------------
  async function init() {
    showSkeleton();
    try {
      await load();
    } catch (e) {
      console.error("DeFeX data load failed", e);
      showLoadError();
      return;
    }
    bindMeta();
    populateFilters();
    bindSearch();
    bindExplorerChips();
    bindLeaderboard();
    bindDrawer();
    bindChecklist();
    bindScroll();
    bindKeyActivation();
    renderFeatured();
    renderTable();
    handleHash();
    // Sync drawer to history: Back closes it; Forward / deep links reopen it.
    window.addEventListener("popstate", () => {
      const h = location.hash;
      if (h.startsWith("#org=")) {
        const id = decodeURIComponent(h.slice("#org=".length));
        if (state.organisations.find(o => o.id === id)) openDrawer(id, { push: false });
        else closeDrawer({ pop: false });
      } else {
        closeDrawer({ pop: false });
      }
    });
  }

  applyScope();                                   // scope-limit: pre-paint copy swap
  typeManpower();                                 // also pre-paint, or the words flash in first
  document.addEventListener("DOMContentLoaded", init);
})();
