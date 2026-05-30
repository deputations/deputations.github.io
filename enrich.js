/* enrich.js — shared client-side enrichment for vacancy rows.
 *
 * Single source of truth for the derived fields the dashboard needs. Used by
 * both the public dashboard (app.js) and the admin review page
 * (admin-ingest.js). Ported from scripts/build_data.py so behaviour matches
 * the previous Python build exactly.
 *
 * Input : a Supabase row (snake_case columns).
 * Output: an object with the Title_Case keys app.js already consumes, plus all
 *         derived fields (Days_Left, Status, location_label, search_text, …).
 *
 * Exposes window.DepEnrich = { enrichRecord, enrichAll }.
 */
(function (global) {
  'use strict';

  function norm(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/ /g, ' ').trim().replace(/\s+/g, ' ');
  }

  function parseLevel(v) {
    const m = norm(v).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Accepts ISO (yyyy-mm-dd), dd/mm/yyyy, dd-mm-yyyy, "03 Mar 2026". Day-first.
  function parseDateISO(v) {
    const t = norm(v);
    if (!t) return '';
    let m;
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const parsed = new Date(t);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const mo = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    return t; // leave as-is if unparseable
  }

  function toDisplayDate(iso) {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${m[3]} ${months[parseInt(m[2],10)-1]} ${m[1]}`;
  }

  function computeDaysLeft(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const last = new Date(+m[1], +m[2]-1, +m[3]);
    const today = new Date();
    today.setHours(0,0,0,0);
    last.setHours(0,0,0,0);
    return Math.round((last - today) / 86400000);
  }

  function normalizeUrl(v) {
    const t = norm(v);
    if (!t) return '';
    if (['-','—','na','n/a','null','undefined'].includes(t.toLowerCase())) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return 'https://' + t;
    return t;
  }

  function buildLocationLabel(city, state) {
    city = norm(city); state = norm(state);
    if (city && state) return `${city}, ${state}`;
    return city || state;
  }

  function isDelhiNcr(city, state) {
    const c = `${norm(city)} ${norm(state)}`.toLowerCase();
    return ['delhi','new delhi','noida','greater noida','gurugram','gurgaon','faridabad','ghaziabad']
      .some(k => c.includes(k));
  }

  function formatEligibilityText(r1, r2) {
    const a = parseLevel(r1), b = parseLevel(r2);
    if (a !== null && b !== null) {
      if (a === b) return `Level ${a}`;
      return `Level ${Math.min(a,b)} to Level ${Math.max(a,b)}`;
    }
    if (a !== null) return `Level ${a}`;
    if (b !== null) return `Level ${b}`;
    return 'Not specified';
  }

  function buildEligibilityRules(r1, r2) {
    const a = parseLevel(r1), b = parseLevel(r2);
    if (a !== null && b !== null) return { min_level: Math.min(a,b), max_level: Math.max(a,b), type: 'range' };
    if (a !== null) return { min_level: a, max_level: a, type: 'single' };
    if (b !== null) return { min_level: b, max_level: b, type: 'single' };
    return { min_level: null, max_level: null, type: 'unspecified' };
  }

  function inferStatus(raw, daysLeft) {
    const s = norm(raw).toLowerCase();
    if (['active','inactive','expired'].includes(s)) {
      if (s === 'active' && daysLeft !== null && daysLeft < 0) return 'Inactive';
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    if (daysLeft === null) return 'Unknown';
    return daysLeft < 0 ? 'Inactive' : 'Active';
  }

  function buildSearchText(o) {
    return [o.Post_Name, o.Organisation, o.Ministry, o.Location_City, o.Location_State,
      o.Level_Text, o.Req_Level1, o.Req_Level2, o.Essential_Qualification, o.Tags_Keywords]
      .map(norm).filter(Boolean).join(' ').toLowerCase();
  }

  function completenessScore(o) {
    const fields = ['Vacancy_ID','Ministry','Organisation','Post_Name','Level_Text',
      'Location_City','Location_State','Req_Level1','Req_Level2','Notification_Date',
      'Last_Date_To_Apply','Official_Notification_Link','Application_Form_Link',
      'Mode_of_Application','Essential_Qualification'];
    const filled = fields.filter(f => norm(o[f])).length;
    return Math.round((filled / fields.length) * 100);
  }

  function qualityFlag(score) {
    if (score >= 85) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  }

  // snake_case Supabase row  ->  Title_Case keys app.js expects
  function mapBase(row) {
    return {
      id: row.id,
      Vacancy_ID: norm(row.vacancy_id),
      Ministry: norm(row.ministry),
      Min_Code: norm(row.min_code),
      Department: norm(row.department),
      Organisation: norm(row.organisation),
      Organisation_Type: norm(row.organisation_type),
      Post_Name: norm(row.post_name),
      Level: norm(row.level),
      Level_Text: norm(row.level_text) || (parseLevel(row.level) !== null ? `Level-${parseLevel(row.level)}` : ''),
      Location_City: norm(row.location_city),
      Location_State: norm(row.location_state),
      Region: norm(row.region),
      Req_Level1: norm(row.req_level1),
      Min_Years_Experience: norm(row.min_years_experience),
      Req_Level2: norm(row.req_level2),
      Min_Years_Experience2: norm(row.min_years_experience2),
      Tags_Keywords: norm(row.tags_keywords),
      Eligible_Service: norm(row.eligible_service),
      Essential_Qualification: norm(row.essential_qualification),
      No_of_Posts: norm(row.no_of_posts),
      Deputation_Period_Years: norm(row.deputation_period_years),
      Deputation_Type: norm(row.deputation_type),
      Notification_Date: norm(row.notification_date),
      Last_Date_To_Apply: norm(row.last_date_to_apply),
      Official_Notification_Link: norm(row.official_notification_link),
      Application_Form_Link: norm(row.application_form_link),
      Source_Website: norm(row.source_website),
      Functional_Area: norm(row.functional_area),
      Mode_of_Application: norm(row.mode_of_application),
      // pipeline/provenance (handy for the admin review UI)
      _status: row.status,
      _confidence: row.confidence,
      _source_type: row.source_type,
      _source_file_url: row.source_file_url,
      _ingest_job_id: row.ingest_job_id,
      'Source Category': norm(row.source_category),
    };
  }

  function enrichRecord(row) {
    const o = mapBase(row);
    const notifIso = parseDateISO(o.Notification_Date);
    const lastIso = parseDateISO(o.Last_Date_To_Apply);
    const daysLeft = computeDaysLeft(lastIso);

    o.Official_Notification_Link = normalizeUrl(o.Official_Notification_Link);
    o.Application_Form_Link = normalizeUrl(o.Application_Form_Link);
    o.Notification_Date = notifIso;
    o.Notification_Date_Display = toDisplayDate(notifIso);
    o.Last_Date_To_Apply = lastIso;
    o.Last_Date_To_Apply_Display = toDisplayDate(lastIso);
    o.Days_Left = daysLeft === null ? '' : daysLeft;
    o.Status = inferStatus(row.status_label || '', daysLeft);
    o.location_label = buildLocationLabel(o.Location_City, o.Location_State);
    o.eligibility_text = formatEligibilityText(o.Req_Level1, o.Req_Level2);
    o.eligibility_rules = buildEligibilityRules(o.Req_Level1, o.Req_Level2);
    o.delhi_ncr_flag = isDelhiNcr(o.Location_City, o.Location_State);
    o.expired_flag = daysLeft !== null && daysLeft < 0;
    o.closing_soon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 15;
    o.Closing_Soon = o.closing_soon ? 'Yes' : 'No';
    o.search_text = buildSearchText(o);
    o.completeness_score = completenessScore(o);
    o.data_quality_flag = qualityFlag(o.completeness_score);
    return o;
  }

  function enrichAll(rows) {
    return (rows || []).map(enrichRecord).sort((a, b) => {
      const da = (typeof a.Days_Left === 'number') ? a.Days_Left : 999999;
      const db = (typeof b.Days_Left === 'number') ? b.Days_Left : 999999;
      if (da !== db) return da - db;
      return norm(a.Post_Name).toLowerCase().localeCompare(norm(b.Post_Name).toLowerCase());
    });
  }

  global.DepEnrich = { enrichRecord, enrichAll };
})(window);
