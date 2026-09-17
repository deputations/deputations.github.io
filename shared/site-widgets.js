/* ==========================================================================
   Site-wide toggles (shared widget — loaded on every public page)
   ========================================================================== */
(function () {
  'use strict';

  /* Read the projects-page flag from Supabase.
     Falls back to true if the call fails so the page is visible by default. */
  window.applyProjectsToggle = function () {
    var url = window.SUPABASE_URL;
    var key = window.SUPABASE_ANON_KEY;
    if (!url || !key) return;

    fetch(url + '/rest/v1/rpc/get_site_config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ p_key: 'projects_page_enabled' })
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (val) {
      /* RPC returns { enabled: true/false } */
      var isEnabled = (val && typeof val.enabled === 'boolean') ? val.enabled : true;
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
