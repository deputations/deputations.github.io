// ===== india-map-animations.js =====
// Orchestrates cinematic transitions: home → map, hover effects, ripples

(() => {
  'use strict';

  // Home → Map cinematic transition
  function animateToMap() {
    return new Promise((resolve) => {
      const home = document.getElementById('home-view');
      const map = document.getElementById('map-view');
      if (!home || !map) { resolve(); return; }

      // Phase 1: home fades and scales out
      const cards = home.querySelectorAll('.kpi-grid > *, .ai-search-section, .data-container, .filters-sidebar');
      cards.forEach((c, i) => {
        c.style.transition = `opacity 0.25s ease ${i * 15}ms, transform 0.3s ease ${i * 15}ms`;
        c.style.opacity = '0';
        c.style.transform = 'scale(0.96)';
      });

      // Phase 2: radial glow
      const glow = document.createElement('div');
      glow.className = 'map-transition-glow';
      glow.style.cssText = `
        position: fixed; top: 50%; left: 50%;
        width: 0; height: 0;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(34,211,238,0.35) 0%, rgba(167,139,250,0.18) 50%, transparent 80%);
        z-index: 999;
        transform: translate(-50%, -50%);
        pointer-events: none;
        transition: width 0.7s cubic-bezier(0.4,0,0.2,1), height 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.6s;
        opacity: 0;
      `;
      document.body.appendChild(glow);
      requestAnimationFrame(() => {
        glow.style.opacity = '1';
        glow.style.width = '150vmax';
        glow.style.height = '150vmax';
      });

      setTimeout(() => {
        // Switch views
        home.hidden = true;
        map.hidden = false;
        document.body.classList.add('map-active');

        // Init map
        if (typeof initIndiaMap === 'function') {
          initIndiaMap();
        }

        // Fade out glow
        setTimeout(() => {
          glow.style.opacity = '0';
          setTimeout(() => { glow.remove(); resolve(); }, 600);
        }, 400);
      }, 350);
    });
  }

  function animateToHome() {
    return new Promise((resolve) => {
      const home = document.getElementById('home-view');
      const map = document.getElementById('map-view');
      if (!home || !map) { resolve(); return; }

      map.style.transition = 'opacity 0.3s ease';
      map.style.opacity = '0';

      setTimeout(() => {
        map.hidden = true;
        map.style.opacity = '1';
        document.body.classList.remove('map-active');
        home.hidden = false;

        // Reset cards
        const cards = home.querySelectorAll('.kpi-grid > *, .ai-search-section, .data-container, .filters-sidebar');
        cards.forEach((c, i) => {
          c.style.transition = `opacity 0.3s ease ${i * 20}ms, transform 0.3s ease ${i * 20}ms`;
          c.style.opacity = '1';
          c.style.transform = 'scale(1)';
        });

        setTimeout(resolve, 500);
      }, 300);
    });
  }

  // Expose globally
  window.MapAnimations = { animateToMap, animateToHome };

  // Patch the router in app.js to use these
  document.addEventListener('DOMContentLoaded', () => {
    // Add transition class hooks if app.js hasn't already overridden
    const observer = new MutationObserver(() => {
      const mapView = document.getElementById('map-view');
      const homeView = document.getElementById('home-view');
      if (mapView && homeView) {
        // Hook into nav clicks for /india-map
        document.querySelectorAll('.nav-links a[href*="india-map"]').forEach(link => {
          if (link.dataset.transitionHook) return;
          link.dataset.transitionHook = '1';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            animateToMap();
            history.pushState(null, '', '/india-map');
          }, true); // capture phase, runs first
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  });
})();
