/* ==========================================================================
   Site-wide toggles (shared widget — loaded on every public page)
   ========================================================================== */
(function () {
  'use strict';

  window.applyProjectsToggle = function () {
    var url = window.SUPABASE_URL;
    var key = window.SUPABASE_ANON_KEY;
    console.log('[site-widgets] applyProjectsToggle called, url=' + url + ', key=' + (key ? 'present' : 'MISSING'));
    if (!url || !key) return;

    fetch(url + '/rest/v1/site_config?key=eq.projects_page_enabled&select=value', {
      headers: { 'apikey': key, 'Accept': 'application/json' }
    })
    .then(function (r) {
      console.log('[site-widgets] site_config fetch status:', r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (rows) {
      /* table stores value as jsonb string "true"/"false" */
      var raw = (rows && rows.length && rows[0].value !== undefined) ? rows[0].value : 'true';
      var isEnabled = String(raw).toLowerCase() === 'true';
      /* Gate 1 — nav link on every page */
      var navLink = document.querySelector('a[href="/upcoming-projects.html"]');
      if (navLink) {
        navLink.setAttribute('aria-hidden', isEnabled ? 'false' : 'true');
        navLink.style.display = isEnabled ? '' : 'none';
      }
      /* Gate 2 — upcoming-projects page content (album + CTA footer) */
      var content = document.getElementById('upContent');
      var notice = document.getElementById('upDisabledNotice');
      if (content) {
        content.style.display = isEnabled ? '' : 'none';
      }
      if (notice) {
        notice.style.display = isEnabled ? 'none' : '';
      }
    })
    .catch(function () {
      /* silently visible — if the call fails, don't hide the page */
    });
  };

  /* run automatically on every page that loads this script */
  applyProjectsToggle();
})();
