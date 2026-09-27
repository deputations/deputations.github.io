// js/india-map/views/shared/listing-table.js
// Shared listing table — rendered inside expanded category cards.

export function renderListingTable(listings) {
  if (!listings || listings.length === 0) {
    return '<div class="ad-listing-row"><span style="color: var(--text-muted); font-style: italic;">No active listings in this category</span></div>';
  }

  const rows = listings.map(l => `
    <div class="ad-listing-row">
      <span class="ad-listing-row-title">${escapeHTML(l.title)}</span>
      <div class="ad-listing-row-meta">
        ${l.district ? `<span>${escapeHTML(l.district)}</span>` : ''}
        <span>${escapeHTML(l.experience || '')}</span>
        <span>${escapeHTML(l.jobType || '')}</span>
      </div>
    </div>
  `).join('');

  return `<div style="overflow-x: auto;">${rows}</div>`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
