/* New listings are published snapshots. Poll only the small manifest, never
 * all records or a Supabase subscription; pause checks in background tabs. */
(function () {
  'use strict';
  var version = null, failures = 0;
  async function check() {
    if (document.hidden || failures >= 3) return;
    try {
      var response = await fetch('data/vacancies-manifest.json', {cache:'no-cache'});
      if (!response.ok) throw new Error('Snapshot unavailable');
      var manifest = await response.json();
      if (!manifest.version) throw new Error('Invalid manifest');
      if (version && version !== manifest.version && !document.getElementById('snapshot-update')) {
        var notice = document.createElement('p'); notice.id = 'snapshot-update'; notice.setAttribute('role','status');
        notice.style.cssText = 'text-align:center;margin:12px';
        var link = document.createElement('a'); link.href = location.href;
        link.textContent = 'New vacancy snapshot available — reload to update'; notice.appendChild(link);
        document.body.appendChild(notice);
      }
      version = manifest.version; failures = 0;
    } catch (_) { failures++; }
  }
  check();
  setInterval(check, 15 * 60 * 1000);
})();
