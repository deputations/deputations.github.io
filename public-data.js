/* Public listing data never contacts Supabase. The manifest pins immutable
 * shards for this page session. Legacy JSON remains a last-good fallback. */
(function () {
  'use strict';
  var manifestPromise, manifest, legacy = false, rows = new Map(), loaded = new Set(), pending = new Map();
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    var n = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n : null;
  }
  function classify(row, now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var fields = {}; parts.forEach(function (p) { fields[p.type] = p.value; });
    var today = day(fields.year + '-' + fields.month + '-' + fields.day);
    var deadline = day(row.Last_Date_To_Apply), notification = day(row.Notification_Date);
    var days = deadline === null ? '' : Math.round((deadline - today) / 86400000);
    var age = notification === null ? null : Math.round((today - notification) / 86400000);
    return Object.assign({}, row, { Status: days !== '' ? (days >= 0 ? 'Active' : 'Inactive') :
      (age !== null && age >= 0 && age <= 60 ? 'Active' : 'Unknown'), Days_Left: days });
  }
  async function json(path, checksum) {
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 12000);
    try {
      var res = await fetch(path, { cache: path.includes('/snapshots/') ? 'default' : 'no-cache', signal: ctrl.signal });
      if (!res.ok) throw new Error('Snapshot HTTP ' + res.status);
      var body = await res.arrayBuffer();
      if (checksum && window.crypto && window.crypto.subtle) {
        var hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body))).map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
        if (hash !== checksum) throw new Error('Snapshot checksum mismatch');
      }
      return JSON.parse(new TextDecoder().decode(body));
    } finally { clearTimeout(timer); }
  }
  function merge(list) {
    if (!Array.isArray(list) || list.some(function (r) { return !r || !r.Vacancy_ID; })) throw new Error('Invalid snapshot');
    list.forEach(function (r) { rows.set(String(r.Vacancy_ID), r); });
  }
  function status(message) {
    if (!document.body) return;
    var el = document.getElementById('snapshot-status');
    if (!el) {
      el = document.createElement('p'); el.id = 'snapshot-status'; el.setAttribute('role', 'status');
      el.style.cssText = 'margin:8px 16px;font-size:12px;text-align:center;color:inherit;opacity:.85';
      document.body.appendChild(el);
    }
    el.textContent = message;
  }
  async function shard(key, descriptor) {
    if (loaded.has(key)) return;
    if (!descriptor || !/^snapshots\/[a-f0-9]{20}\/(current|archive-[a-f0-9])\.json$/.test(descriptor.path)) throw new Error('Invalid snapshot path');
    if (!pending.has(key)) pending.set(key, json('data/' + descriptor.path, descriptor.sha256).then(function (list) {
      if (!Array.isArray(list) || list.length !== descriptor.count) throw new Error('Incomplete snapshot');
      merge(list); loaded.add(key);
    }).finally(function () { pending.delete(key); }));
    return pending.get(key);
  }
  function init() {
    if (!manifestPromise) manifestPromise = (async function () {
      try {
        var candidate = await json('data/vacancies-manifest.json');
        if (candidate.schema !== 1 || !candidate.archive || !candidate.index) throw new Error('Unsupported manifest');
        await shard('current', candidate.current);
        manifest = candidate;
        var age = Date.now() - Date.parse(manifest.generated_at_utc);
        // A fresh snapshot's build time is an implementation detail and
        // duplicates the footer's user-facing "Updated" date. Keep only the
        // actionable stale-data warning when the snapshot is older than 48h.
        if (!Number.isFinite(age) || age > 48 * 3600000) status('Showing the last published vacancy snapshot. Updates are delayed. Verify deadlines in the original notification.');
      } catch (error) {
        merge(await json('data/vacancies.json')); legacy = true;
        status('Showing the last available vacancy snapshot. Live updates are unavailable; verify the original notification.');
      }
    })();
    return manifestPromise;
  }
  async function load(options) {
    options = options || {}; await init();
    if (!legacy) {
      var keys = options.all ? Object.keys(manifest.archive) : (options.ids || []).map(function (id) { return manifest.index[String(id)]; }).filter(Boolean);
      // Bound concurrency: archive selection never produces an unbounded burst.
      keys = Array.from(new Set(keys));
      for (var i = 0; i < keys.length; i += 3) await Promise.all(keys.slice(i, i + 3).map(function (key) { return shard(key, manifest.archive[key]); }));
    }
    return Array.from(rows.values()).map(function (r) { return classify(r); });
  }
  window.PublicVacancies = { load: load, classify: classify,
    archiveLoaded: function () { return legacy || !!manifest && Object.keys(manifest.archive).every(function (key) { return loaded.has(key); }); },
    metadata: function () { return manifest; },
    showError: function () { status('The archive could not be loaded. Current vacancies remain available. Please retry.'); }
  };
})();
