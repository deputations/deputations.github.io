// js/india-map/views/functional-view.js
// Functional view — card grid organized by job function category.

import { getData } from '../../map-provider.js';
import { renderCardGrid } from './shared/card-grid.js';

export function initFunctionalView(containerId, gridId) {
  const container = document.getElementById(containerId);

  function render() {
    const data = getData();
    const categories = groupByFunction(data.filteredListings);
    renderCardGrid(document.getElementById(gridId), categories, data.filteredListings);
  }

  return { render };
}

function groupByFunction(listings) {
  const groups = {};
  listings.forEach(l => {
    const fn = l.function || 'General';
    if (!groups[fn]) groups[fn] = { name: fn, count: 0, posts: 0, states: new Set(), listings: [] };
    groups[fn].count++;
    groups[fn].posts += l.posts || 1;
    if (l.state && l.state !== 'All India') {
      l.state.split(',').forEach(s => groups[fn].states.add(s.trim()));
    }
    groups[fn].listings.push(l);
  });

  return Object.values(groups)
    .sort((a, b) => b.count - a.count)
    .map(g => ({ ...g, states: [...g.states] }));
}
