/* shared/vacancy-utils.js — reusable helpers exposed as window.DepUtils */
(function () {
  'use strict';

  function safe(value) {
    return value == null ? '' : String(value).trim();
  }

  function hasMeaningfulValue(value) {
    const text = safe(value).toLowerCase();
    return Boolean(text) && !['-', '—', 'na', 'n/a', 'null', 'undefined'].includes(text);
  }

  function normalizeText(text) {
    return safe(text)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatLocation(item) {
    const city = safe(item && item.Location_City);
    const state = safe(item && item.Location_State);
    if (city && state) return `${city}, ${state}`;
    return city || state || '';
  }

  // Pay levels are 1–18 plus the exceptional "13A" (between 13 and 14).
  // parseLevelValue returns a comparable RANK ("13A" → 13.5); levelLabel the
  // display token ("13A"). The A suffix needs a word boundary so phrases like
  // "Level 13 and above" still parse as 13.
  const LEVEL_RX = /(\d+)([\s-]*A\b)?/;

  function parseLevelValue(value) {
    if (value == null) return null;
    const str = String(value).trim().toUpperCase();
    if (!str) return null;
    const match = str.match(LEVEL_RX);
    return match ? Number(match[1]) + (match[2] ? 0.5 : 0) : null;
  }

  function levelLabel(value) {
    if (value == null) return '';
    const match = String(value).trim().toUpperCase().match(LEVEL_RX);
    return match ? match[1] + (match[2] ? 'A' : '') : '';
  }

  function formatEligibility(item) {
    const a = parseLevelValue(item && item.Req_Level1);
    const b = parseLevelValue(item && item.Req_Level2);
    const ta = levelLabel(item && item.Req_Level1);
    const tb = levelLabel(item && item.Req_Level2);
    if (a !== null && b !== null) {
      if (a === b) return `Level ${ta}`;
      return a < b ? `Level ${ta} to Level ${tb}` : `Level ${tb} to Level ${ta}`;
    }
    if (a !== null) return `Level ${ta}`;
    if (b !== null) return `Level ${tb}`;
    return 'Not specified';
  }

  function formatDaysLeft(daysLeft) {
    if (daysLeft == null || Number.isNaN(daysLeft)) return 'Not specified';
    if (daysLeft < 0) return 'Expired';
    if (daysLeft === 0) return 'Closes today';
    return `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  }

  function getDaysLeftTone(daysLeft) {
    if (daysLeft == null || Number.isNaN(daysLeft)) return 'muted';
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 2) return 'critical';
    if (daysLeft <= 7) return 'closing';
    if (daysLeft <= 15) return 'soon';
    return 'safe';
  }

  function formatDisplayDate(value) {
    const raw = safe(value);
    if (!hasMeaningfulValue(raw)) return 'Not specified';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getDaysUntilDate(value) {
    const raw = safe(value);
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    return Math.round((target - today) / 86400000);
  }

  function normalizeUrl(value) {
    const url = safe(value);
    if (!url || !hasMeaningfulValue(url)) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^www\./i.test(url)) return `https://${url}`;
    return '';
  }

  function getFirstNonEmpty(item, keys) {
    for (const key of keys) {
      const value = item && item[key];
      if (hasMeaningfulValue(value)) return safe(value);
    }
    return '';
  }

  function isDelhiNcrLocation(item) {
    const text = normalizeText([
      item && item.Location_City,
      item && item.Location_State,
      formatLocation(item)
    ].join(' '));
    return [
      'delhi', 'new delhi', 'ncr', 'noida', 'greater noida',
      'gurugram', 'gurgaon', 'ghaziabad', 'faridabad'
    ].some(k => text.includes(k));
  }

  function fuzzyIncludes(query, text) {
    const q = normalizeText(query);
    const t = normalizeText(text);
    if (!q) return true;
    if (t.includes(q)) return true;
    // Every query word must actually appear as a substring (AND). Avoid the
    // reverse `qt.includes(tt)` check, which let a short text token satisfy a
    // longer query word and surfaced unrelated rows.
    const qTokens = q.split(' ').filter(Boolean);
    return qTokens.every(qt => t.includes(qt));
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  window.DepUtils = {
    safe, hasMeaningfulValue, normalizeText, escapeHtml,
    formatLocation, parseLevelValue, levelLabel, formatEligibility,
    formatDaysLeft, getDaysLeftTone, formatDisplayDate, getDaysUntilDate,
    normalizeUrl, getFirstNonEmpty, isDelhiNcrLocation, fuzzyIncludes, uid
  };
})();
