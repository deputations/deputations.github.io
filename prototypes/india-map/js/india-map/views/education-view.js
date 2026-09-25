// js/india-map/views/education-view.js
// Education view — card grid organized by qualification group.

import { getData } from '../../map-provider.js';
import { renderCardGrid } from './shared/card-grid.js';

export function initEducationView(containerId, gridId) {
  const container = document.getElementById(containerId);

  function render() {
    const data = getData();
    const categories = groupByQualification(data.filteredListings);
    renderCardGrid(document.getElementById(gridId), categories, data.filteredListings);
  }

  return { render };
}

function groupByQualification(listings) {
  const groups = {};
  listings.forEach(l => {
    const qg = l.qualificationGroup || mapQualification(l.qualification);
    if (!groups[qg]) groups[qg] = { name: qg, count: 0, posts: 0, states: new Set(), listings: [] };
    groups[qg].count++;
    groups[qg].posts += l.posts || 1;
    if (l.state && l.state !== 'All India') {
      l.state.split(',').forEach(s => groups[qg].states.add(s.trim()));
    }
    groups[qg].listings.push(l);
  });

  return Object.values(groups)
    .sort((a, b) => b.count - a.count)
    .map(g => ({ ...g, states: [...g.states] }));
}

// Fallback mapping if qualificationGroup is not set on a listing
function mapQualification(qualification) {
  if (!qualification) return 'Others';
  const q = qualification.toLowerCase();
  if (q.includes('mba') || q.includes('management')) return 'MBA / Management';
  if (q.includes('b.e') || q.includes('b.tech') || q.includes('btech')) {
    if (q.includes('computer') || q.includes('cs ') || q.includes('it ')) return 'BE/BTech (Computer Science)';
    if (q.includes('civil')) return 'BE/BTech (Civil)';
    if (q.includes('mech')) return 'BE/BTech (Mechanical)';
    if (q.includes('elect')) return 'BE/BTech (Electrical)';
    return 'BE/BTech (General)';
  }
  if (q.includes('mbbs') || q.includes('medicine')) return 'Medical (MBBS)';
  if (q.includes('nurs')) return 'Medical (Nursing)';
  if (q.includes('llb') || q.includes('law')) return 'Law (LLB)';
  if (q.includes('post graduate') || q.includes('pg ') || q.includes('masters')) return 'Post Graduate (General)';
  if (q.includes('graduate') || q.includes('b.a') || q.includes('b.sc') || q.includes('b.com')) return 'Graduate (General)';
  if (q.includes('diploma') || q.includes('iti')) return 'Diploma / ITI';
  if (q.includes('12th') || q.includes('12 ')) return '12th Pass';
  if (q.includes('10th') || q.includes('10 ')) return '10th Pass';
  if (q.includes('doctorate') || q.includes('ph.d') || q.includes('phd')) return 'Doctorate';
  return 'Others';
}
