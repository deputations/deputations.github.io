// js/india-map/views/shared/card-grid.js
// Shared card-grid component for Functional and Education views.
// Renders a grid of expandable category cards. Each card shows count,
// a proportional bar, and (on expand) a listing table.

import { renderListingTable } from './listing-table.js';

const CATEGORY_ICONS = {
  // Functional
  'Administrative': 'ph-briefcase',
  'Technical': 'ph-cpu',
  'Defence': 'ph-shield',
  'Police': 'ph-warning',
  'Vigilance': 'ph-eye',
  'Education': 'ph-graduation-cap',
  'Healthcare': 'ph-first-aid',
  'Finance': 'ph-currency-inr',
  'Engineering': 'ph-wrench',
  'Teaching': 'ph-chalkboard-teacher',
  'Legal': 'ph-scales',
  'General': 'ph-folder',
  // Education
  'MBA / Management': 'ph-chart-line-up',
  'BE/BTech (Computer Science)': 'ph-code',
  'BE/BTech (Civil)': 'ph-buildings',
  'BE/BTech (Mechanical)': 'ph-gear',
  'BE/BTech (Electrical)': 'ph-lightning',
  'Medical (MBBS)': 'ph-heartbeat',
  'Medical (Nursing)': 'ph-first-aid-kit',
  'Law (LLB)': 'ph-scales',
  'Post Graduate (General)': 'ph-book-open',
  'Graduate (General)': 'ph-book',
  'Diploma / ITI': 'ph-hammer',
  '12th Pass': 'ph-file-text',
  '10th Pass': 'ph-file',
  'Doctorate': 'ph-mortar-board',
  'Others': 'ph-dots-three'
};

export function renderCardGrid(container, categories, listings, options = {}) {
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const max = Math.max(...categories.map(c => c.count), 1);

  container.innerHTML = '';

  categories.forEach((cat, idx) => {
    const card = document.createElement('div');
    card.className = 'ad-category-card';
    card.style.animationDelay = `${idx * 60}ms`;

    const icon = CATEGORY_ICONS[cat.name] || 'ph-tag';
    const pct = Math.max(2, Math.round((cat.count / max) * 100));

    card.innerHTML = `
      <div class="ad-category-card-header">
        <div class="ad-category-icon"><i class="ph ${icon}"></i></div>
        <div class="ad-category-name">${escapeHTML(cat.name)}</div>
      </div>
      <div class="ad-category-count">${cat.count}</div>
      <div class="ad-category-bar">
        <div class="ad-category-bar-fill" style="width: 0%"></div>
      </div>
      <div class="ad-category-states">
        ${cat.states.length > 0
          ? `<strong>${cat.states.length} states</strong> &middot; ${cat.posts} posts`
          : `<strong>0 states</strong> &middot; 0 posts`}
      </div>
      <div class="ad-category-listings" id="listings-${idx}"></div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.ad-listing-row')) return;
      const listingsDiv = card.querySelector('.ad-category-listings');
      const isOpen = listingsDiv.classList.contains('open');
      if (isOpen) {
        listingsDiv.classList.remove('open');
        return;
      }
      listingsDiv.innerHTML = renderListingTable(cat.listings);
      listingsDiv.classList.add('open');
    });

    container.appendChild(card);

    // Trigger entrance animation + bar fill on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.classList.add('visible');
        const fill = card.querySelector('.ad-category-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      });
    });
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
