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

  // Broad zone for an Indian state/UT — used to auto-fill Region when blank.
  const REGION_BY_STATE = {
    'jammu and kashmir':'North','jammu & kashmir':'North','ladakh':'North','himachal pradesh':'North',
    'punjab':'North','haryana':'North','delhi':'North','new delhi':'North','chandigarh':'North',
    'uttarakhand':'North','uttar pradesh':'North','rajasthan':'North',
    'bihar':'East','jharkhand':'East','odisha':'East','orissa':'East','west bengal':'East',
    'sikkim':'East','andaman and nicobar islands':'East',
    'assam':'NorthEast','arunachal pradesh':'NorthEast','manipur':'NorthEast','meghalaya':'NorthEast',
    'mizoram':'NorthEast','nagaland':'NorthEast','tripura':'NorthEast',
    'gujarat':'West','maharashtra':'West','goa':'West','dadra and nagar haveli and daman and diu':'West',
    'madhya pradesh':'Central','chhattisgarh':'Central',
    'andhra pradesh':'South','telangana':'South','karnataka':'South','kerala':'South',
    'tamil nadu':'South','puducherry':'South','lakshadweep':'South',
  };
  function regionForState(state) {
    return REGION_BY_STATE[norm(state).toLowerCase()] || '';
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

  // ---- Eligibility tiers (level + years-of-experience) --------------------
  // A deputation post is open to officers from one or more feeder grades, each
  // with its own minimum service. We model that as an array of tiers:
  //   [{ level: 11, min_years: 0 }, { level: 10, min_years: 3 }, ...]
  // Source of truth = the `eligibility_tiers` column if present; otherwise we
  // backfill from the legacy req_level1/min_years_experience (+ …2) columns.
  function parseYears(v) {
    const m = norm(v).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function dedupeTiers(tiers) {
    // One tier per level; keep the most permissive (lowest min_years). Sort by
    // level descending so the analogous (highest) grade reads first.
    const byLevel = new Map();
    for (const t of tiers) {
      if (t.level === null || t.level === undefined) continue;
      const prev = byLevel.get(t.level);
      if (!prev || t.min_years < prev.min_years) byLevel.set(t.level, t);
    }
    return [...byLevel.values()].sort((a, b) => b.level - a.level);
  }

  function parseTiers(row) {
    // 1) Explicit eligibility_tiers (jsonb array, or JSON string from the JSON file)
    let raw = row && row.eligibility_tiers;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    if (Array.isArray(raw) && raw.length) {
      const tiers = raw.map(t => ({
        level: parseLevel(t && t.level),
        min_years: (t && t.min_years != null) ? (parseInt(t.min_years, 10) || 0) : 0
      }));
      const cleaned = dedupeTiers(tiers);
      if (cleaned.length) return cleaned;
    }
    // 2) Backfill from legacy flat columns
    const tiers = [];
    const l1 = parseLevel(row && row.req_level1);
    if (l1 !== null) tiers.push({ level: l1, min_years: parseYears(row && row.min_years_experience) });
    const l2 = parseLevel(row && row.req_level2);
    if (l2 !== null) tiers.push({ level: l2, min_years: parseYears(row && row.min_years_experience2) });
    return dedupeTiers(tiers);
  }

  // Is an officer at (userLevel, userYears-at-that-level) eligible for `vacancy`?
  //   • No level chosen           → no constraint (true)
  //   • Vacancy has no tier data  → no constraint (true)
  //   • Over-qualified (above the top tier) → included (true)
  //   • Otherwise → some tier matches level exactly AND years >= that tier's min
  //   • userYears blank → match any tier at that level regardless of years
  function isEligible(vacancy, userLevel, userYears) {
    const lvl = parseLevel(userLevel);
    if (lvl === null) return true;
    const tiers = (vacancy && vacancy.eligibility_tiers) || [];
    if (!tiers.length) return true;
    const yrs = (userYears === '' || userYears === null || userYears === undefined)
      ? null : (parseInt(userYears, 10) || 0);
    // Eligible only if the officer's level matches one of the post's feeder
    // grades AND meets that tier's minimum service. A higher-grade officer is
    // NOT eligible for a lower post (it would be a reversion), and an in-between
    // grade with no matching tier is not eligible either.
    return tiers.some(t => t.level === lvl && (yrs === null || yrs >= t.min_years));
  }

  // "L11 · L10 (3y) · L8 (5y)" — compact human summary of the tiers.
  function formatTiers(tiers) {
    if (!tiers || !tiers.length) return '';
    return tiers.map(t => t.min_years > 0 ? `L${t.level} (${t.min_years}y)` : `L${t.level}`).join(' · ');
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

  // ---- acronyms (searchable + shown in parentheses) ----------------------
  // Curated full-name (normalised) -> canonical acronym. Ministries mirror the
  // admin-ingest MINISTRIES table; add organisations/bodies as needed.
  const ACRONYM_MAP = {
    // ministries (stored WITHOUT the "Ministry of" prefix)
    'ayush': 'MoA', 'agriculture and farmers welfare': 'MoAFW', 'chemicals and fertilizers': 'MoCF',
    'civil aviation': 'MoCA', 'coal': 'COAL', 'commerce and industry': 'MoCI', 'communications': 'MoC',
    'consumer affairs food and public distribution': 'MoCAFP', 'cooperation': 'COOP', 'corporate affairs': 'MCA',
    'culture': 'CULT', 'defence': 'MoD', 'development of north eastern region': 'MDONER', 'earth sciences': 'MoES',
    'education': 'MoE', 'electronics and information technology': 'MeitY', 'environment forest and climate change': 'MoEFCC',
    'external affairs': 'MEA', 'finance': 'MoF', 'fisheries animal husbandry and dairying': 'MoFAHD',
    'food processing industries': 'MoFPI', 'health and family welfare': 'MoHFW', 'heavy industries': 'MoHI',
    'home affairs': 'MHA', 'housing and urban affairs': 'MoHUA', 'information and broadcasting': 'MIB',
    'jal shakti': 'MoJS', 'labour and employment': 'MoLE', 'law and justice': 'MoLJ',
    'micro small and medium enterprises': 'MSME', 'mines': 'MoM', 'minority affairs': 'MoMA',
    'new and renewable energy': 'MNRE', 'panchayati raj': 'MoPR', 'parliamentary affairs': 'MPA',
    'personnel public grievances and pensions': 'MoPPGP', 'petroleum and natural gas': 'MoPNG', 'planning': 'MoP',
    'ports shipping and waterways': 'MoPSW', 'power': 'POWER', 'railways': 'MoR',
    'road transport and highways': 'MoRTH', 'rural development': 'MoRD', 'science and technology': 'MST',
    'skill development and entrepreneurship': 'MSDE', 'social justice and empowerment': 'MoSJE',
    'statistics and programme implementation': 'MoSPI', 'steel': 'MoS', 'textiles': 'MoT', 'tourism': 'TOUR',
    'tribal affairs': 'MoTA', 'women and child development': 'MoWCD', 'youth affairs and sports': 'MoYAS',
    // common organisations / bodies
    'food safety and standards authority of india': 'FSSAI', 'national commission for women': 'NCW',
    'union public service commission': 'UPSC', 'staff selection commission': 'SSC',
    'central bureau of investigation': 'CBI', 'comptroller and auditor general of india': 'CAG',
    'national investigation agency': 'NIA', 'national human rights commission': 'NHRC',
    'central vigilance commission': 'CVC', 'national informatics centre': 'NIC',
    'indian council of medical research': 'ICMR', 'council of scientific and industrial research': 'CSIR',
    'all india institute of medical sciences': 'AIIMS', 'bureau of indian standards': 'BIS',
    'directorate general of health services': 'DGHS', 'national disaster management authority': 'NDMA',
    'sardar vallabhbhai patel national police academy': 'SVPNPA', 'north eastern police academy': 'NEPA',
  };
  const ACR_STOP = new Set(['of', 'and', 'for', 'the', 'in', 'on', 'to', 'a', 'an', 'at', 'by', 'with', 'de', 'cum']);
  function acrNorm(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function autoAcr(name) {
    const n = acrNorm(name); if (!n) return [];
    const words = n.split(' ');
    const out = new Set();
    const sig = words.filter(w => !ACR_STOP.has(w));
    if (sig.length >= 2) out.add(sig.map(w => w[0]).join('').toUpperCase());            // skip filler -> FSSAI, MHA, NCW
    const keepOf = words.filter(w => w === 'of' || !ACR_STOP.has(w));
    if (keepOf.length >= 2) out.add(keepOf.map(w => (w === 'of' ? 'O' : w[0])).join('').toUpperCase()); // keep "of" -> MOHFW
    if (words.length >= 2 && words.length <= 8) out.add(words.map(w => w[0]).join('').toUpperCase());   // all initials
    return [...out].filter(a => a.length >= 2 && a.length <= 10);
  }
  function acronymFor(name) {                 // best single acronym (display)
    const n = acrNorm(name); if (!n) return '';
    if (ACRONYM_MAP[n]) return ACRONYM_MAP[n];
    const a = autoAcr(name); return a.length ? a[0] : '';
  }
  function acronymVariants(name) {            // all searchable variants
    const n = acrNorm(name); const set = new Set();
    if (ACRONYM_MAP[n]) set.add(ACRONYM_MAP[n]);
    autoAcr(name).forEach(a => set.add(a));
    return [...set];
  }
  function withAcronym(name) {                // "Full Name (ACR)" for display
    const s = norm(name); if (!s) return '';
    const acr = acronymFor(s); if (!acr) return s;
    if (acrNorm(s) === acr.toLowerCase()) return s;                 // name IS the acronym
    if (new RegExp('\\(\\s*' + acr + '\\s*\\)', 'i').test(s)) return s; // already shown
    return `${s} (${acr})`;
  }
  function acronymSearchText(o) {
    const set = new Set();
    [o.Ministry, o.Department, o.Organisation, o.Department_Organisation]
      .forEach(nm => acronymVariants(nm).forEach(a => set.add(a)));
    return [...set].join(' ');
  }

  function buildSearchText(o) {
    return [o.Post_Name, o.Organisation, o.Ministry, o.Department, o.Location_City, o.Location_State,
      o.Level_Text, o.Req_Level1, o.Req_Level2, o.Essential_Qualification, o.Tags_Keywords,
      acronymSearchText(o)]
      .map(norm).filter(Boolean).join(' ').toLowerCase();
  }

  function completenessScore(o) {
    const fields = ['Vacancy_ID','Ministry','Organisation','Post_Name','Level_Text',
      'Location_City','Location_State','Req_Level1','Req_Level2','Notification_Date',
      'Last_Date_To_Apply','Official_Notification_Link',
      'Mode_of_Application','Essential_Qualification'];
    const filled = fields.filter(f => norm(o[f])).length;
    return Math.round((filled / fields.length) * 100);
  }

  // ---- source provenance label (table "Source" column + modal) ----
  const MONTHS = { jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',
    jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec' };
  // "EN 23-29 May 2026" / "Employment News (11-17 Apr 2026)" -> "23May26" / "11Apr26"
  function enIssueCompact(cat) {
    const s = norm(cat);
    const day = (s.match(/\b(\d{1,2})\b/) || [])[1];
    const mon = (s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) || [])[1];
    const year = (s.match(/\b(\d{4})\b/) || [])[1];
    if (day && mon && year) {
      return `${parseInt(day, 10)}${MONTHS[mon.slice(0,3).toLowerCase()]}${year.slice(-2)}`;
    }
    return s.replace(/^employment news\s*/i, '').replace(/^EN\s*/i, '') || s;
  }
  function sourceRef(type, cat, page) {
    const isEN = String(type || '').toLowerCase() === 'employment_news' ||
      /employment news|^EN\b/i.test(cat || '');
    if (isEN) return `EN ${enIssueCompact(cat)}${page ? ' p' + page : ''}`;
    return 'Circular';
  }
  // Longer label for roomier surfaces (card footer): "Employment News 30May26 Page33"
  function sourceRefLong(type, cat, page) {
    const isEN = String(type || '').toLowerCase() === 'employment_news' ||
      /employment news|^EN\b/i.test(cat || '');
    if (isEN) return `Employment News ${enIssueCompact(cat)}${page ? ' Page' + page : ''}`;
    return 'Circular';
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
    o.Region = o.Region || regionForState(o.Location_State);
    o.eligibility_text = formatEligibilityText(o.Req_Level1, o.Req_Level2);
    o.eligibility_rules = buildEligibilityRules(o.Req_Level1, o.Req_Level2);
    o.eligibility_tiers = parseTiers(row);
    o.eligibility_tiers_text = formatTiers(o.eligibility_tiers);
    o.delhi_ncr_flag = isDelhiNcr(o.Location_City, o.Location_State);
    o.expired_flag = daysLeft !== null && daysLeft < 0;
    o.closing_soon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 15;
    o.Closing_Soon = o.closing_soon ? 'Yes' : 'No';
    o.Acronyms = acronymSearchText(o);
    o.search_text = buildSearchText(o);
    o.completeness_score = completenessScore(o);
    o.data_quality_flag = qualityFlag(o.completeness_score);
    o.Source_Page = norm(row.raw_extraction && row.raw_extraction.source_page).replace(/\D/g, '');
    o.Source_Ref = sourceRef(o._source_type, o['Source Category'], o.Source_Page);
    o.Source_Ref_Long = sourceRefLong(o._source_type, o['Source Category'], o.Source_Page);
    o.Detailed_Eligibility = row.raw_extraction && row.raw_extraction.detailed_eligibility
      ? String(row.raw_extraction.detailed_eligibility).replace(/\r\n/g, '\n').trim()
      : '';
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

  global.DepEnrich = { enrichRecord, enrichAll, parseTiers, isEligible, formatTiers, acronymFor, withAcronym };
})(window);
