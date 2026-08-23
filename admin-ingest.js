/* admin-ingest.js — gated ingest + review console.
 *
 * Deliberately uses PLAIN fetch against Supabase REST endpoints — NOT the
 * supabase-js library — because supabase-js's Web Locks based auth was
 * deadlocking getSession()/upload() in this environment. Raw fetch has none of
 * that machinery, so it's reliable here.
 *
 * Auth: magic-link (implicit flow). Tokens arrive in the URL hash, are stored
 * in localStorage, and refreshed via the token endpoint when expired.
 * Ingest: the PDF (base64) or URL is POSTed to the `extract` Edge Function,
 * which uploads to storage with the service role and runs Gemini — so the
 * browser never needs storage permissions.
 */

const SB = window.SUPABASE_URL;
const ANON = window.SUPABASE_ANON_KEY;
const SS_KEY = 'dep_admin_sess_v1';

const $ = (id) => document.getElementById(id);
// single shared implementation — shared/vacancy-utils.js loads before this file
const escapeHtml = (s) => window.DepUtils.escapeHtml(s);
const toast = (msg) => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500);
};
// Toast with an ↩ Undo button. onUndo runs if clicked within ttl; onExpire runs
// once afterwards if it wasn't (used to defer the source-PDF GC past the undo
// window, so an undone reject still has its PDF).
const toastUndo = (msg, onUndo, opts = {}) => {
  const t = $('toast');
  clearTimeout(toast._t);
  t.innerHTML = `${escapeHtml(msg)} <button type="button" class="toast-undo">↩ Undo</button>`;
  t.classList.add('show');
  const btn = t.querySelector('.toast-undo');
  let done = false;
  const expireTimer = setTimeout(() => {
    if (!done) { done = true; if (t.contains(btn)) { t.classList.remove('show'); t.textContent = ''; } if (opts.onExpire) opts.onExpire(); }
  }, opts.ttl || 6000);
  btn.onclick = async () => {
    if (done) return; done = true;
    clearTimeout(expireTimer);
    t.classList.remove('show'); t.textContent = '';
    try { await onUndo(); } catch (e) { toast('Undo failed: ' + e.message); }
  };
};
const nowSec = () => Math.floor(Date.now() / 1000);

/* ---------------- UI state persistence ---------------- */
// Filters / sort / page / active tab survive a reload (one key, plain JSON).
const UI_KEY = 'dep_admin_ui_v1';
function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; } }
function saveUI(patch) { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUI(), ...patch })); } catch { /* quota/private mode */ } }

/* ---------------- session helpers ---------------- */
function loadSess() { try { return JSON.parse(localStorage.getItem(SS_KEY) || 'null'); } catch { return null; } }
function saveSess(s) { localStorage.setItem(SS_KEY, JSON.stringify(s)); }
function clearSess() { localStorage.removeItem(SS_KEY); }

function jwtEmail(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(p)));
    return JSON.parse(json).email || '';
  } catch { return ''; }
}

function captureHashTokens() {
  const h = new URLSearchParams(location.hash.slice(1));
  const at = h.get('access_token');
  if (!at) return false;
  const sess = {
    access_token: at,
    refresh_token: h.get('refresh_token') || '',
    expires_at: Number(h.get('expires_at')) || (nowSec() + Number(h.get('expires_in') || 3600)),
    email: jwtEmail(at),
  };
  saveSess(sess);
  history.replaceState(null, '', location.pathname);  // strip the hash
  return true;
}

async function refreshIfNeeded(sess) {
  if (!sess) return null;
  if (sess.expires_at - 60 > nowSec()) return sess;          // still valid
  if (!sess.refresh_token) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const next = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: nowSec() + (d.expires_in || 3600), email: jwtEmail(d.access_token),
    };
    saveSess(next); return next;
  } catch { return null; }
}

/* ---------------- authed REST helper ---------------- */
let TOKEN = '';
// A JWT lasts ~1h and a long triage session outlives it. On 401, refresh the
// session once (a single in-flight refresh shared by concurrent calls) and
// retry the request; if the refresh fails, fall back to the login card.
let _refreshing = null;
async function api(path, opts = {}) {
  const go = () => fetch(`${SB}${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  let r = await go();
  if (r.status === 401 && TOKEN) {
    if (!_refreshing) {
      // force the refresh path even if the stored expiry still looks valid
      _refreshing = refreshIfNeeded({ ...(loadSess() || {}), expires_at: 0 })
        .finally(() => { _refreshing = null; });
    }
    const sess = await _refreshing;
    if (!sess) { showLogin('Session expired — sign in again.'); return r; }
    TOKEN = sess.access_token;
    r = await go();
  }
  return r;
}

// Count-only query (no rows transferred) via the content-range header.
async function countOf(pathFilter) {
  try {
    const r = await api(`/rest/v1/${pathFilter}${pathFilter.includes('?') ? '&' : '?'}select=id&limit=1`, { headers: { Prefer: 'count=exact' } });
    return parseInt(((r.headers.get('content-range') || '/0').split('/')[1]) || '0', 10) || 0;
  } catch { return 0; }
}

// Fetch EVERY row of a REST query in 1000-row pages. Supabase's default
// PostgREST max-rows cap is 1000, so a single GET silently truncates past it
// (the Review queue / Manage list would just show a partial dataset).
async function fetchAll(pathQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await api(`/rest/v1/${pathQuery}&limit=1000&offset=${from}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const chunk = await r.json();
    out.push(...chunk);
    if (chunk.length < 1000) return out;
  }
}

/* ---- two-stage approval (see supabase/migrations/0017_admin_verified.sql) ----
 *
 * "Published" and "checked by a human" used to be the same act, which is why
 * the queue could only be cleared one row at a time. They are now separate:
 *
 *   approving ONE row       → the admin read it → lands admin_verified (green)
 *   approving in BULK       → published, but nobody claims to have read it
 *                             → admin_verified = false (yellow), and it shows
 *                               up in the Verify tab for a second pass
 *
 * Every status write goes through here so the two paths can never drift apart.
 * `verified_at` is cleared on the bulk path so a row that was verified, sent
 * back to draft, and then bulk-approved again does not keep a stale timestamp
 * that implies a check nobody performed.
 */
function statusPatch(status, { verified = false } = {}) {
  if (status !== 'approved') return { status };
  return verified
    ? { status, admin_verified: true, verified_at: new Date().toISOString() }
    : { status, admin_verified: false, verified_at: null };
}

// Undo toast for approve/reject status changes: Undo restores the rows to
// draft and reloads the queue. The source-PDF GC waits for the window to pass.
function undoableStatus(ids, msg) {
  if (!ids.length) return;
  toastUndo(msg, async () => {
    for (let i = 0; i < ids.length; i += 100) {
      const r = await api(`/rest/v1/vacancies?id=in.(${ids.slice(i, i + 100).join(',')})`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }
    toast(`↩ Restored ${ids.length} row(s) to draft`);
    loadDrafts();
    refreshReviewBadges();
  }, { onExpire: scheduleGc });
}

/* ---------------- editable fields on each draft card ---------------- */
const FIELDS = [
  ['post_name', 'Post name'], ['ministry', 'Ministry'], ['organisation', 'Organisation'],
  ['organisation_type', 'Organisation type'], ['level', 'Pay level'],
  ['location_city', 'City'], ['location_state', 'State'], ['no_of_posts', 'No. of posts'],
  ['deputation_period_years', 'Deputation period (yrs)'],
  ['notification_date', 'Notification date'], ['last_date_to_apply', 'Last date'],
  ['essential_qualification', 'Essential qualification'], ['eligible_service', 'Eligible service'],
  ['additional_details', 'Additional details'],
  ['functional_area', 'Functional area / duties'], ['tags_keywords', 'Tags / keywords'],
  ['mode_of_application', 'Mode of application'], ['official_notification_link', 'Official link'],
  ['application_form_link', 'Application form link'], ['source_website', 'Source website'],
];

// ---- Eligibility tiers (level + min years) editor ----
// Replaces the old flat req_level1/2 + min_years fields with an unbounded
// repeater. Each tier = a feeder grade the post is open to. parseTiers (from
// enrich.js) reads either the eligibility_tiers jsonb or the legacy columns.
// Pay levels: 1–18 plus the exceptional "13A" (between 13 and 14).
//   levelTok(v)  → canonical display token: "13", "13A", '' if none
//   levelRank(v) → comparable number: "13A" → 13.5 (so sort/equality just work)
// Both delegate to shared/vacancy-utils.js so the parsing lives in one place.
const levelTok = (v) => window.DepUtils.levelLabel(v);
const levelRank = (v) => window.DepUtils.parseLevelValue(v);

function tiersFor(obj) {
  if (window.DepEnrich && window.DepEnrich.parseTiers) return window.DepEnrich.parseTiers(obj);
  const out = [];
  const l1 = levelRank(obj && obj.req_level1); if (l1 !== null) out.push({ level: l1, label: levelTok(obj && obj.req_level1), min_years: levelRank(obj && obj.min_years_experience) || 0 });
  const l2 = levelRank(obj && obj.req_level2); if (l2 !== null) out.push({ level: l2, label: levelTok(obj && obj.req_level2), min_years: levelRank(obj && obj.min_years_experience2) || 0 });
  return out;
}

function tierRowHtml(t) {
  const lvlDisplay = t ? (t.label || levelTok(t.level) || t.level) : '';
  return `<div class="tier-row" style="display:flex;gap:6px;margin-bottom:5px;align-items:center;">
    <input class="tier-years" type="number" min="0" max="40" placeholder="Years" value="${t ? escapeHtml(t.min_years) : ''}" style="width:90px;flex:0 0 auto">
    <span class="muted" style="font-size:.8rem">years in Level</span>
    <input class="tier-level" type="text" inputmode="numeric" pattern="\\d{1,2}A?" maxlength="3" placeholder="Level (e.g. 12, 13A)" value="${escapeHtml(lvlDisplay)}" style="width:110px;flex:0 0 auto">
    <button type="button" class="tier-del" title="Remove this tier" style="margin-left:auto">✕</button>
  </div>`;
}

function tiersEditorHtml(r) {
  const tiers = tiersFor(r);
  const rows = (tiers.length ? tiers : [null]).map(tierRowHtml).join('');
  return `<div data-tiers style="grid-column:1/-1;border:1px solid var(--line,#334155);border-radius:8px;padding:8px 10px;margin-top:4px">
    <label style="display:block;margin-bottom:6px">Eligibility tiers <span class="muted" style="font-weight:400">— each feeder grade the post is open to (analogous = the post's level with 0 years)</span></label>
    <div class="tier-rows">${rows}</div>
    <button type="button" class="tier-add" style="margin-top:4px">+ Add tier</button>
  </div>`;
}

function wireTiersEditor(scopeEl) {
  const ed = scopeEl.querySelector('[data-tiers]');
  if (!ed) return;
  ed.querySelector('.tier-add').addEventListener('click', () => {
    ed.querySelector('.tier-rows').insertAdjacentHTML('beforeend', tierRowHtml(null));
  });
  ed.addEventListener('click', (e) => {
    const del = e.target.closest('.tier-del');
    if (!del) return;
    const rows = ed.querySelectorAll('.tier-row');
    if (rows.length > 1) del.closest('.tier-row').remove();
    else { del.closest('.tier-row').querySelectorAll('input').forEach((i) => { i.value = ''; }); }
  });
}

// Read tier rows -> clean [{level,min_years}] (deduped, sorted by rank desc).
// `level` is stored as the TOKEN string ("13", "13A") — jsonb-friendly and
// readable by enrich.js parseTiers. Returns [] when the editor is present but
// empty, or null when there's no editor.
function collectTiers(scopeEl) {
  const ed = scopeEl.querySelector('[data-tiers]');
  if (!ed) return null;
  const tiers = [];
  ed.querySelectorAll('.tier-row').forEach((row) => {
    const tok = levelTok(row.querySelector('.tier-level').value);
    if (!tok) return;
    const yrs = parseInt(String(row.querySelector('.tier-years').value || '').replace(/\D/g, ''), 10) || 0;
    tiers.push({ level: tok, min_years: yrs, _rank: levelRank(tok) });
  });
  const byLevel = new Map();
  tiers.forEach((t) => { const p = byLevel.get(t.level); if (!p || t.min_years < p.min_years) byLevel.set(t.level, t); });
  return [...byLevel.values()].sort((a, b) => b._rank - a._rank).map(({ level, min_years }) => ({ level, min_years }));
}

// Merge collected tiers into a patch object: writes eligibility_tiers AND
// mirrors the first two tiers into the legacy columns for back-compat.
function applyTiersToPatch(patch, scopeEl) {
  const tiers = collectTiers(scopeEl);
  if (tiers === null) return patch;
  patch.eligibility_tiers = tiers;
  patch.req_level1 = tiers[0] ? String(tiers[0].level) : '';
  patch.min_years_experience = tiers[0] ? String(tiers[0].min_years) : '';
  patch.req_level2 = tiers[1] ? String(tiers[1].level) : '';
  patch.min_years_experience2 = tiers[1] ? String(tiers[1].min_years) : '';
  return patch;
}

// Fixed, standardised vocabularies for the review dropdowns.
const ORG_TYPES = [
  'Ministry', 'Department', 'Attached and Subordinate Offices', 'Constitutional Bodies',
  'Statutory Bodies', 'Autonomous Bodies', 'Central Public Sector Enterprises (CPSEs)',
];
// [standard name, Min_Code]
const MINISTRIES = [
  ['AYUSH', 'MoA'], ['Agriculture and Farmers Welfare', 'MoAFW'], ['Chemicals and Fertilizers', 'MoCF'],
  ['Civil Aviation', 'MoCA'], ['Coal', 'COAL'], ['Commerce and Industry', 'MoCI'], ['Communications', 'MoC'],
  ['Consumer Affairs, Food and Public Distribution', 'MoCAFP'], ['Cooperation', 'COOP'], ['Corporate Affairs', 'MCA'],
  ['Culture', 'CULT'], ['Defence', 'MoD'], ['Development of North Eastern Region', 'MDONER'], ['Earth Sciences', 'MoES'],
  ['Education', 'MoE'], ['Electronics and Information Technology', 'MeitY'], ['Environment, Forest and Climate Change', 'MoEFCC'],
  ['External Affairs', 'MEA'], ['Finance', 'MoF'], ['Fisheries, Animal Husbandry and Dairying', 'MoFAHD'],
  ['Food Processing Industries', 'MoFPI'], ['Health and Family Welfare', 'MoHFW'], ['Heavy Industries', 'MoHI'],
  ['Home Affairs', 'MHA'], ['Housing and Urban Affairs', 'MoHUA'], ['Information and Broadcasting', 'MIB'],
  ['Jal Shakti', 'MoJS'], ['Labour and Employment', 'MoLE'], ['Law and Justice', 'MoLJ'],
  ['Micro, Small & Medium Enterprises', 'MSME'], ['Mines', 'MoM'], ['Minority Affairs', 'MoMA'],
  ['New and Renewable Energy', 'MNRE'], ['Panchayati Raj', 'MoPR'], ['Parliamentary Affairs', 'MPA'],
  ['Personnel, Public Grievances and Pensions', 'MoPPGP'], ['Petroleum and Natural Gas', 'MoPNG'], ['Planning', 'MoP'],
  ['Ports, Shipping and Waterways', 'MoPSW'], ['Power', 'POWER'], ['Railways', 'MoR'],
  ['Road Transport and Highways', 'MoRTH'], ['Rural Development', 'MoRD'], ['Science and Technology', 'MST'],
  ['Skill Development and Entrepreneurship', 'MSDE'], ['Social Justice and Empowerment', 'MoSJE'],
  ['Statistics and Programme Implementation', 'MoSPI'], ['Steel', 'MoS'], ['Textiles', 'MoT'], ['Tourism', 'TOUR'],
  ['Tribal Affairs', 'MoTA'], ['Women and Child Development', 'MoWCD'], ['Youth Affairs and Sports', 'MoYAS'],
];
const MINISTRY_NAMES = MINISTRIES.map((m) => m[0]);
const MIN_CODE_BY_NAME = Object.fromEntries(MINISTRIES.map((m) => [m[0], m[1]]));
const normMinistry = (s) => String(s || '').toLowerCase()
  .replace(/ministry of|department of|deptt? of|govt\.? of india|government of india/g, '')
  .replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function buildSelect(k, lbl, val, options, normalizer) {
  const nval = normalizer(val);
  const matched = val ? options.find((o) => normalizer(o) === nval) : null;
  let opts = '';
  if (val && !matched) opts += `<option value="${escapeHtml(val)}" selected>⚠ ${escapeHtml(val)} (pick standard)</option>`;
  opts += `<option value=""${!val ? ' selected' : ''}>— select —</option>`;
  opts += options.map((o) => `<option value="${escapeHtml(o)}"${matched === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
  return `<div><label>${lbl}</label><select data-k="${k}">${opts}</select></div>`;
}

// Fields that should use a native date picker (avoids free-text mis-formatting).
const DATE_FIELDS = new Set(['notification_date', 'last_date_to_apply']);

// Coerce a stored value to the yyyy-mm-dd a <input type="date"> needs.
// Accepts ISO, dd/mm/yyyy, dd-mm-yyyy (day-first). Returns '' if not coercible.
function toISODateInput(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

// Long free-text fields get a multi-line textarea so pasted blocks are editable.
const LONG_FIELDS = new Set(['essential_qualification', 'additional_details', 'functional_area']);
function fieldHtml(k, lbl, r) {
  const val = r[k] || '';
  if (k === 'organisation_type') return buildSelect(k, lbl, val, ORG_TYPES, (s) => String(s || '').toLowerCase().trim());
  if (k === 'ministry') return buildSelect(k, lbl, val, MINISTRY_NAMES, normMinistry);
  if (LONG_FIELDS.has(k)) return `<div><label>${escapeHtml(lbl)}</label><textarea data-k="${escapeHtml(k)}" rows="3">${escapeHtml(val)}</textarea></div>`;
  if (DATE_FIELDS.has(k)) {
    const iso = toISODateInput(val);
    // Empty or coercible -> native date picker (stores yyyy-mm-dd).
    if (iso || !String(val).trim()) {
      return `<div><label>${escapeHtml(lbl)}</label><input type="date" data-k="${escapeHtml(k)}" value="${escapeHtml(iso)}" /></div>`;
    }
    // Un-recognised existing value -> keep an editable text box so it's not lost.
    return `<div><label>${escapeHtml(lbl)} ⚠</label><input data-k="${escapeHtml(k)}" value="${escapeHtml(val)}" title="Unrecognised date format — re-enter as yyyy-mm-dd" /></div>`;
  }
  return `<div><label>${escapeHtml(lbl)}</label><input data-k="${escapeHtml(k)}" value="${escapeHtml(val)}" /></div>`;
}

// Prompt the admin pastes into Gemini Advanced / Claude Pro along with the deputation PDF
// (the pre-filtered, one-ad-per-page extract, NOT the full Employment News issue).
const EN_PROMPT = `# Extract & Enrich Government of India DEPUTATION Vacancies — Deputation PDF

The attached PDF is a PRE-FILTERED DEPUTATION EXTRACT, not a full Employment News issue. It was produced from one weekly Employment News issue by a tool that keeps only the deputation advertisements and emits ONE ADVERTISEMENT PER PAGE, in issue order, with a bookmark on every page. An OCR text file of the same PDF may also be attached.

If you have code execution, FIRST extract the page text programmatically (e.g. pdfplumber) and read the PDF outline with pypdf (PdfReader(...).outline) before classifying — then follow the two-pass workflow.

## Role & Prime Directive
You are extracting Government of India deputation vacancies from the attached deputation PDF and enriching each one via web search.
Prime directive: Be exhaustive. Missing a deputation vacancy is the single worst outcome — far worse than including a doubtful one. When in doubt, KEEP it and lower the confidence. Never silently drop a borderline ad.

## The TWO page numbers — read this before anything else
Every advertisement carries two different page numbers. Do not mix them up.
- source_page — the page number in THIS attached PDF, 1-based, counted from its first page. The reviewer uses it to jump straight to the ad, so it MUST index this PDF and nothing else.
- en_page — the page the ad occupied in the ORIGINAL Employment News issue. It comes from the bookmark or from the printed page, NEVER from counting this PDF.
They are almost never equal. If you cannot determine en_page, leave it "" — do not fall back to source_page.

## Bookmarks
Each page carries a bookmark shaped:
    <issue-date>-p<en-page>-<ad-number>-<organisation>
Example — 10Jul-p3-EN-14-56-Union_Public_Service_Commission — decomposes to:
- source_bookmark = "10Jul-p3-EN-14-56-Union_Public_Service_Commission" (verbatim, unparsed)
- en_issue_date   = "10Jul"   (copy the token as printed; do NOT invent a year)
- en_page         = "3"       (digits only, from the p<n> segment)
- source_ref      = "EN-14-56"
- organisation cross-check = "Union Public Service Commission" (underscores are spaces)

If the bookmark outline is not visible to you, recover what you can from the page itself: Employment News prints the advertisement number on the ad, commonly as "EN 14/56" — normalise that to "EN-14-56". Leave any part you cannot determine as "" — do not guess it and do not compute it from the other fields.

## OCR text file
If an OCR text file of this PDF is attached, prefer it when copying detailed_eligibility and additional_details verbatim — it preserves wording that a scanned page can render ambiguously. The PDF itself stays authoritative for page numbers, bookmarks and layout.

## Workflow — Two Passes (do NOT interleave)

### Pass 1 — Inventory (no enrichment yet)
Walk the PDF page by page, first to last. ONE PAGE = ONE ADVERTISEMENT: do not skip a page, do not merge two pages, and do not split one page into two ads.
For each page record: source_page, the bookmark, organisation, post name(s), and a one-line keep/drop decision.
If an advertisement visibly continues onto the next page, treat the FIRST of those pages as its source_page and note the continuation.
(Pass 1 is an internal working list only — do not include it in the final answer.)

### Pass 2 — Enrich each KEPT vacancy
For each kept vacancy:
1. Web-search for the official detailed notification on the organisation's official site — prefer .gov.in / .nic.in or the body's official domain.
2. Open it and fill ALL fields from the official source (more authoritative than the abridged ad).
3. Put the real link in official_notification_link — prefer the DIRECT PDF URL of the notification document. DO NOT use a generic homepage, a careers / "current vacancies" listing page, or a third-party job-aggregator link.
4. If no credible official source is found: fill from the ad, leave official_notification_link EMPTY, and lower confidence.

## KEEP / DROP Rule
The upstream tool already filtered this issue for deputation, so nearly every page should be KEPT. A DROP here means that filter produced a false positive.
KEEP if deputation is permitted in ANY form: "deputation"; "deputation/absorption"; "deputation (including short-term contract)" / ISTC; or deputation listed as one of several allowed modes.
DROP only when the page is CLEARLY not a deputation vacancy: pure direct recruitment; contract/tenure engagement; walk-in; apprenticeship/trainee; absorption-only.
If unsure whether deputation is allowed → KEEP with confidence "low".

## Coverage Check — run this before you answer
One page = one advertisement, so every page must be accounted for.
Confirm that each source_page from 1 to the last page of the PDF either appears at least once in your output or was explicitly dropped in Pass 1.
Row expansion means the number of ROWS may EXCEED the number of pages — that is expected and correct. What is NOT acceptable is a page with no row and no drop decision: that means you skipped it. Go back and find it.

## Row Expansion
Output ONE object per (post × location/bench × pay level). Never collapse multiple locations, benches, or levels into a single row.
Every row produced from the same page repeats that page's source_page, source_bookmark, source_ref, en_page and en_issue_date unchanged.

## Output Format
Return ONLY a JSON array — no prose, no markdown fences. Each object uses EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","detailed_eligibility","additional_details","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","source_bookmark","source_ref","en_page","en_issue_date","confidence"}

## Field Rules
- ministry: standard GoI ministry name WITHOUT the "Ministry of" / "Department of" prefix (e.g. "Agriculture and Farmers Welfare", "Home Affairs", "Personnel, Public Grievances and Pensions").
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
- level, req_level1: Pay Matrix level as a string — digits with an optional A suffix where the matrix says so (e.g. "12", "13A"). No other text.
- eligibility_tiers: array of {"level","min_years"} (both number-strings) = the feeder grades the post is open to. Include the analogous tier (the post's own level, "min_years":"0") when "analogous posts" is mentioned, plus each lower grade with its required years. Also still fill req_level1/req_level2 + min_years_experience/min_years_experience2 with the first two tiers. Example for a Level-11 post open to "(i) analogous; (ii) L10+3y; (iii) L8+5y": [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]
- notification_date, last_date_to_apply: ISO yyyy-mm-dd. If a deadline is "within N days of the notification/advertisement", compute last_date_to_apply = notification_date + N days. CRITICAL: notification_date must be the date the notification/circular was PUBLISHED (typically the Employment News issue date or the date printed on the circular). last_date_to_apply is the deadline for RECEIVING applications. These are usually 30-90 days apart and must be ordered: notification_date < last_date_to_apply. A row with notification_date AFTER last_date_to_apply will be REJECTED at ingest — re-check the source PDF before submitting. If the source PDF only shows ONE date and the text says "applications due within N days of publication", then publication = that one date and N days later = last_date_to_apply.
- official_notification_link: official sources ONLY — the DIRECT ".pdf" link or the specific circular/notification page that opens this vacancy. NEVER a generic homepage, a careers/"current vacancies" listing, or a third-party aggregator. If unsure a link is real, leave it empty. Never invent a URL.
- detailed_eligibility: COPY VERBATIM the complete eligibility / qualification conditions block exactly as printed in the source for THIS post (feeder grades & pay levels, essential and desirable qualifications, experience, age limit). Do NOT paraphrase, summarise, or reorder. "" if the ad states none.
- additional_details: any other important info about THIS post not captured by the other fields (special instructions, relaxations/concessions, reservations, post breakup, contact details, remarks/notes/conditions). Copy the relevant text; do NOT duplicate eligibility text. "" if nothing extra.
- functional_area: short summary of duties / job description.
- source_page: the page number in THIS attached deputation PDF, 1-based, as a string of digits only (e.g. "7"). Drives side-by-side verification — see "The TWO page numbers" above. Never the Employment News page.
- source_bookmark: the page's bookmark copied verbatim, unparsed (e.g. "10Jul-p3-EN-14-56-Union_Public_Service_Commission"). "" if you cannot see the bookmark outline.
- source_ref: the Employment News advertisement number, normalised to hyphens (e.g. "EN-14-56"). Read it from the bookmark, or from the ad itself where it is printed as "EN 14/56". "" if absent.
- en_page: the ORIGINAL Employment News page number, digits only, from the p<n> segment of the bookmark (e.g. "3"). "" if unknown — never copy source_page into it.
- en_issue_date: the issue-date token exactly as printed in the bookmark (e.g. "10Jul"). Do not expand it, reformat it, or add a year.
- confidence: "high" ONLY if details came from the official notification AND post, level, location and a date are all clear; otherwise "medium" or "low".

## Batching
The PDF is one ad per page, so batch by page range (e.g. pages 1-20, then 21-40); I will paste each batch separately. Keep the SAME schema every time, keep source_page numbered against the WHOLE PDF (a second batch starting at page 21 uses "21", not "1"), and never skip pages between batches.
Return [] only if the PDF genuinely contains no deputation vacancies.`;

// Prompt for a SINGLE official notification / vacancy circular (e.g. NCLT).
const NOTIF_PROMPT = `You are extracting Government of India DEPUTATION vacancies from a SINGLE official notification / vacancy circular PDF. Extract EVERY advertised post — be thorough and read all pages and annexures.

1) Set is_deputation=true for posts open on deputation or deputation/absorption basis (the norm for such circulars). Skip any post that is clearly NOT deputation.
2) Expand to ONE object per (post x location/bench x pay level). Never collapse multiple locations or levels into one row.
3) Fill ALL fields from the document. If the circular states its own reference URL, put it in official_notification_link; otherwise leave it blank (you'll attach the PDF below).
4) You may use web search to confirm the organisation's official website or any field the PDF leaves ambiguous.

Output ONLY a JSON array. Each object must use EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","detailed_eligibility","additional_details","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

Rules:
- official_notification_link must be the ACTUAL notification document (direct ".pdf" preferred), or the specific circular page — NEVER a generic homepage / listing / aggregator. Leave empty if not found. Never invent a URL.
- Dates ISO yyyy-mm-dd; if "within N days of the notification", compute last_date_to_apply = notification_date + N days. CRITICAL: notification_date is when the circular was ISSUED/PUBLISHED, last_date_to_apply is the deadline for RECEIVING applications. They must be ordered: notification_date < last_date_to_apply. A row with the dates swapped (notification_date AFTER last_date_to_apply) will be REJECTED at ingest — re-check the circular before submitting. If only one date is given, that is the publication date and the deadline is the day the application window closes (NOT the publication date).
- "level"/"req_level1" = Pay Matrix level as a string — digits with an optional A suffix where the matrix says so (e.g. "12", "13A"). No other text.
- "eligibility_tiers" = feeder grades as [{"level","min_years"}] (NUMBER strings). Include the analogous tier (post's own level, "0" years) plus each lower grade with its required years; e.g. [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]. Also still fill req_level1/2 + min_years_experience/2 from the first two tiers.
- ministry = standard GoI name WITHOUT the "Ministry of"/"Department of" prefix.
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
- detailed_eligibility = COPY VERBATIM the complete eligibility / qualification conditions block exactly as printed for THIS post (feeder grades & pay levels, qualifications, experience, age limit). Do NOT paraphrase or summarise. "" if none stated.
- additional_details = any other important info about THIS post not captured by the other fields (special instructions, relaxations/concessions, reservations, post breakup, contact details, remarks/notes). Copy the relevant text; do NOT duplicate eligibility text. "" if nothing extra.
- source_page = PDF page number of the post (string).
- confidence: "high" only if post, level, location AND a date are all clear.`;

function minCode(ministry) {
  const c = String(ministry || '').replace(/ministry of|department of|govt\.? of india|government of india/gi, '')
    .replace(/[^A-Za-z ]/g, ' ').trim();
  const w = c.split(/\s+/).filter(Boolean);
  return w.map((x) => x[0].toUpperCase()).join('').slice(0, 5) || 'DEP';
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// Server-side validation for pasted/extracted rows. Mirrors validateAndFixDates
// in supabase/functions/extract/index.ts — keep these in sync. Three invariants:
//   1. notification_date parses as ISO yyyy-mm-dd
//   2. notification_date <= today  (a notification can't be in the future)
//   3. notification_date <  last_date_to_apply  (notify precedes close)
// If 3 fails but a swap satisfies all three, swap. Otherwise flag the row
// (low confidence + extra in raw_extraction) so it reaches Review instead of
// silently shipping a bad date. Returns { nd, ld, confidence, fixNote }.
function validateAndFixDates(it, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const parse = (s) => {
    const t = String(s || '').trim();
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const toIso = (d) => d.toISOString().slice(0, 10);
  const nd = parse(it.notification_date);
  const ld = parse(it.last_date_to_apply);
  if (!nd && !ld) return { nd: it.notification_date || '', ld: it.last_date_to_apply || '', confidence: it.confidence || 'medium', fixNote: '' };
  if (!nd || !ld) return { nd: it.notification_date || '', ld: it.last_date_to_apply || '', confidence: 'low', fixNote: 'missing-date' };
  // Natural order ok?
  if (nd < ld && nd <= today) return { nd: toIso(nd), ld: toIso(ld), confidence: it.confidence || 'medium', fixNote: '' };
  // Swap attempt — only if both dates are in the past and ordering becomes valid.
  if (ld < nd && ld <= today) {
    return { nd: toIso(ld), ld: toIso(nd), confidence: it.confidence || 'medium', fixNote: 'auto-swapped-nd-ld' };
  }
  // Future-date attempt (LD in the past, ND in the future → swap fixes ordering but ND is still future)
  if (nd > today && ld <= today && ld < nd) {
    return { nd: toIso(ld), ld: toIso(nd), confidence: 'medium', fixNote: 'auto-swapped-future-nd' };
  }
  // Both invariants fail; can't fix. Flag for human review.
  return { nd: it.notification_date || '', ld: it.last_date_to_apply || '', confidence: 'low', fixNote: 'date-mismatch-needs-review' };
}

function mapPasted(it, jobId, label, year, i, sourceFileUrl) {
  const lvl = levelTok(it.level || it.req_level1 || '');   // keeps "13A"
  const mc = minCode(it.ministry);
  const dv = validateAndFixDates(it);
  // Bake any date fix back into the row so downstream sees the swapped values.
  it.notification_date = dv.nd;
  it.last_date_to_apply = dv.ld;
  return {
    vacancy_id: `${mc}-${year}-L${lvl || 'X'}-${String(i + 1).padStart(3, '0')}`,
    ministry: it.ministry || '', min_code: mc, department: it.department || '', organisation: it.organisation || '',
    organisation_type: it.organisation_type || '', post_name: it.post_name || '',
    level: lvl, level_text: lvl ? `Level-${lvl}` : '',
    location_city: it.location_city || '', location_state: it.location_state || '',
    req_level1: levelTok(it.req_level1 || lvl || ''), req_level2: levelTok(it.req_level2 || ''),
    min_years_experience: String(it.min_years_experience || ''), min_years_experience2: String(it.min_years_experience2 || ''),
    // store tiers with TOKEN levels ("13A") — ranks (13.5) would mangle on re-parse
    eligibility_tiers: tiersFor(it).map((t) => ({ level: t.label || String(t.level), min_years: t.min_years })),
    no_of_posts: String(it.no_of_posts || ''), deputation_period_years: String(it.deputation_period_years || ''),
    deputation_type: it.deputation_type || '', notification_date: dv.nd, last_date_to_apply: dv.ld,
    official_notification_link: it.official_notification_link || '', application_form_link: it.application_form_link || '',
    source_website: it.source_website || '', essential_qualification: it.essential_qualification || '',
    additional_details: it.additional_details || '',
    eligible_service: it.eligible_service || '', mode_of_application: it.mode_of_application || '',
    functional_area: it.functional_area || '', tags_keywords: it.tags_keywords || '',
    status: 'draft', confidence: dv.confidence, source_type: 'employment_news',
    source_category: label || 'Pasted import', source_file_url: sourceFileUrl || '',
    ingest_job_id: jobId, raw_extraction: it, date_fix_note: dv.fixNote,
  };
}

function parsePastedArray(raw) {
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : (Array.isArray(j?.vacancies) ? j.vacancies : null); }
  catch { /* fall through to substring scan */ }
  const m = t.match(/\[[\s\S]*\]/);            // pull the array out of surrounding prose
  if (m) { try { return JSON.parse(m[0]); } catch { /* */ } }
  return null;
}

/* ---------------- smart duplicate-merge (mirrors extract/index.ts) ----------------
 * NOTE: keysOf / smartMerge / CONTENT_FIELDS are duplicated in the extract Edge
 * Function (Deno). Keep the two copies in sync. */
const CONTENT_FIELDS = [
  'ministry', 'min_code', 'department', 'organisation', 'organisation_type',
  'post_name', 'level', 'level_text', 'location_city', 'location_state',
  'req_level1', 'req_level2', 'min_years_experience', 'min_years_experience2',
  'eligibility_tiers', 'no_of_posts', 'deputation_period_years', 'deputation_type',
  'notification_date', 'last_date_to_apply', 'official_notification_link',
  'application_form_link', 'source_website', 'functional_area',
  'essential_qualification', 'additional_details', 'eligible_service', 'mode_of_application', 'tags_keywords',
];
const normPart = (s) => String(s ?? '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
// Keeps the A of "13A" (lowercased) so 13 and 13A posts get distinct keys.
// MUST stay byte-identical to the SQL in migrations 0002/0006/0008:
//   lower(regexp_replace(coalesce(level,''), '[^0-9Aa]', '', 'g'))
const normLevel = (s) => String(s ?? '').replace(/[^0-9Aa]/g, '').toLowerCase();
// Replicates the generated dedup_key (0002) and match_key (0006) exactly.
//   matchKey = org|post|city|level (= DB match_key), emptyKey = org|post|city|
//   (empty-level twin), prefix = org|post|city (level-free grouping).
function keysOf(row) {
  const org = normPart(row.organisation); const post = normPart(row.post_name);
  const city = normPart(row.location_city); const lvl = normLevel(row.level);
  const date = String(row.notification_date ?? '').toLowerCase();
  const prefix = `${org}|${post}|${city}`;
  return { prefix, matchKey: `${prefix}|${lvl}`, emptyKey: `${prefix}|`, dedupKey: `${prefix}|${lvl}|${date}` };
}
// Levels are compatible when equal, or when either side is blank (unknown).
const lvlCompat = (a, b) => { const x = normLevel(a); const y = normLevel(b); return !x || !y || x === y; };
const dedupKey = (o) => keysOf(o).dedupKey;

const isEmptyVal = (v) =>
  v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
const sameVal = (a, b) =>
  (Array.isArray(a) || Array.isArray(b))
    ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    : String(a ?? '').trim() === String(b ?? '').trim();

// Fill blanks + overwrite only with a differing non-empty value; never blanks
// out existing data. Returns the changed-fields patch (not the whole row).
function smartMerge(existing, candidate) {
  const patch = {}; const diff = {};
  for (const f of CONTENT_FIELDS) {
    if (!isEmptyVal(candidate[f]) && !sameVal(candidate[f], existing[f])) {
      patch[f] = candidate[f]; diff[f] = { old: existing[f] ?? '', new: candidate[f] };
    }
  }
  if (candidate.source_type === 'notification') {  // official circular supersedes EN/tip provenance
    for (const f of ['source_type', 'source_category', 'source_file_url']) {
      if (!isEmptyVal(candidate[f]) && !sameVal(candidate[f], existing[f])) {
        patch[f] = candidate[f]; diff[f] = { old: existing[f] ?? '', new: candidate[f] };
      }
    }
    if (candidate.raw_extraction) patch.raw_extraction = candidate.raw_extraction;
  }
  return { patch, diff, changed: Object.keys(diff).length > 0 };
}

function summarizeIngest(r) {
  const p = [];
  if (r.inserted) p.push(`${r.inserted} new`);
  if (r.draftUpdated) p.push(`${r.draftUpdated} draft enriched`);
  if (r.updatesQueued) p.push(`${r.updatesQueued} update${r.updatesQueued > 1 ? 's' : ''} queued`);
  if (r.duplicatesFlagged) p.push(`${r.duplicatesFlagged} possible dup${r.duplicatesFlagged > 1 ? 's' : ''}`);
  if (r.unchanged) p.push(`${r.unchanged} unchanged`);
  if (r.skipped) p.push(`${r.skipped} skipped (already exist or rejected)`);
  return '✅ ' + (p.length ? p.join(', ') : 'nothing to import');
}

// Match each candidate against existing vacancies, then insert new drafts,
// merge into matching drafts, or queue updates / duplicate suggestions.
async function applyMergeImport(rows) {
  const sel = ['id', 'status', 'dedup_key', 'match_key', 'source_type',
    'source_category', 'source_file_url', ...CONTENT_FIELDS].join(',');
  const keyed = rows.map((r) => ({ r, ...keysOf(r) }));
  // Look up the exact-level key AND the empty-level twin of each post.
  const lookupKeys = [...new Set(keyed.flatMap((k) => [k.matchKey, k.emptyKey]).filter(Boolean))];

  const existing = [];
  for (let i = 0; i < lookupKeys.length; i += 100) {
    const enc = lookupKeys.slice(i, i + 100).map(encodeURIComponent).join(',');
    // rejected rows must NOT be merge targets (they'd silently absorb re-imports
    // while staying invisible) — mirrored in extract/index.ts, keep in sync
    const r = await api(`/rest/v1/vacancies?select=${sel}&status=neq.rejected&match_key=in.(${enc})`);
    if (!r.ok) throw new Error('Match lookup failed: ' + (await r.text()));
    existing.push(...await r.json());
  }
  // Group by level-free prefix; lvlCompat keeps genuinely different levels apart.
  const byPrefix = new Map();
  for (const e of existing) {
    const p = keysOf(e).prefix;
    const a = byPrefix.get(p) || []; a.push(e); byPrefix.set(p, a);
  }
  // Same vacancy & cycle: equal notification dates (a blank date is a wildcard).
  const dnorm = (s) => String(s ?? '').trim().toLowerCase();
  const sameCycle = (a, b) => { const x = dnorm(a); const y = dnorm(b); return !x || !y || x === y; };

  const toInsert = []; const draftPatches = []; const updateRows = [];
  let unchanged = 0;
  for (const { r, prefix } of keyed) {
    const pool = (byPrefix.get(prefix) || []).filter((e) => lvlCompat(e.level, r.level));
    const same = pool.filter((e) => sameCycle(e.notification_date, r.notification_date));
    // Prefer the live (approved) row so re-uploads enrich what's public.
    const target = same.find((e) => e.status === 'approved') || same.find((e) => e.status !== 'approved');
    if (target) {
      const { patch, diff, changed } = smartMerge(target, r);
      if (!changed) { unchanged++; continue; }
      if (target.status === 'approved') {
        updateRows.push({ target_id: target.id, kind: 'update', proposed: patch, diff, source_type: r.source_type, source_category: r.source_category, source_file_url: r.source_file_url, confidence: r.confidence, ingest_job_id: r.ingest_job_id });
      } else { draftPatches.push({ id: target.id, patch }); }
      continue;
    }
    const other = pool.filter((e) => !sameCycle(e.notification_date, r.notification_date));
    if (other.length) {
      const dupTarget = other.find((e) => e.status === 'approved') || other[0];
      const { diff } = smartMerge(dupTarget, r);
      updateRows.push({ target_id: dupTarget.id, kind: 'duplicate', proposed: r, diff, source_type: r.source_type, source_category: r.source_category, source_file_url: r.source_file_url, confidence: r.confidence, ingest_job_id: r.ingest_job_id });
      continue;
    }
    toInsert.push(r);
  }

  let inserted = 0;
  if (toInsert.length) {
    const ins = await api('/rest/v1/vacancies?on_conflict=dedup_key', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify(toInsert),
    });
    if (!ins.ok) throw new Error('Insert failed: ' + (await ins.text()));
    const ir = await ins.json().catch(() => []);
    inserted = Array.isArray(ir) ? ir.length : toInsert.length;
  }
  // rows the DB silently skipped on dedup_key conflict — usually a vacancy that
  // was already imported, or one previously REJECTED (remembered rejection)
  const skipped = Math.max(0, toInsert.length - inserted);
  let draftUpdated = 0;
  for (const { id, patch } of draftPatches) {
    const pr = await api(`/rest/v1/vacancies?id=eq.${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (pr.ok) draftUpdated++;
  }
  let updatesQueued = 0; let duplicatesFlagged = 0;
  if (updateRows.length) {
    const ur = await api('/rest/v1/vacancy_updates', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(updateRows),
    });
    if (!ur.ok) throw new Error('Updates insert failed: ' + (await ur.text()));
    updatesQueued = updateRows.filter((u) => u.kind === 'update').length;
    duplicatesFlagged = updateRows.filter((u) => u.kind === 'duplicate').length;
  }
  return { inserted, skipped, draftUpdated, updatesQueued, duplicatesFlagged, unchanged };
}

async function importPasted(label, st) {
  const raw = $('pasteJson').value.trim();
  if (!raw) throw new Error('Paste the JSON array first');
  let items = parsePastedArray(raw);
  if (!items) throw new Error('Could not find a JSON array — copy the model\'s [ ... ] output (prose/code-fences are OK).');
  items = items.filter((x) => x && x.post_name);
  if (!items.length) throw new Error('No rows with a post_name found.');

  st.innerHTML = '<span class="spinner"></span> Importing…';

  // remove exact duplicates WITHIN this paste; duplicates against rows already
  // stored (draft or approved) are rejected by the DB unique key on insert.
  const before = items.length;
  const seen = new Set();
  items = items.filter((it) => { const k = dedupKey(it); if (seen.has(k)) return false; seen.add(k); return true; });
  // optional: store the EN PDF so review can show pages side-by-side
  let enPdfPath = '';
  const enFile = $('enPdf').files[0];
  if (enFile) {
    // Explicit client cap (Edge Function payload + base64 inflation make
    // larger uploads unreliable). Hard-refresh the page if the old 15 MB
    // message is still showing — that came from a cached build.
    if (enFile.size > 20 * 1024 * 1024) throw new Error(`EN PDF is ${(enFile.size / 1048576).toFixed(1)} MB — limit is 20 MB. Compress it (e.g. ilovepdf.com → Compress PDF) or split the issue and import each half.`);
    st.innerHTML = '<span class="spinner"></span> Uploading EN PDF…';
    const b64 = await fileToBase64(enFile);
    const upRes = await api('/functions/v1/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_only: true, filename: enFile.name, file_base64: b64 }),
    });
    const upD = await upRes.json().catch(() => ({}));
    if (upRes.ok && upD.path) enPdfPath = upD.path;
    else toast('EN PDF upload failed — importing rows without side-by-side');
  }

  st.innerHTML = '<span class="spinner"></span> Importing…';
  const jobRes = await api('/rest/v1/ingest_jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ source_type: 'employment_news', source_label: label || 'Pasted import', source_file_url: enPdfPath || null, status: 'done', rows_extracted: items.length }),
  });
  if (!jobRes.ok) throw new Error('Could not create job: ' + (await jobRes.text()));
  const job = (await jobRes.json())[0];
  const year = new Date().getFullYear();
  const rows = items.map((it, i) => mapPasted(it, job.id, label, year, i, enPdfPath));
  // hybrid dedupe + smart merge: new -> draft; exact match -> enrich draft or
  // queue an update for a live row; loose match -> a possible-duplicate suggestion.
  const res = await applyMergeImport(rows);
  await api(`/rest/v1/ingest_jobs?id=eq.${job.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ rows_extracted: res.inserted }),
  }).catch(() => {});
  const msg = summarizeIngest(res);
  st.textContent = msg + ' — see the Review & Updates tabs.';
  toast(msg);
  $('pasteJson').value = '';
  $('enPdf').value = '';
  refreshUpdatesCount();
  document.querySelector('[data-tab="review"]').click();
}

/* ================================================================= */
if (!window.SUPABASE_READY || !window.SUPABASE_READY()) {
  $('setupCard').classList.remove('hidden');
} else {
  boot().catch((e) => { console.error(e); showLogin('Startup error: ' + e.message); });
}

function showLogin(msg) {
  $('app').classList.add('hidden');
  $('setupCard').classList.add('hidden');
  $('loginCard').classList.remove('hidden');
  if (msg) $('loginMsg').textContent = msg;
}

async function boot() {
  captureHashTokens();
  let sess = await refreshIfNeeded(loadSess());

  // wire login button regardless of state
  $('loginBtn').onclick = async () => {
    const email = $('loginEmail').value.trim();
    if (!email) return toast('Enter your email');
    const redirect = location.origin + location.pathname;
    try {
      const r = await fetch(`${SB}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, create_user: true }),
      });
      $('loginMsg').textContent = r.ok
        ? '✅ Magic link sent. Open it on this device to sign in.'
        : '❌ ' + (await r.text());
    } catch (e) { $('loginMsg').textContent = '❌ ' + e.message; }
  };
  $('logoutBtn').onclick = () => { clearSess(); location.reload(); };

  if (!sess) { showLogin(); return; }
  TOKEN = sess.access_token;

  // confirm admin (RLS lets a user read only their own admins row)
  let admin = false;
  try {
    const r = await api(`/rest/v1/admins?select=email&email=ilike.${encodeURIComponent(sess.email)}`);
    admin = r.ok && (await r.json()).length > 0;
  } catch { /* fall through */ }

  $('who').textContent = sess.email + (admin ? '' : ' — not an admin');
  $('logoutBtn').classList.remove('hidden');
  if (!admin) { showLogin('This email is not on the admin allow-list. Sign out and use an admin email.'); return; }

  $('loginCard').classList.add('hidden');
  $('app').classList.remove('hidden');
  wireApp();
  loadDrafts();          // also fills the Review badge + the bulk-op id list
  loadOverview();        // overview chips + tab badges (count-only queries)
  // restore the last active tab (Review's data is already loading above)
  const savedTab = loadUI().tab;
  if (savedTab && savedTab !== 'ingest' && savedTab !== 'review') {
    document.querySelector(`.tabs button[data-tab="${savedTab}"]`)?.click();
  } else if (savedTab === 'review') {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'review'));
    $('paneIngest').classList.add('hidden');
    $('paneReview').classList.remove('hidden');
  }
  refreshReviewBadges();   // ensure the Marked badge populates even if Marked isn't the active tab
}

/* ---------------- WhatsApp channel poster (local bridge) ---------------- */
// The admin page can't post to a WhatsApp Channel directly (Channels have no API
// and a web page can't drive WhatsApp Web). A small local helper
// (scripts/whatsapp_bridge.py) holds a logged-in WhatsApp Web session and does
// the posting; this button just triggers it on localhost.
const WA_BRIDGE = (window.WA_BRIDGE_URL || 'http://127.0.0.1:8787');

async function sendWhatsappUpdate() {
  const btn = $('mgWaBtn'), st = $('mgWaStatus');
  const done = (msg) => { if (st) st.textContent = msg || ''; btn.disabled = false; };
  btn.disabled = true; if (st) st.textContent = 'Checking helper…';

  // 1) Is the local helper running and logged in?
  let health;
  try {
    health = await (await fetch(`${WA_BRIDGE}/health`)).json();
  } catch {
    done('');
    toast('WhatsApp helper not running. Start it: python scripts/whatsapp_bridge.py');
    return;
  }
  if (!health.logged_in) {
    done('');
    toast('Helper running, but WhatsApp Web isn’t logged in — run: whatsapp_watcher.py --login');
    return;
  }

  // 2) What's pending?
  let pend;
  try {
    pend = await (await fetch(`${WA_BRIDGE}/pending`)).json();
  } catch (e) { done(''); toast('Helper error: ' + e.message); return; }
  const n = pend.count || 0;
  if (n === 0) { done('Nothing new to post.'); toast('Nothing new to post.'); return; }

  // 3) Confirm, then post.
  if (!confirm(`Post ${n} new vacanc${n === 1 ? 'y' : 'ies'} to the WhatsApp channel now?`)) {
    done('');
    return;
  }
  if (st) st.textContent = `Posting ${n}…`;
  try {
    const r = await fetch(`${WA_BRIDGE}/post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error || ('HTTP ' + r.status));
    const okN = (d.posted || []).length, failN = (d.failed || []).length;
    done(`Posted ${okN}${failN ? `, ${failN} failed` : ''}.`);
    toast(`✅ Posted ${okN} to WhatsApp${failN ? ` · ${failN} failed` : ''}`);
  } catch (e) {
    done('');
    toast('Post failed: ' + e.message);
  }
}

/* ---------------- overview strip (Ingest tab) ---------------- */
// Count-only chips (drafts / updates / flags / closing soon) that double as
// shortcuts to their tabs, the last few ingest jobs (incl. errors), and the
// WhatsApp pending count when the local bridge is up.
async function loadOverview() {
  const strip = $('ovStrip');
  if (!strip) return;
  const iso = (d) => d.toISOString().slice(0, 10);
  const [drafts, marked, updates, flags, closing, feedbackNew] = await Promise.all([
    countOf('vacancies?status=eq.draft&marked_for_review=eq.false'),
    countOf('vacancies?status=eq.draft&marked_for_review=eq.true'),
    countOf('vacancy_updates?status=eq.pending'),
    countOf('vacancy_flags?status=eq.open'),
    countOf(`vacancies?status=eq.approved&last_date_to_apply=gte.${iso(new Date())}&last_date_to_apply=lte.${iso(new Date(Date.now() + 7 * 86400000))}`),
    countOf('feedback?status=eq.new'),
  ]);
  const chip = (n, label, tab, tone) => `<button type="button" class="ov${n && tone ? ' ' + tone : ''}" data-goto="${tab}"><b>${n}</b> ${label}</button>`;
  strip.innerHTML =
    chip(drafts, 'drafts to review', 'review', 'warn') +
    chip(marked, '🚩 marked for review', 'marked', '') +
    chip(updates, 'pending updates', 'updates', 'warn') +
    chip(flags, 'open flags', 'flags', 'bad') +
    chip(feedbackNew, 'new feedback', 'feedback', 'warn') +
    chip(closing, 'live, closing ≤7d', 'manage', '');
  strip.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.goto === 'manage') {
        // the "closing ≤7d" chip: land on live rows, soonest last-date first
        if ($('mgStatus')) $('mgStatus').value = 'approved';
        if ($('mgSearch')) $('mgSearch').value = '';
        if ($('mgSort')) $('mgSort').value = 'lastdate_asc';
        MG_PAGE = 1;
        saveUI({ mgStatus: 'approved', mgSearch: '', mgSort: 'lastdate_asc', mgPage: 1 });
      }
      document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`)?.click();
    };
  });
  // keep the tab badges in sync from the same counts
  if ($('draftCount')) $('draftCount').textContent = drafts ? `(${drafts})` : '';
  if ($('markedCount')) $('markedCount').textContent = marked ? `(${marked})` : '';
  if ($('updatesCount')) $('updatesCount').textContent = updates ? `(${updates})` : '';
  if ($('flagCount')) $('flagCount').textContent = flags ? `(${flags})` : '';
  if ($('fbCount')) $('fbCount').textContent = feedbackNew ? `(${feedbackNew})` : '';
  loadVerifyCount();
  loadRecentJobs();
  loadWaOverview();
}

async function loadRecentJobs() {
  const host = $('ovJobs');
  if (!host) return;
  try {
    const r = await api('/rest/v1/ingest_jobs?select=source_label,source_type,status,error,rows_extracted,created_at&order=created_at.desc&limit=5');
    if (!r.ok) return;
    const jobs = await r.json();
    if (!jobs.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<b style="font-size:13px;color:var(--txt)">Recent ingests</b>' + jobs.map((j) => {
      const ic = j.status === 'done' ? '✅' : (j.status === 'error' ? '❌' : '⏳');
      const when = String(j.created_at || '').slice(0, 16).replace('T', ' ');
      return `<div style="margin-top:3px">${ic} ${escapeHtml(j.source_label || j.source_type || 'job')} · ${escapeHtml(when)} · ${j.rows_extracted ?? 0} row(s)${j.error ? ` · <span style="color:var(--bad)">${escapeHtml(String(j.error).slice(0, 140))}</span>` : ''}</div>`;
    }).join('');
  } catch { /* best effort */ }
}

// WhatsApp pending line on the overview — silent when the bridge is down.
async function loadWaOverview() {
  const el = $('ovWa');
  if (!el) return;
  el.textContent = '';
  await refreshWaPending();
  if (WA_PENDING === null) return;
  el.innerHTML = WA_PENDING.size
    ? `📣 <b>${WA_PENDING.size}</b> approved vacanc${WA_PENDING.size === 1 ? 'y' : 'ies'} not yet posted to WhatsApp — see Manage data`
    : '📣 WhatsApp channel is up to date';
}

/* ---------------- app wiring ---------------- */
function wireApp() {
  // restore persisted UI state (filters / sort / quick chips); the dynamic
  // Level/Source dropdowns are restored one-shot inside populateDraft*Filter
  const ui = loadUI();
  if (ui.draftSort) DRAFT_SORT = ui.draftSort;
  DRAFT_QUICK = new Set(Array.isArray(ui.draftQuick) ? ui.draftQuick : []);
  // a stale saved state may predate the active↔expired mutual exclusion
  if (DRAFT_QUICK.has('active') && DRAFT_QUICK.has('expired')) { DRAFT_QUICK.delete('active'); DRAFT_QUICK.delete('expired'); }
  MG_PAGE = Math.max(1, parseInt(ui.mgPage, 10) || 1);
  RESTORE_LEVEL = ui.draftLevel || '';
  RESTORE_SOURCE = ui.draftSource || '';
  RESTORE_MG_SOURCE = ui.mgSource || '';
  if ($('draftSearch')) $('draftSearch').value = ui.draftSearch || '';
  if ($('mgSearch')) $('mgSearch').value = ui.mgSearch || '';
  if (ui.mgStatus && $('mgStatus')) $('mgStatus').value = ui.mgStatus;
  if (ui.flagStatus && $('flagStatus')) $('flagStatus').value = ui.flagStatus;
  if (ui.fbStatus && $('fbStatus')) $('fbStatus').value = ui.fbStatus;

  // tabs. Review queue and Marked share #paneReview — the only difference is
  // which set of drafts loadDrafts() pulls (REVIEW_VIEW filter).
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      saveUI({ tab: t });
      const reviewish = (t === 'review' || t === 'marked');
      $('paneIngest').classList.toggle('hidden', t !== 'ingest');
      $('paneReview').classList.toggle('hidden', !reviewish);
      $('paneManage').classList.toggle('hidden', t !== 'manage');
      $('paneFlags').classList.toggle('hidden', t !== 'flags');
      $('paneFeedback').classList.toggle('hidden', t !== 'feedback');
      $('paneUpdates').classList.toggle('hidden', t !== 'updates');
      $('paneVerify').classList.toggle('hidden', t !== 'verify');
      $('paneProjects').classList.toggle('hidden', t !== 'projects');
      // leaving Manage by hand clears any flag-comparison context so it doesn't
      // re-trigger on a later manual visit (the flag's Open button re-sets it)
      if (t !== 'manage') ACTIVE_FLAG = null;
      if (t === 'ingest') loadOverview();
      if (reviewish) { REVIEW_VIEW = (t === 'marked') ? 'marked' : 'review'; loadDrafts(); }
      if (t === 'manage') loadManage();
      if (t === 'flags') loadFlags();
      if (t === 'feedback') loadFeedback();
      if (t === 'updates') loadUpdates();
      if (t === 'verify') loadVerifyQueue();
      if (t === 'projects') loadProjectsAdmin();
    };
  });

  // Verify tab wiring
  if ($('vfRefresh')) $('vfRefresh').onclick = () => loadVerifyQueue();
  if ($('vfVerifyChecked')) $('vfVerifyChecked').onclick = verifyChecked;
  if ($('vfVerifyAll')) $('vfVerifyAll').onclick = verifyAllPending;
  if ($('vfCheckAll')) $('vfCheckAll').onclick = (e) => {
    $('vfList').querySelectorAll('input[data-vf-id]').forEach((c) => { c.checked = e.currentTarget.checked; });
    updateVerifyBulkBar();
  };

  // Deep-link from Verify ✎ Edit → Manage data, auto-opening this row's editor.
  // OPEN_MANAGE_ROW is consumed inside loadManage() once the card list is on screen.
  // Using the same pane-toggles as the real tab handler keeps the badge / saveUI
  // side-effects (tab persistence, mark-flag context) identical to a manual click.
  window.openManageForRow = (id) => {
    OPEN_MANAGE_ROW = String(id);
    // Reset any persisted Manage filter that could hide the row:
    //   - MG_PAGE comes from saveUI({mgPage:...}) — the admin's last page (e.g. 7)
    //     lands on a slice that doesn't contain the Verify row.
    //   - mgStatus saved as draft/rejected/marked excludes approved rows.
    //   - mgSearch / mgSource from a prior session may not match the row.
    // The Verify tab only deals with approved rows, so landing on the approved
    // status + page 1 + empty search is always where the row lives.
    MG_PAGE = 1;
    if ($('mgStatus')) $('mgStatus').value = 'approved';
    if ($('mgSearch')) $('mgSearch').value = '';
    if ($('mgSource')) $('mgSource').value = '';
    saveUI({ mgPage: 1, mgStatus: 'approved', mgSearch: '', mgSource: '' });
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
    const manageBtn = document.querySelector('.tabs button[data-tab="manage"]');
    if (manageBtn) manageBtn.classList.add('active');
    $('paneIngest').classList.add('hidden');
    $('paneReview').classList.add('hidden');
    $('paneManage').classList.remove('hidden');
    $('paneFlags').classList.add('hidden');
    $('paneFeedback').classList.add('hidden');
    $('paneUpdates').classList.add('hidden');
    $('paneVerify').classList.add('hidden');
    $('paneProjects').classList.add('hidden');
    // Note: ACTIVE_FLAG is intentionally NOT cleared here (we're entering Manage,
    // not leaving it) — the original handler clears it on `t !== 'manage'` only.
    saveUI({ tab: 'manage' });
    loadManage();
  };

  // Projects CMS (V² upcoming-projects) wiring
  if ($('projRefresh')) $('projRefresh').onclick = loadProjectsAdmin;
  if ($('projAddBtn')) $('projAddBtn').onclick = () => openProjectForm(null);
  if ($('pf_save')) $('pf_save').onclick = saveProject;
  if ($('pf_cancel')) $('pf_cancel').onclick = () => $('projForm').classList.add('hidden');

  if ($('updRefresh')) $('updRefresh').onclick = loadUpdates;
  if ($('updSort')) $('updSort').onchange = () => { saveUI({ updSort: $('updSort').value }); renderUpdates(); };   // client-side re-sort, no refetch

  $('flagRefresh').onclick = loadFlags;
  $('flagStatus').onchange = () => { saveUI({ flagStatus: $('flagStatus').value }); loadFlags(); };

  $('fbRefresh').onclick = loadFeedback;
  $('fbStatus').onchange = () => { saveUI({ fbStatus: $('fbStatus').value }); loadFeedback(); };

  $('mgRefresh').onclick = loadManage;
  $('mgStatus').onchange = () => { MG_PAGE = 1; saveUI({ mgStatus: $('mgStatus').value, mgPage: 1 }); loadManage(); };
  if ($('mgSource')) $('mgSource').onchange = () => {
    const v = $('mgSource').value;
    MG_PAGE = 1; saveUI({ mgSource: v, mgPage: 1 });
    renderManage();
  };
  // Populate all three sort dropdowns from the shared option list (keeps them
  // in sync). Review queue defaults to 'source'; Manage/Updates to 'upload'.
  if ($('draftSort')) $('draftSort').innerHTML = sortOptionsHtml(DRAFT_SORT);
  if ($('mgSort')) $('mgSort').innerHTML = sortOptionsHtml(ui.mgSort || 'upload');
  if ($('updSort')) $('updSort').innerHTML = sortOptionsHtml(ui.updSort || 'upload');
  if ($('mgSort')) $('mgSort').onchange = () => { MG_PAGE = 1; saveUI({ mgSort: $('mgSort').value, mgPage: 1 }); renderManage(); };   // client-side re-sort, no refetch
  let _mgFilterTimer = null;
  $('mgSearch').oninput = () => { clearTimeout(_mgFilterTimer); _mgFilterTimer = setTimeout(() => { MG_PAGE = 1; saveUI({ mgSearch: $('mgSearch').value, mgPage: 1 }); renderManage(); }, 200); };
  if ($('draftSort')) $('draftSort').onchange = () => { DRAFT_SORT = $('draftSort').value; saveUI({ draftSort: DRAFT_SORT }); DRAFT_PAGE = 1; renderDrafts(); };
  if ($('draftLevel')) $('draftLevel').onchange = () => { saveUI({ draftLevel: $('draftLevel').value }); DRAFT_PAGE = 1; renderDrafts(); };
  if ($('draftSource')) $('draftSource').onchange = () => { saveUI({ draftSource: $('draftSource').value }); DRAFT_PAGE = 1; renderDrafts(); };
  let _draftFilterTimer = null;
  if ($('draftSearch')) $('draftSearch').oninput = () => { clearTimeout(_draftFilterTimer); _draftFilterTimer = setTimeout(() => { saveUI({ draftSearch: $('draftSearch').value }); DRAFT_PAGE = 1; renderDrafts(); }, 200); };

  // quick-filter chips (Review): High/Med/Low OR-combine; the rest AND-combine.
  // active ↔ expired are opposites, so turning one on turns the other off.
  if ($('draftQuick')) $('draftQuick').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', DRAFT_QUICK.has(b.dataset.q));
    b.onclick = () => {
      const k = b.dataset.q;
      if (DRAFT_QUICK.has(k)) {
        DRAFT_QUICK.delete(k);
      } else {
        DRAFT_QUICK.add(k);
        const opp = { active: 'expired', expired: 'active' }[k];
        if (opp) DRAFT_QUICK.delete(opp);
      }
      $('draftQuick').querySelectorAll('button').forEach((x) => x.classList.toggle('on', DRAFT_QUICK.has(x.dataset.q)));
      saveUI({ draftQuick: [...DRAFT_QUICK] });
      DRAFT_PAGE = 1; renderDrafts();
    };
  });

  // keyboard triage on the Review queue — see kbHelp overlay (?)
  document.addEventListener('keydown', onReviewKeydown);

  if ($('mgPurgeBtn')) $('mgPurgeBtn').onclick = async () => {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const filt = `vacancies?status=eq.rejected&updated_at=lt.${encodeURIComponent(cutoff)}`;
    const n = await countOf(filt);
    if (!n) return toast('No rejected rows older than 30 days');
    if (!confirm(`Permanently delete ${n} rejected row(s) older than 30 days?\nThis cannot be undone.`)) return;
    try {
      const r = await api(`/rest/v1/${filt}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast(`🧹 Purged ${n} rejected row(s)`); loadManage();
    } catch (e) { toast('Purge failed: ' + e.message); }
  };
  $('mgAddBtn').onclick = () => {
    const blank = { id: null, status: 'approved', source_type: 'manual' };
    $('manageList').prepend(manageCard(blank, true));
  };
  if ($('mgWaBtn')) $('mgWaBtn').onclick = sendWhatsappUpdate;

  // Mount a fresh "new vacancy" editor in the Ingest > Manual block. Reuses the
  // same manageCard(blank,true) editor as Manage's "+ Add vacancy". After a
  // successful Create the card removes itself, so we re-mount a blank one (via a
  // MutationObserver) to let the admin keep adding rows.
  function mountManualCard() {
    const host = $('manualHost');
    if (!host) return;
    host.innerHTML = '';
    const card = manageCard({ id: null, status: 'draft', source_type: 'manual' }, true);
    card.querySelector('[data-act="cancel"]')?.remove();   // no list to return to here
    host.appendChild(card);
    // when this card is removed (Create succeeded), offer a fresh one
    const obs = new MutationObserver(() => {
      if (!host.contains(card)) {
        obs.disconnect();
        if (!$('manualBlock').classList.contains('hidden')) mountManualCard();
      }
    });
    obs.observe(host, { childList: true });
  }

  // source type toggle
  $('srcType').onchange = () => {
    const t = $('srcType').value;
    const manual = t === 'manual';
    $('urlBlock').classList.toggle('hidden', t !== 'url');
    $('pasteBlock').classList.toggle('hidden', t !== 'paste');
    $('fileBlock').classList.toggle('hidden', t === 'url' || t === 'paste' || manual);
    // Manual entry: hide the label + extract button, show an inline editor card
    // (the same full editor used by Manage's "+ Add vacancy").
    if ($('manualBlock')) $('manualBlock').classList.toggle('hidden', !manual);
    if ($('labelBlock')) $('labelBlock').classList.toggle('hidden', manual);
    if ($('ingestActions')) $('ingestActions').classList.toggle('hidden', manual);
    if (manual) {
      mountManualCard();
    } else {
      $('ingestBtn').textContent = t === 'paste' ? 'Import rows' : 'Extract vacancies';
    }
  };

  $('providerStatusBtn').onclick = async () => {
    const s = $('providerStatus'); s.textContent = 'Checking… (uses ~1 request per provider)';
    try {
      const r = await api('/functions/v1/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ healthcheck: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const dot = (v) => v === 'ok' ? '🟢' : (/not configured/.test(v) ? '⚪' : (/error/i.test(v) ? '🔴' : '🟡'));
      s.innerHTML = `${dot(d.gemini)} Gemini: <b>${d.gemini}</b> &nbsp; ${dot(d.mistral)} Mistral: <b>${d.mistral}</b> &nbsp; ${dot(d.openrouter)} OpenRouter: <b>${d.openrouter}</b>`;
    } catch (e) { s.textContent = 'Check failed: ' + e.message; }
  };

  $('copyPromptBtn').onclick = async () => {
    const prompt = ($('promptType') && $('promptType').value === 'notif') ? NOTIF_PROMPT : EN_PROMPT;
    try { await navigator.clipboard.writeText(prompt); toast('Prompt copied — paste it into Gemini/Claude with the PDF'); }
    catch { $('pasteJson').value = prompt; toast('Copy blocked — prompt placed in the box; cut it from there'); }
  };

  // file picker
  let pickedFile = null;
  $('dropzone').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    pickedFile = e.target.files[0] || null;
    $('dzText').textContent = pickedFile ? `📎 ${pickedFile.name}` : 'Click to choose a PDF, or drop it here';
  };
  ['dragover', 'drop'].forEach((ev) =>
    $('dropzone').addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop') { pickedFile = e.dataTransfer.files[0] || null;
        $('dzText').textContent = pickedFile ? `📎 ${pickedFile.name}` : ''; }
    }));

  $('ingestBtn').onclick = async () => {
    const srcType = $('srcType').value;
    const label = $('srcLabel').value.trim();
    const btn = $('ingestBtn'); const st = $('ingestStatus');
    btn.disabled = true;
    try {
      if (srcType === 'paste') { await importPasted(label, st); return; }
      const payload = { source_type: srcType, source_label: label };
      if (srcType === 'url') {
        const url = $('urlInput').value.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('Enter a valid http(s) URL');
        payload.source_url = url;
      } else {
        if (!pickedFile) throw new Error('Choose a PDF first');
        if (pickedFile.size > 10 * 1024 * 1024) throw new Error('PDF exceeds 10 MB');
        st.innerHTML = '<span class="spinner"></span> Reading file…';
        payload.filename = pickedFile.name;
        payload.file_base64 = await fileToBase64(pickedFile);
      }
      st.innerHTML = '<span class="spinner"></span> Extracting with Gemini… (can take ~20s)';
      const r = await api('/functions/v1/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      const sum = summarizeIngest({
        inserted: data.rows_extracted || 0, draftUpdated: data.draft_updated || 0,
        updatesQueued: data.updates_queued || 0, duplicatesFlagged: data.duplicates_flagged || 0,
        unchanged: data.unchanged || 0,
      });
      st.textContent = `${sum} (from ${data.candidates} candidate(s))` +
        ((data.providers && data.providers.length) ? ` · via ${data.providers.join(', ')}` : '') +
        ' — see the Review & Updates tabs.';
      toast(sum);
      refreshUpdatesCount();
      pickedFile = null; $('fileInput').value = '';
      $('dzText').textContent = 'Click to choose a PDF, or drop it here';
      document.querySelector('[data-tab="review"]').click();
    } catch (err) {
      st.textContent = '❌ ' + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  };

  $('refreshBtn').onclick = loadDrafts;

  // bulk select / approve / reject of checked draft cards
  if ($('draftSelectAll')) $('draftSelectAll').onchange = (e) => {
    $('draftList').querySelectorAll('.draft-check').forEach((c) => { c.checked = e.target.checked; });
    updateBulkBar();
  };
  if ($('bulkApproveBtn')) $('bulkApproveBtn').onclick = () => bulkActOnChecked('approve');
  if ($('bulkRejectBtn')) $('bulkRejectBtn').onclick = () => bulkActOnChecked('reject');
  if ($('filtApproveBtn')) $('filtApproveBtn').onclick = () => bulkActOnFiltered('approve');
  if ($('filtRejectBtn')) $('filtRejectBtn').onclick = () => bulkActOnFiltered('reject');

  $('viewerClose').onclick = () => { $('viewerFrame').src = 'about:blank'; $('viewerPane').style.display = 'none'; };

  $('approveAllBtn').onclick = async () => {
    const levels = [];
    if ($('cfHigh').checked) levels.push('high');
    if ($('cfMedium').checked) levels.push('medium');
    if ($('cfLow').checked) levels.push('low');
    if (!levels.length) return toast('Tick at least one confidence level');
    const filt = `confidence=in.(${levels.join(',')})`;
    // fetch the matching rows up-front: exact count for the confirm + dates for
    // the expired warning (the PATCH itself re-applies the filter, so a race
    // just means a freshly-arrived draft also gets approved — same as before)
    const viewFilt = `&marked_for_review=eq.${REVIEW_VIEW === 'marked'}`;
    const rows = [];
    try {
      for (let from = 0; ; from += 1000) {
        const cr = await api(`/rest/v1/vacancies?status=eq.draft${viewFilt}&${filt}&select=id,last_date_to_apply&order=id.asc&limit=1000&offset=${from}`);
        if (!cr.ok) break;
        const chunk = await cr.json();
        rows.push(...chunk);
        if (chunk.length < 1000) break;
      }
    } catch { /* */ }
    const count = rows.length;
    if (!count) return toast('No drafts match the ticked confidence');
    // Strong confirm: this acts on the WHOLE queue by confidence, NOT the row
    // checkboxes — the easy-to-make mistake. For large batches require typing the
    // count so it can't be fired by a stray Enter/click.
    const warn = `⚠ Approve & PUBLISH ${count} draft(s) across the ENTIRE queue with confidence: ${levels.join(', ')}.\n\n`
      + `This is NOT the row checkboxes — for those use “✓ Approve checked”.\n`
      + `Unsaved inline edits aren't included — Save those first if needed.`;
    if (count >= 50) {
      const typed = prompt(`${warn}\n\nThis is a large batch. Type the number ${count} to confirm:`);
      if (String(typed || '').trim() !== String(count)) return toast('Cancelled — number did not match');
    } else if (!confirm(warn)) {
      return;
    }
    if (!confirmNotExpired(rows)) return;
    const b = $('approveAllBtn'); b.disabled = true;
    try {
      // one PATCH; return=representation gives the exact ids for Undo
      const r = await api(`/rest/v1/vacancies?status=eq.draft${viewFilt}&${filt}&select=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(statusPatch('approved')),
      });
      if (!r.ok) throw new Error(await r.text());
      const ids = (await r.json().catch(() => [])).map((x) => x.id);
      undoableStatus(ids, `✅ Published ${ids.length} ${levels.join('/')} draft(s) — awaiting verification`);
      loadVerifyCount();
      loadDrafts();
    } catch (e) { toast('Approve failed: ' + e.message); } finally { b.disabled = false; }
  };

  $('rejectAllBtn').onclick = async () => {
    const n = CURRENT_DRAFT_IDS.length;
    if (!n) return toast('No drafts to reject');
    if (!confirm(`Reject ALL ${n} draft(s)?\nThey move to Manage → Rejected (and you can Undo for a few seconds).`)) return;
    const viewFilt = `&marked_for_review=eq.${REVIEW_VIEW === 'marked'}`;
    const b = $('rejectAllBtn'); b.disabled = true;
    try {
      const r = await api(`/rest/v1/vacancies?status=eq.draft${viewFilt}&select=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ids = (await r.json().catch(() => [])).map((x) => x.id);
      undoableStatus(ids, `Rejected ${ids.length} draft(s)`);
      loadDrafts();
    } catch (e) { toast('Reject all failed: ' + e.message); } finally { b.disabled = false; }
  };

  $('enrichAllBtn').onclick = async () => {
    const ids = [...CURRENT_DRAFT_IDS];
    if (!ids.length) return toast('No drafts to enrich');
    if (!confirm(`Find official PDFs for all ${ids.length} drafts?\nThis runs one web search + extraction each, so it can take several minutes and uses your Gemini search quota.`)) return;
    const btn = $('enrichAllBtn'); btn.disabled = true;
    let done = 0, found = 0;
    for (const id of ids) {
      try { const res = await enrichOne(id); if (res.found) found++; } catch { /* skip */ }
      done++; btn.textContent = `🔎 Enriching ${done}/${ids.length}…`;
    }
    btn.textContent = '🔎 Find official PDFs (all)'; btn.disabled = false;
    toast(`Enriched ${done} draft(s); found official links for ${found}`);
    loadDrafts();
  };
}

/* ---------------- enrichment (find official PDF) ---------------- */
let CURRENT_DRAFT_IDS = [];

async function enrichOne(id) {
  const r = await api('/functions/v1/enrich', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vacancy_id: id }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

async function replaceCard(id, el) {
  const r = await api(`/rest/v1/vacancies?id=eq.${id}&select=*`);
  const rows = await r.json();
  if (rows && rows[0]) el.replaceWith(draftCard(rows[0]));
  else el.remove();
}

// After approvals/rejections, delete source PDFs no longer referenced by any
// draft row. Debounced so a burst of approvals triggers one sweep.
let _gcTimer = null;
function scheduleGc() {
  clearTimeout(_gcTimer);
  _gcTimer = setTimeout(() => {
    api('/functions/v1/gc_sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => { /* best effort */ });
  }, 4000);
}

/* ---------------- sorting (shared by Review queue + Manage) ---------------- */
// Modes: upload | source | notif/notif_asc | lastdate/lastdate_asc |
//        level/level_asc. Rows missing the sort value sort LAST regardless of
// direction. Used by renderDrafts(), renderManage(), and renderUpdates().
function _ymd(s) { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + m[2] + m[3] : ''; }
function _sourceKey(r) { return String(r.source_category || r.source_type || '').toLowerCase(); }
function _levelNum(r) {
  // rank: "13A" → 13.5, so sorting places it between 13 and 14
  return levelRank(r.level || r.level_text || r.req_level1 || '');
}
function _levelTok(r) {
  return levelTok(r.level || r.level_text || r.req_level1 || '');
}
const _byPost = (a, b) => String(a.post_name || '').localeCompare(String(b.post_name || ''));
// Compare a date field; desc=newest first. Missing dates always sort last.
function _cmpDate(a, b, field, desc) {
  const x = _ymd(a[field]); const y = _ymd(b[field]);
  if (!x && !y) return 0; if (!x) return 1; if (!y) return -1;
  return desc ? y.localeCompare(x) : x.localeCompare(y);
}
// Compare pay level; desc=high first. Missing level always sorts last.
function _cmpLevel(a, b, desc) {
  const x = _levelNum(a); const y = _levelNum(b);
  if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
  return desc ? y - x : x - y;
}
function sortRows(rows, mode) {
  const arr = rows.slice();
  switch (mode) {
    case 'notif':       arr.sort((a, b) => _cmpDate(a, b, 'notification_date', true) || _byPost(a, b)); break;
    case 'notif_asc':   arr.sort((a, b) => _cmpDate(a, b, 'notification_date', false) || _byPost(a, b)); break;
    case 'lastdate':    arr.sort((a, b) => _cmpDate(a, b, 'last_date_to_apply', true) || _byPost(a, b)); break;
    case 'lastdate_asc':arr.sort((a, b) => _cmpDate(a, b, 'last_date_to_apply', false) || _byPost(a, b)); break;
    case 'level':       arr.sort((a, b) => _cmpLevel(a, b, true) || _byPost(a, b)); break;
    case 'level_asc':   arr.sort((a, b) => _cmpLevel(a, b, false) || _byPost(a, b)); break;
    case 'source':      arr.sort((a, b) => _sourceKey(a).localeCompare(_sourceKey(b)) || _cmpDate(a, b, 'notification_date', true) || _byPost(a, b)); break;
    default:            arr.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))); // 'upload'
  }
  return arr;
}

// Shared <option> list so Review/Manage/Updates sort dropdowns stay in sync.
const SORT_OPTIONS = [
  ['upload', 'Upload date (newest)'],
  ['source', 'Source → notification date'],
  ['notif', 'Notification date (newest)'],
  ['notif_asc', 'Notification date (oldest)'],
  ['lastdate', 'Last date (newest)'],
  ['lastdate_asc', 'Last date (oldest)'],
  ['level', 'Pay level (high → low)'],
  ['level_asc', 'Pay level (low → high)'],
];
function sortOptionsHtml(selected) {
  return SORT_OPTIONS.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('');
}

/* ---------------- review queue ---------------- */
const DRAFT_PAGE_SIZE = 25;
let DRAFT_PAGE = 1;
let DRAFT_SORT = 'source';   // default preserves the grouped-by-source view
let DRAFT_ROWS = [];   // full current draft list (display source for pagination)
// 'review' = drafts NOT marked-for-review · 'marked' = drafts that ARE marked.
// Both views share #paneReview and the same workflow; only the loaded set differs.
let REVIEW_VIEW = 'review';
let DRAFT_QUICK = new Set();   // active quick-filter chips (confidence / gaps / deadline)
// one-shot restore for the dynamic Level/Source dropdowns (their options only
// exist after the first loadDrafts) — consumed by populateDraft*Filter below
let RESTORE_LEVEL = '';
let RESTORE_SOURCE = '';

async function loadDrafts() {
  try {
    // id.asc tiebreaker keeps the 1000-row pages stable across requests.
    // Marked tab gets the same draft set, filtered to marked_for_review rows.
    const markedFilter = `&marked_for_review=eq.${REVIEW_VIEW === 'marked'}`;
    const data = await fetchAll(`vacancies?status=eq.draft${markedFilter}&select=*&order=ingest_job_id.asc,vacancy_id.asc,id.asc`);
    CURRENT_DRAFT_IDS = data.map((x) => x.id);   // whole queue — bulk ops use this
    DRAFT_ROWS = data;
    populateDraftSourceFilter();
    DRAFT_PAGE = 1;
    populateDraftLevelFilter();
    renderDrafts();
    refreshReviewBadges();    // keep both tab badges in sync with this load
    updateReviewHeading();
  } catch (e) { toast('Load error: ' + e.message); }
}

// Count-only refresh of the Review-queue and Marked tab badges. Called after
// loadDrafts and after every mark / unmark / approve / reject so both numbers
// stay correct even when a row moves between the two tabs.
async function refreshReviewBadges() {
  const [drafts, marked] = await Promise.all([
    countOf('vacancies?status=eq.draft&marked_for_review=eq.false'),
    countOf('vacancies?status=eq.draft&marked_for_review=eq.true'),
  ]);
  if ($('draftCount')) $('draftCount').textContent = drafts ? `(${drafts})` : '';
  if ($('markedCount')) $('markedCount').textContent = marked ? `(${marked})` : '';
}

// Rewrites the Review pane's h2 + "what to do" hint based on which tab the
// pane is currently representing (Review queue vs Marked).
function updateReviewHeading() {
  const h = document.querySelector('#paneReview h2');
  const hint = $('reviewHint');
  if (h) h.textContent = REVIEW_VIEW === 'marked' ? '🚩 Marked for review' : 'Review queue';
  if (hint) hint.innerHTML = REVIEW_VIEW === 'marked'
    ? 'Drafts you flagged for a closer look. Same workflow as the Review queue — <b>🚩 Marked</b> unmarks the row (it goes back to Review). Press <kbd>?</kbd> for keyboard shortcuts.'
    : 'Click <b>Edit</b> to change fields, then <b>Approve</b> (publishes live) or <b>Reject</b> (moves to Manage → Rejected; undoable). Tick the checkboxes to <b>approve / reject in bulk</b>. Click <b>📄 source</b> to view the original page beside it. Press <kbd>?</kbd> for keyboard shortcuts.';
}

// Fill the Level filter with the distinct pay levels present in the current
// draft set (sorted by rank desc, so 13A lands between 14 and 13), preserving
// the current selection if still valid. Option values are TOKENS ("13A").
function populateDraftLevelFilter() {
  const sel = $('draftLevel');
  if (!sel) return;
  const prev = sel.value || RESTORE_LEVEL; RESTORE_LEVEL = '';
  const byTok = new Map(); // token -> rank
  DRAFT_ROWS.forEach((r) => {
    const tok = _levelTok(r);
    if (tok && !byTok.has(tok)) byTok.set(tok, _levelNum(r));
  });
  const toks = [...byTok.keys()].sort((a, b) => byTok.get(b) - byTok.get(a));
  sel.innerHTML = '<option value="">All</option>' + toks.map((t) => `<option value="${t}">Level ${t}</option>`).join('');
  if (prev && byTok.has(prev)) sel.value = prev; // keep selection across refresh
}

// Fill the Source filter with the distinct source labels (e.g. "Employment News
// 18-24 April 2026") present in the current draft set, preserving the current
// selection if still valid.
function populateDraftSourceFilter() {
  const sel = $('draftSource');
  if (!sel) return;
  const prev = sel.value || RESTORE_SOURCE; RESTORE_SOURCE = '';
  const srcs = [...new Set(DRAFT_ROWS.map((r) => String(r.source_category || r.source_type || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All</option>' + srcs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (prev && srcs.includes(prev)) sel.value = prev; // keep selection across refresh
}

// Multi-word AND search when DepUtils is available (e.g. "registrar nclt"),
// plain substring otherwise.
function rowMatchesQuery(r, q) {
  const hay = [r.post_name, r.organisation, r.ministry, r.location_city, r.vacancy_id]
    .map((f) => String(f || '')).join(' ');
  return window.DepUtils ? DepUtils.fuzzyIncludes(q, hay) : hay.toLowerCase().includes(q);
}

const _daysLeft = (r) => (window.DepUtils ? DepUtils.getDaysUntilDate(r.last_date_to_apply) : null);

// The full Review filter chain (search + level + source + quick chips) — used
// by renderDrafts and by dropFromQueue's pager refresh.
function applyDraftFilters(rows) {
  const q = ($('draftSearch') && $('draftSearch').value || '').toLowerCase().trim();
  const lvl = ($('draftLevel') && $('draftLevel').value || '').trim();
  const src = ($('draftSource') && $('draftSource').value || '').trim();
  let filtered = rows;
  if (lvl) filtered = filtered.filter((r) => _levelTok(r) === lvl);
  if (src) filtered = filtered.filter((r) => String(r.source_category || r.source_type || '').trim() === src);
  if (q) filtered = filtered.filter((r) => rowMatchesQuery(r, q));
  if (DRAFT_QUICK.size) {
    const conf = ['high', 'medium', 'low'].filter((c) => DRAFT_QUICK.has(c));
    if (conf.length) filtered = filtered.filter((r) => conf.includes(String(r.confidence || 'medium').toLowerCase()));
    if (DRAFT_QUICK.has('nolink')) filtered = filtered.filter((r) => !String(r.official_notification_link || '').trim());
    if (DRAFT_QUICK.has('nodate')) filtered = filtered.filter((r) => !String(r.last_date_to_apply || '').trim());
    if (DRAFT_QUICK.has('incomplete')) filtered = filtered.filter((r) => draftCompleteness(r) < 60);
    // active = not past the last date; rows with no/unparseable date stay visible
    if (DRAFT_QUICK.has('active')) filtered = filtered.filter((r) => { const d = _daysLeft(r); return d == null || d >= 0; });
    if (DRAFT_QUICK.has('closing')) filtered = filtered.filter((r) => { const d = _daysLeft(r); return d != null && d >= 0 && d <= 7; });
    if (DRAFT_QUICK.has('expired')) filtered = filtered.filter((r) => { const d = _daysLeft(r); return d != null && d < 0; });
  }
  return filtered;
}

// Renders ONLY the current page's summary cards. Grouping headers are shown per
// page for whichever job-groups the slice spans.
function renderDrafts() {
  const q = ($('draftSearch') && $('draftSearch').value || '').trim();
  const lvl = ($('draftLevel') && $('draftLevel').value || '').trim();
  const src = ($('draftSource') && $('draftSource').value || '').trim();
  const rows = sortRows(applyDraftFilters(DRAFT_ROWS), DRAFT_SORT);
  const list = $('draftList');
  const pager = $('draftPager');
  updateFilteredBar(rows.length);
  if (!rows.length) {
    list.innerHTML = `<p class="muted">${(q || src || lvl || DRAFT_QUICK.size) ? 'No drafts match the current filters.' : 'No drafts awaiting review. 🎉'}</p>`;
    if (pager) pager.innerHTML = '';
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / DRAFT_PAGE_SIZE));
  if (DRAFT_PAGE > pages) DRAFT_PAGE = pages;
  const start = (DRAFT_PAGE - 1) * DRAFT_PAGE_SIZE;
  const slice = rows.slice(start, start + DRAFT_PAGE_SIZE);

  list.innerHTML = '';
  // Source headers only make sense when grouped by source.
  const showHeaders = DRAFT_SORT === 'source';
  let lastSrc = null;
  slice.forEach((r) => {
    if (showHeaders) {
      const src = _sourceKey(r);
      if (src !== lastSrc) {
        const hdr = document.createElement('div');
        hdr.className = 'jobhdr';
        hdr.textContent = `Source: ${r.source_category || r.source_type || 'unknown'}`;
        list.appendChild(hdr);
        lastSrc = src;
      }
    }
    list.appendChild(draftCard(r));
  });

  renderDraftPager(pages, start, slice.length, rows.length);
  if ($('draftSelectAll')) $('draftSelectAll').checked = false;
  updateBulkBar();
  kbAfterRender();
}

/* ---- bulk approve / reject of checked draft cards ---- */
function checkedDraftCards() {
  return [...$('draftList').querySelectorAll('.draft')]
    .filter((el) => el.querySelector('.draft-check')?.checked);
}

function updateBulkBar() {
  const n = checkedDraftCards().length;
  const bar = $('draftBulkBar');
  if (bar) bar.style.display = n ? 'flex' : 'none';
  const lbl = $('draftBulkCount');
  if (lbl) lbl.textContent = `${n} selected`;
}

async function bulkActOnChecked(action) {
  const cards = checkedDraftCards();
  if (!cards.length) return toast('No vacancies checked');
  const status = action === 'approve' ? 'approved' : 'rejected';
  const verb = action === 'approve' ? 'Approve & publish' : 'Reject';
  if (!confirm(`${verb} ${cards.length} checked vacanc${cards.length === 1 ? 'y' : 'ies'}?`)) return;
  if (action === 'approve') {
    const byId = new Map(DRAFT_ROWS.map((r) => [String(r.id), r]));
    if (!confirmNotExpired(cards.map((el) => byId.get(el.dataset.id)).filter(Boolean))) return;
  }
  const bar = $('draftBulkBar'); if (bar) bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  let ok = 0, fail = 0;
  const okIds = [];
  // untouched rows → ONE id=in.() PATCH for the whole set
  const plain = cards.filter((el) => !el.dataset.built);
  if (plain.length) {
    const ids = plain.map((el) => el.dataset.id);
    try {
      const r = await api(`/rest/v1/vacancies?id=in.(${ids.join(',')})`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(statusPatch(status)),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      plain.forEach((el) => el.remove());
      ok += ids.length; okIds.push(...ids);
    } catch { fail += ids.length; }
  }
  // edited rows keep a per-card PATCH so their edits are saved too
  for (const el of cards.filter((x) => x.dataset.built)) {
    const id = el.dataset.id;
    try {
      const r = await api(`/rest/v1/vacancies?id=eq.${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ...collectFromCard(el), ...statusPatch(status) }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      el.remove(); ok++; okIds.push(id);
    } catch { fail++; }
  }
  if (bar) bar.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  const msg = `${action === 'approve' ? 'Published' : 'Rejected'} ${ok}${action === 'approve' ? ' — awaiting verification' : ''}${fail ? `, ${fail} failed` : ''}`;
  if (okIds.length) undoableStatus(okIds, msg); else toast(msg);
  dropFromQueue(okIds);
  updateBulkBar();
  loadVerifyCount();
}

/* ---- approve / reject the FILTERED set (all pages) ---- */
function draftFiltersActive() {
  return Boolean(
    (($('draftSearch') && $('draftSearch').value) || '').trim()
    || ($('draftLevel') && $('draftLevel').value)
    || ($('draftSource') && $('draftSource').value)
    || DRAFT_QUICK.size,
  );
}

// The "Approve/Reject filtered (N)" buttons only appear while a filter is
// narrowing the queue — otherwise the existing whole-queue buttons apply.
function updateFilteredBar(n) {
  const bar = $('draftFilteredBar');
  if (!bar) return;
  const on = n > 0 && draftFiltersActive();
  bar.style.display = on ? 'flex' : 'none';
  if (on) {
    $('filtApproveBtn').textContent = `✓ Approve filtered (${n})`;
    $('filtRejectBtn').textContent = `🗑 Reject filtered (${n})`;
  }
}

// Acts on EVERY draft matching the current filters (search + Level + Source +
// quick chips) — all pages, not just the visible one. One id=in.() PATCH per
// 100 rows; undoable like the other bulk paths. Unsaved inline edits are NOT
// included (same caveat as Approve all).
async function bulkActOnFiltered(action) {
  const rows = applyDraftFilters(DRAFT_ROWS);
  if (!rows.length) return toast('No drafts match the current filters');
  const status = action === 'approve' ? 'approved' : 'rejected';
  const verb = action === 'approve' ? 'Approve & PUBLISH' : 'Reject';
  const warn = `${verb} ${rows.length} draft(s) matching the current filters — every page, not just this one.\n\n`
    + `Unsaved inline edits aren't included — Save those first if needed.`;
  if (rows.length >= 50) {
    const typed = prompt(`${warn}\n\nThis is a large batch. Type the number ${rows.length} to confirm:`);
    if (String(typed || '').trim() !== String(rows.length)) return toast('Cancelled — number did not match');
  } else if (!confirm(warn)) {
    return;
  }
  if (action === 'approve' && !confirmNotExpired(rows)) return;
  const btns = [$('filtApproveBtn'), $('filtRejectBtn')].filter(Boolean);
  btns.forEach((b) => { b.disabled = true; });
  const ids = rows.map((r) => r.id);
  const okIds = []; let fail = 0;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const r = await api(`/rest/v1/vacancies?id=in.(${part.join(',')})`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(statusPatch(status)),
      });
      if (r.ok) okIds.push(...part); else fail += part.length;
    }
  } finally { btns.forEach((b) => { b.disabled = false; }); }
  const msg = `${action === 'approve' ? '✅ Published' : 'Rejected'} ${okIds.length} filtered draft(s)${action === 'approve' ? ' — awaiting verification' : ''}${fail ? `, ${fail} failed` : ''}`;
  if (okIds.length) undoableStatus(okIds, msg); else toast(msg);
  // remove the affected visible cards so dropFromQueue re-renders the page
  const gone = new Set(okIds.map(String));
  $('draftList').querySelectorAll('.draft').forEach((c) => { if (gone.has(c.dataset.id)) c.remove(); });
  dropFromQueue(okIds);
  loadVerifyCount();
}

// Serialise an opened draft card's editor (mirrors the card-local collect()).
function collectFromCard(el) {
  const editor = el.querySelector('.editor');
  const patch = {};
  editor.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
  const lvl = levelTok(patch.level);                         // keeps "13A"
  if ('level' in patch) { patch.level = lvl; patch.level_text = lvl ? `Level-${lvl}` : ''; }
  if (patch.ministry) patch.min_code = MIN_CODE_BY_NAME[patch.ministry] || minCode(patch.ministry);
  applyTiersToPatch(patch, el);
  return patch;
}

// Shared pager renderer (Review queue + Manage). flip(page) re-renders.
function wirePager(pager, page, pages, start, shown, total, noun, flip) {
  if (!pager) return;
  if (pages <= 1) {
    pager.innerHTML = `<span class="muted">${total} ${noun}</span>`;
    return;
  }
  pager.innerHTML = `
    <button data-pg="prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span class="muted">Page ${page} / ${pages} · showing ${start + 1}-${start + shown} of ${total}</span>
    <button data-pg="next" ${page >= pages ? 'disabled' : ''}>Next ›</button>`;
  pager.querySelector('[data-pg="prev"]')?.addEventListener('click', () => { if (page > 1) { flip(page - 1); window.scrollTo(0, 0); } });
  pager.querySelector('[data-pg="next"]')?.addEventListener('click', () => { if (page < pages) { flip(page + 1); window.scrollTo(0, 0); } });
}

function renderDraftPager(pages, start, shown, total) {
  wirePager($('draftPager'), DRAFT_PAGE, pages, start, shown, total, 'draft(s)',
    (p) => { DRAFT_PAGE = p; renderDrafts(); });
}

// After cards are approved/rejected (and removed from the DOM): drop the rows
// from the cached queue, fix the count badge + pager, and re-render from cache
// only when the visible page emptied — open editors/checkboxes survive.
function dropFromQueue(ids) {
  if (!ids || !ids.length) return;
  const set = new Set(ids.map(String));
  DRAFT_ROWS = DRAFT_ROWS.filter((r) => !set.has(String(r.id)));
  CURRENT_DRAFT_IDS = CURRENT_DRAFT_IDS.filter((id) => !set.has(String(id)));
  $('draftCount').textContent = DRAFT_ROWS.length ? `(${DRAFT_ROWS.length})` : '';
  const total = applyDraftFilters(DRAFT_ROWS).length;
  updateFilteredBar(total);
  const pages = Math.max(1, Math.ceil(total / DRAFT_PAGE_SIZE));
  if (DRAFT_PAGE > pages) DRAFT_PAGE = pages;
  const visible = $('draftList').querySelectorAll('.draft').length;
  if (visible === 0 || total === 0) renderDrafts();   // next slice / empty-state
  else renderDraftPager(pages, (DRAFT_PAGE - 1) * DRAFT_PAGE_SIZE, visible, total);
}

/* ---- keyboard triage (Review queue) ----
 * j/k move · x or Space tick · a approve · r reject · e edit · s source ·
 * g google · ? help. The highlight ring is .kb-focus; KB_ID survives
 * re-renders ('__first__'/'__last__' are page-flip sentinels). */
let KB_ID = null;
const kbCards = () => [...$('draftList').querySelectorAll('.draft')];
function kbApply() {
  kbCards().forEach((el) => el.classList.toggle('kb-focus', el.dataset.id === KB_ID));
}
function kbAfterRender() {
  const cards = kbCards();
  if (!cards.length) { KB_ID = null; return; }
  if (KB_ID === '__first__') KB_ID = cards[0].dataset.id;
  else if (KB_ID === '__last__') KB_ID = cards[cards.length - 1].dataset.id;
  else if (KB_ID && !cards.some((el) => el.dataset.id === KB_ID)) KB_ID = null;
  kbApply();
}
function kbMove(delta) {
  const cards = kbCards();
  if (!cards.length) return;
  const i = cards.findIndex((el) => el.dataset.id === KB_ID);
  const next = (i === -1) ? (delta > 0 ? 0 : cards.length - 1) : i + delta;
  if (next < 0) {
    const prevBtn = $('draftPager') && $('draftPager').querySelector('[data-pg="prev"]');
    if (prevBtn && !prevBtn.disabled) { KB_ID = '__last__'; prevBtn.click(); }
    return;
  }
  if (next >= cards.length) {
    const nextBtn = $('draftPager') && $('draftPager').querySelector('[data-pg="next"]');
    if (nextBtn && !nextBtn.disabled) { KB_ID = '__first__'; nextBtn.click(); }
    return;
  }
  KB_ID = cards[next].dataset.id;
  kbApply();
  cards[next].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function onReviewKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tgt = (e.target && e.target.closest) ? e.target : null;
  if (tgt && tgt.closest('input, textarea, select, [contenteditable]')) return;
  if (!$('paneReview') || $('paneReview').classList.contains('hidden')) return;
  const k = e.key;
  // let a focused button keep its native Space/Enter activation
  if ((k === ' ' || k === 'Enter') && tgt && tgt.closest('button')) return;
  if (k === '?') { e.preventDefault(); $('kbHelp') && $('kbHelp').classList.toggle('hidden'); return; }
  const kl = String(k).toLowerCase();
  if (kl === 'j') { e.preventDefault(); kbMove(1); return; }
  if (kl === 'k') { e.preventDefault(); kbMove(-1); return; }
  const cur = KB_ID && $('draftList').querySelector(`.draft[data-id="${KB_ID}"]`);
  if (!cur) return;
  if (kl === 'x' || k === ' ') {
    e.preventDefault();
    const cb = cur.querySelector('.draft-check');
    if (cb) { cb.checked = !cb.checked; updateBulkBar(); }
    return;
  }
  const act = { a: 'approve', r: 'reject', e: 'edit', s: 'source', g: 'gsearch' }[kl];
  if (!act) return;
  e.preventDefault();
  if (act === 'approve' || act === 'reject') {
    // hand the highlight to the neighbour before this card disappears
    const cards = kbCards(); const i = cards.indexOf(cur);
    const nxt = cards[i + 1] || cards[i - 1];
    if (nxt) KB_ID = nxt.dataset.id;
    cur.querySelector(`[data-act="${act}"]`)?.click();
    setTimeout(kbApply, 250);
    return;
  }
  cur.querySelector(`[data-act="${act}"]`)?.click();
}

// ---- Link sanity badge -----------------------------------------------------
// Quick, client-side, zero-API check shown on each card so the reviewer can
// tell at a glance whether the official link looks right WITHOUT opening it:
//   ✓ green  — link host matches the organisation/ministry, and (if datable) 2026
//   ⚠ amber  — host doesn't obviously match the org  OR the URL cites a pre-2026 year
//   ▢ grey   — no link / a non-PDF source page (nothing to judge)
// It's a heuristic to prioritise eyeballing, NOT a verification of contents.
const STOPWORDS = new Set(['of','and','the','for','in','to','national','institute',
  'department','ministry','office','india','indian','government','govt','board',
  'authority','centre','center','council','commission','organisation','organization',
  'directorate','general','development','central','bureau','service','services','all']);

function linkDomainBadge(r) {
  const url = (r.official_notification_link || '').trim();
  if (!url) return '<span class="lk lk-none" title="No official link">▢ no link</span>';
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = ''; }
  const isPdf = /\.pdf($|\?|#)/i.test(url);
  if (!isPdf) return '<span class="lk lk-none" title="Source page (not a direct PDF)">▢ page</span>';

  // tokens from organisation + ministry (drop generic words + short bits)
  const text = `${r.organisation || ''} ${r.ministry || ''}`.toLowerCase();
  const tokens = text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const hostFlat = host.replace(/[^a-z0-9]/g, '');
  // acronyms already written in the org, e.g. "(NCERT)", "IGIDR"
  const acr = (r.organisation || '').match(/\b[A-Z]{3,6}\b/g) || [];
  // acronym BUILT from the ORGANISATION's significant words' initials (not the
  // ministry, which would pollute it), e.g. Food Safety Standards Authority
  // India -> "fssai". Keep short stop-ish words like "of"/"and" out.
  const orgWords = (r.organisation || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')           // drop the "(NCERT)" parenthetical
    .replace(/[^a-z ]/g, ' ').split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const initials = orgWords.map((t) => t[0]).join('');
  const initialsHit = initials.length >= 3 && hostFlat.includes(initials);
  const hostMatch = tokens.some((t) => hostFlat.includes(t.slice(0, 6)))
    || acr.some((a) => hostFlat.includes(a.toLowerCase()))
    || initialsHit
    || (/\.(gov|nic)\.in$/.test(host) && tokens.some((t) => hostFlat.includes(t.slice(0, 4))));

  // year sanity: a pre-2026 year in the URL with no 2026 present = stale-looking
  const hasOld = /20(1[0-9]|2[0-5])/.test(url) && !/2026/.test(url);
  const isGov = /\.(gov|nic|edu|res|ac)\.in$/.test(host) || /\.gov$/.test(host);

  if (hasOld) return `<span class="lk lk-warn" title="URL cites a pre-2026 year (${host})">⚠ old? ${escapeHtml(host)}</span>`;
  if (hostMatch && isGov) return `<span class="lk lk-ok" title="Link host matches org (${host})">✓ ${escapeHtml(host)}</span>`;
  if (hostMatch) return `<span class="lk lk-ok" title="Link host matches org (${host})">✓ ${escapeHtml(host)}</span>`;
  return `<span class="lk lk-warn" title="Link host may not match the organisation (${host})">⚠ ${escapeHtml(host)}</span>`;
}

// Cheap completeness score for a RAW snake_case draft row — mirrors enrich.js's
// completenessScore field list but avoids the full enrichRecord() (dates, region,
// search-text, tiers) so it's safe to call for every card on render.
function draftCompleteness(r) {
  const f = ['vacancy_id', 'ministry', 'organisation', 'post_name', 'level_text',
    'location_city', 'location_state', 'req_level1', 'req_level2', 'notification_date',
    'last_date_to_apply', 'official_notification_link', 'application_form_link',
    'mode_of_application', 'essential_qualification'];
  const filled = f.filter((k) => String(r[k] ?? '').trim()).length;
  return Math.round((filled / f.length) * 100);
}

// "closes in Nd / EXPIRED" pill from last_date_to_apply ('' when blank or
// unparseable). Tones come from DepUtils.getDaysLeftTone.
function deadlineBadge(r) {
  const d = _daysLeft(r);
  if (d == null) return '';
  const tone = DepUtils.getDaysLeftTone(d);   // safe|soon|closing|critical|expired
  const txt = d < 0 ? 'EXPIRED' : (d === 0 ? 'closes today' : `closes in ${d}d`);
  return `<span class="dl dl-${tone}" title="Last date: ${escapeHtml(r.last_date_to_apply)}">${txt}</span>`;
}

// Chips for the missing fields that hurt the public listing most.
function gapChips(r) {
  const gaps = [];
  if (!String(r.official_notification_link || '').trim()) gaps.push('no link');
  if (!String(r.last_date_to_apply || '').trim()) gaps.push('no last date');
  if (!levelTok(r.level || r.req_level1 || '')) gaps.push('no level');
  return gaps.map((g) => `<span class="gap">${g}</span>`).join('');
}

// true = proceed. Warns when any of the rows about to be approved is already
// past its last date — publishing expired posts is almost always a mistake.
function confirmNotExpired(rows) {
  if (!window.DepUtils) return true;
  const exp = rows.filter((r) => { const d = _daysLeft(r || {}); return d != null && d < 0; }).length;
  if (!exp) return true;
  return confirm(`⚠ ${exp} of these vacanc${exp === 1 ? 'y is' : 'ies are'} already past the last date to apply (EXPIRED).\n\nApprove & publish anyway?`);
}

// Read-only verbatim eligibility text captured from the source PDF (rides in
// raw_extraction.detailed_eligibility) — lets the reviewer check tiers/levels
// against the source wording without opening the PDF.
function verbatimHtml(text) {
  return `<details class="verbatim"><summary>📜 Verbatim source eligibility text</summary><pre>${escapeHtml(String(text))}</pre></details>`;
}

// Review-queue card. Renders ONLY a lightweight summary up-front (no FIELDS,
// no 34-option selects, no tiers editor); the heavy editor is built lazily by
// buildDraftEditor() the first time "Edit" is clicked. This keeps the queue
// fast even with hundreds of drafts.
function draftCard(r) {
  const el = document.createElement('div');
  el.className = 'draft';
  const conf = (r.confidence || 'medium').toLowerCase();
  const score = draftCompleteness(r);
  const srcPage = String((r.raw_extraction && r.raw_extraction.source_page) || '').replace(/\D/g, '');
  el.dataset.id = r.id;
  el.innerHTML = `
    <div class="head">
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <input type="checkbox" class="draft-check" title="Select for bulk approve/reject" style="flex:0 0 auto;width:16px;height:16px">
        <span style="min-width:0">
          <b>${escapeHtml(r.post_name || '(untitled)')}</b>
          <span class="muted"> · ${escapeHtml(r.organisation || '')}${r.level ? ' · L' + escapeHtml(r.level) : ''}${r.location_city ? ' · ' + escapeHtml(r.location_city) : ''}</span>
          <span class="pill ${conf}">${conf}</span>
          ${r.marked_for_review ? '<span class="pill mark-badge" title="Marked for review">🚩 review</span>' : ''}
          <span class="muted"> · ${score}% complete</span>
          ${linkDomainBadge(r)}${deadlineBadge(r)}${gapChips(r)}
        </span>
      </div>
      <div class="acts">
        ${(r.source_file_url || r.official_notification_link) ? `<button data-act="source">📄 source${srcPage ? ' p.' + srcPage : ''}</button>` : ''}
        ${r.official_notification_link ? `<button data-act="openlink" title="Open the captured Official link in a new tab">🔗 Open link</button>` : ''}
        <button data-act="gsearch" title="Open a Google search (new tab) for this post + organisation deputation PDF">🌐 Google</button>
        <button data-act="mark" class="${r.marked_for_review ? 'good' : ''}" title="Flag this vacancy for a second look — find it later under Manage → Source → 🚩 Marked for review (keeps the row in this queue; can be marked whether draft or approved)">${r.marked_for_review ? '🚩 Marked' : '🚩 Mark'}</button>
        <button data-act="edit">Edit</button>
        <button data-act="enrich" title="Find the official notification PDF and fill blank fields">🔎 Official PDF</button>
        <button class="good" data-act="approve">Approve</button>
        <button class="bad" data-act="reject">Reject</button>
      </div>
    </div>
    <div class="editor" style="display:none"></div>`;
  el.querySelector('.draft-check').addEventListener('change', updateBulkBar);

  const editor = el.querySelector('.editor');

  // Build the heavy editor once, on demand.
  const buildEditor = () => {
    if (el.dataset.built) return;
    const de = r.raw_extraction && r.raw_extraction.detailed_eligibility;
    editor.innerHTML = `${de ? verbatimHtml(de) : ''}<div class="row">
      ${FIELDS.map(([k, lbl]) => fieldHtml(k, lbl, r)).join('')}
      ${tiersEditorHtml(r)}
    </div>`;
    wireTiersEditor(el);
    el.dataset.built = '1';
  };

  const collect = () => {
    const patch = {};
    editor.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
    const lvl = levelTok(patch.level);                       // keeps "13A"
    if ('level' in patch) { patch.level = lvl; patch.level_text = lvl ? `Level-${lvl}` : ''; }
    if (patch.ministry) patch.min_code = MIN_CODE_BY_NAME[patch.ministry] || minCode(patch.ministry);
    applyTiersToPatch(patch, el);
    return patch;
  };

  const patchRow = async (bodyObj) => {
    const r2 = await api(`/rest/v1/vacancies?id=eq.${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(bodyObj),
    });
    if (!r2.ok) throw new Error('HTTP ' + r2.status + ' ' + (await r2.text()));
  };

  el.querySelector('[data-act="edit"]').onclick = (e) => {
    buildEditor();
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    e.currentTarget.textContent = showing ? 'Edit' : 'Hide';
  };

  // Open a Google search in a new tab: [post name] [organisation] "Deputation" "2026" "pdf".
  // Uses the live edited values if the editor is open, otherwise the row's values.
  el.querySelector('[data-act="gsearch"]').onclick = () => {
    const val = (k, fb) => {
      const inp = el.querySelector(`[data-k="${k}"]`);
      return ((inp && inp.value.trim()) || fb || '').trim();
    };
    const post = val('post_name', r.post_name);
    const org = val('organisation', r.organisation);
    const q = `${post} ${org} "Deputation" "2026" "pdf"`.replace(/\s+/g, ' ').trim();
    window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
  };

  el.querySelector('[data-act="approve"]').onclick = async () => {
    // Only serialise the editor if it was actually opened; otherwise approve as-is.
    // One-at-a-time approval means this row was actually read → verified.
    const approved = statusPatch('approved', { verified: true });
    const body = el.dataset.built ? { ...collect(), ...approved } : approved;
    if (!confirmNotExpired([{ ...r, ...body }])) return;
    try { await patchRow(body); el.remove(); undoableStatus([r.id], '✅ Approved & published'); dropFromQueue([r.id]); }
    catch (e) { toast('Approve failed: ' + e.message); }
  };
  el.querySelector('[data-act="reject"]').onclick = async () => {
    try {
      // soft reject: the row stays (hidden) under Manage → Rejected, so it's
      // undoable and an identical re-import is remembered as already rejected
      await patchRow({ status: 'rejected' });
      el.remove(); undoableStatus([r.id], 'Rejected'); dropFromQueue([r.id]);
    } catch (e) { toast('Reject failed: ' + e.message); }
  };
  el.querySelector('[data-act="enrich"]').onclick = async (e) => {
    const b = e.currentTarget; const old = b.textContent; b.disabled = true; b.textContent = '🔎 Searching…';
    try {
      const res = await enrichOne(r.id);
      toast(res.found
        ? (res.pdf_ok ? `Filled ${res.filled.length} field(s) from official PDF` : 'Found a link (PDF could not be fetched)')
        : 'No official PDF found — left as-is');
      await replaceCard(r.id, el);
    } catch (err) {
      toast('Enrich failed: ' + err.message); b.disabled = false; b.textContent = old;
    }
  };
  const srcBtn = el.querySelector('[data-act="source"]');
  if (srcBtn) srcBtn.onclick = (e) => { e.preventDefault(); openSource(r, srcPage); };

  // Direct external link — opens whatever was captured in official_notification_link,
  // even if a source PDF is also attached (distinct from "📄 source", which
  // prefers the stored EN PDF for side-by-side review).
  const lnkBtn = el.querySelector('[data-act="openlink"]');
  if (lnkBtn) lnkBtn.onclick = () => {
    const inp = el.querySelector('[data-k="official_notification_link"]');
    const url = ((inp && inp.value.trim()) || r.official_notification_link || '').trim();
    if (!url) return toast('No official link on this row');
    window.open(/^https?:\/\//i.test(url) ? url : 'https://' + url, '_blank', 'noopener');
  };

  // Toggle the marked-for-review flag. A toggle MOVES the row to the other
  // tab (Review ↔ Marked), so we drop it from the current view rather than
  // updating in place — and refresh both tab badges so the counts shift too.
  el.querySelector('[data-act="mark"]').onclick = async (e) => {
    const btn = e.currentTarget;
    const next = !r.marked_for_review;
    btn.disabled = true;
    try {
      await patchRow({ marked_for_review: next });
      r.marked_for_review = next;
      el.remove();
      dropFromQueue([r.id]);
      refreshReviewBadges();
      toast(next ? '🚩 Marked for review — moved to the Marked tab' : 'Unmarked — back in the Review queue');
    } catch (err) { toast('Update failed: ' + err.message); btn.disabled = false; }
  };
  return el;
}

// Open a row's source in the side-by-side viewer, jumping to its page.
async function openSource(r, page) {
  // The side-by-side viewer pane lives in the Review tab only. When called from
  // Manage (Review pane hidden), open the source in a new tab instead.
  const inReview = !$('paneReview').classList.contains('hidden');
  // prefer the stored source PDF; fall back to the official notification link
  const src = r.source_file_url || r.official_notification_link || '';
  if (!src) return toast('No source attached for this row');

  const showInPane = (url, label) => {
    $('viewerLabel').textContent = label;
    $('viewerFrame').src = url;
    $('viewerPane').style.display = 'block';
  };

  // Google Drive file → /preview embeds in the iframe; /view opens in a tab
  const dm = src.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (dm) {
    if (inReview) showInPane(`https://drive.google.com/file/d/${dm[1]}/preview`, (r.post_name || 'Source') + (page ? ` — p.${page}` : ''));
    else window.open(`https://drive.google.com/file/d/${dm[1]}/view`, '_blank', 'noopener');
    return;
  }
  if (/^https?:\/\//i.test(src)) {
    // external gov links usually block iframing → always open a tab
    window.open(src + (page ? `#page=${page}` : ''), '_blank', 'noopener');
    return;
  }
  // Supabase storage path → signed URL
  let url = '';
  try {
    const res = await api(`/storage/v1/object/sign/sources/${encodeURIComponent(src)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }),
    });
    const d = await res.json();
    if (d.signedURL) url = SB + '/storage/v1' + d.signedURL + (page ? `#page=${page}` : '');
  } catch { /* */ }
  if (!url) return toast('Could not open source');
  if (inReview) showInPane(url, (r.post_name || 'Source') + (page ? ` — p.${page}` : ''));
  else window.open(url, '_blank', 'noopener');
}


/* ---------------- manage (full CRUD over all rows) ---------------- */
const MG_PAGE_SIZE = 25;
let MG_PAGE = 1;
let MANAGE_ROWS = [];

function collectPatch(scopeEl) {
  const patch = {};
  scopeEl.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
  const lvl = levelTok(patch.level);                         // keeps "13A"
  if ('level' in patch) { patch.level = lvl; patch.level_text = lvl ? `Level-${lvl}` : ''; }
  if (patch.ministry) patch.min_code = MIN_CODE_BY_NAME[patch.ministry] || minCode(patch.ministry);
  applyTiersToPatch(patch, scopeEl);
  return patch;
}

// vacancy_ids approved but not yet posted to the WhatsApp channel (from the
// local bridge's /pending). null = bridge unreachable → no badges, no errors.
let WA_PENDING = null;
async function refreshWaPending() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const p = await (await fetch(`${WA_BRIDGE}/pending`, { signal: ctl.signal })).json();
    clearTimeout(t);
    WA_PENDING = new Set((p.items || []).map((x) => x.vacancy_id).filter(Boolean));
    if ($('mgWaStatus') && !$('mgWaStatus').textContent) $('mgWaStatus').textContent = WA_PENDING.size ? `${WA_PENDING.size} pending` : '';
  } catch { WA_PENDING = null; }
}

// Set by openManageForRow() when an admin clicks ✎ Edit from the Verify tab;
// loadManage() consumes it once the list is on screen to scroll to + auto-open
// the target row. Cleared after one use so a manual refresh doesn't re-trigger.
// Declared immediately above loadManage() so the declaration → read order is
// obvious in the source (avoids any TDZ surprise if the closure is ever invoked
// during module-load).
let OPEN_MANAGE_ROW = null;

async function loadManage() {
  const status = $('mgStatus').value;
  let q = 'vacancies?select=*&order=created_at.desc,id.asc';
  // "marked" is a virtual status — it really means "any status, marked_for_review=true"
  if (status === 'marked') q += '&marked_for_review=eq.true';
  else if (status !== 'all') q += `&status=eq.${status}`;
  // non-blocking: 📣 badges pop in when the local bridge answers
  refreshWaPending().then(() => { if (WA_PENDING && !$('paneManage').classList.contains('hidden')) renderManage(); });
  try {
    MANAGE_ROWS = await fetchAll(q);
    populateManageSourceFilter();
    renderManage();
    // If the Verify tab's ✎ Edit button brought us here, navigate to the page
    // that actually contains the target row before kicking off auto-open. The
    // first renderManage() above ran on MG_PAGE=1 (we reset it in
    // openManageForRow); if the target is older than the 25th-newest approved
    // vacancy, it's not on page 1's DOM. Find its index in the same filter+sort
    // view renderManage uses, then jump to its page + re-render.
    if (OPEN_MANAGE_ROW) {
      const view = getManageViewRows();
      const idx = view.findIndex((r) => String(r.id) === OPEN_MANAGE_ROW);
      if (idx < 0) {
        // Row is in MANAGE_ROWS but got filtered out by mgSearch/mgSource. The
        // reset in openManageForRow should have cleared those, but if a future
        // filter slips through, this guard keeps the flow graceful.
        console.warn('[openManageForRow] target filtered out of view:', OPEN_MANAGE_ROW,
          'view length', view.length, 'MANAGE_ROWS length', MANAGE_ROWS.length);
      } else {
        const wantPage = Math.floor(idx / MG_PAGE_SIZE) + 1;
        if (wantPage !== MG_PAGE) {
          MG_PAGE = wantPage;
          renderManage();
        }
      }
    }
    if (OPEN_MANAGE_ROW) {
      const target = OPEN_MANAGE_ROW; OPEN_MANAGE_ROW = null;
      // Two-RAF open: WA_PENDING may call renderManage() a second time after the
      // bridge responds, which wipes + re-creates the cards. If we open on the
      // first paint and WA re-renders, the editor disappears. Re-open after a
      // 500ms grace window that outlasts a typical WA bridge round-trip, so the
      // final visible state always has the editor open.
      const openRow = () => {
        const card = document.querySelector(`.draft[data-mg-id="${CSS.escape(target)}"]`);
        if (!card) {
          // Row may be on a different Manage page (newest-first ordering usually
          // keeps it on page 1, but the source/sort filters or a long backlog can
          // hide it). Tell the admin where to look rather than leaving silence.
          console.warn('[openManageForRow] card not found for target', target,
            '— current page DOM has',
            document.querySelectorAll('.draft[data-mg-id]').length, 'cards');
          toast('Row opened on Manage — find it under the search results to edit it');
          return;
        }
        const toggle = card.querySelector('[data-act="toggle"]');
        if (!toggle) {
          console.warn('[openManageForRow] no [data-act="toggle"] on card', target);
          return;
        }
        console.info('[openManageForRow] opening card', target, 'toggle was', toggle.textContent);
        if (toggle.textContent === 'Edit') toggle.click();
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('mg-flash');
        setTimeout(() => card.classList.remove('mg-flash'), 1200);
      };
      requestAnimationFrame(openRow);
      setTimeout(openRow, 600);
    }
  } catch (e) { toast('Load error: ' + e.message); }
}

// Mirror of populateDraftSourceFilter for Manage. (The Status dropdown's
// "🚩 Marked" item handles the marked-for-review filter now.)
let RESTORE_MG_SOURCE = '';
function populateManageSourceFilter() {
  const sel = $('mgSource');
  if (!sel) return;
  const prev = sel.value || RESTORE_MG_SOURCE; RESTORE_MG_SOURCE = '';
  const srcs = [...new Set(MANAGE_ROWS.map((r) => String(r.source_category || r.source_type || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All</option>'
    + srcs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (prev && srcs.includes(prev)) sel.value = prev;
}

// Apply the current mgSearch / mgSource / mgSort to MANAGE_ROWS and return the
// result. Used by renderManage() and by loadManage() to locate the Verify-tab
// target's page (so the deep-link lands on the page that actually contains it).
function getManageViewRows() {
  const q = ($('mgSearch').value || '').toLowerCase().trim();
  const src = ($('mgSource') && $('mgSource').value || '').trim();
  let filtered = !q ? MANAGE_ROWS : MANAGE_ROWS.filter((r) => rowMatchesQuery(r, q));
  if (src) filtered = filtered.filter((r) => String(r.source_category || r.source_type || '').trim() === src);
  const mode = ($('mgSort') && $('mgSort').value) || 'upload';
  return sortRows(filtered, mode);
}

function renderManage() {
  const rows = getManageViewRows();
  $('manageCount').textContent = `(${rows.length})`;
  const list = $('manageList');
  const pager = $('mgPager');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<p class="muted">No matching rows.</p>';
    if (pager) pager.innerHTML = '';
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / MG_PAGE_SIZE));
  if (MG_PAGE > pages) MG_PAGE = pages;
  const start = (MG_PAGE - 1) * MG_PAGE_SIZE;
  const slice = rows.slice(start, start + MG_PAGE_SIZE);
  const showHeaders = (($('mgSort') && $('mgSort').value) || 'upload') === 'source';
  let lastSrc = null;
  slice.forEach((r) => {
    if (showHeaders) {
      const src = _sourceKey(r);
      if (src !== lastSrc) {
        const hdr = document.createElement('div');
        hdr.className = 'jobhdr';
        hdr.textContent = `Source: ${r.source_category || r.source_type || 'unknown'}`;
        list.appendChild(hdr);
        lastSrc = src;
      }
    }
    const card = manageCard(r, false);
    // Stamp data-mg-id on the card root so openManageForRow() can scroll to +
    // auto-open the one requested from the Verify tab. (The card has no other
    // data-* attribute on its root element to hook into.)
    card.dataset.mgId = r.id;
    list.appendChild(card);
  });
  wirePager(pager, MG_PAGE, pages, start, slice.length, rows.length, 'row(s)',
    (p) => { MG_PAGE = p; saveUI({ mgPage: p }); renderManage(); });
}

// Banner shown atop the editor when this row was opened from a flag. Compares
// the current value of the flagged field with the reporter's suggestion and
// offers a one-click "Apply" (fills the input; admin still Saves).
function flagBannerHtml(r) {
  const fl = ACTIVE_FLAG;
  if (!fl || String(fl.vacancy_id) !== String(r.vacancy_id)) return '';
  const col = FLAG_FIELD_TO_COLUMN[fl.field] || '';
  const current = col ? (r[col] != null ? String(r[col]) : '') : '';
  const suggested = fl.suggested_value || '';
  const showCompare = !!col;
  return `
    <div class="flag-banner" data-flag-banner data-col="${escapeHtml(col)}">
      <div class="flag-banner-head">
        ⚑ Community flag — <b>${escapeHtml(FLAG_ISSUE_LABEL[fl.issue_type] || fl.issue_type)}</b>
        <span class="muted">· ${escapeHtml(FLAG_FIELD_LABEL[fl.field] || fl.field)} · 👍 ${fl.endorsements}</span>
      </div>
      ${fl.note ? `<div class="flag-banner-note">${escapeHtml(fl.note)}</div>` : ''}
      ${showCompare ? `
        <div class="flag-compare">
          <div class="fc-row"><span class="fc-lbl">Current</span><span class="fc-cur">${current ? escapeHtml(current) : '<em>(empty)</em>'}</span></div>
          <div class="fc-row"><span class="fc-lbl">Suggested</span><span class="fc-sug">${suggested ? escapeHtml(suggested) : '<em>(none given)</em>'}</span></div>
        </div>
        ${suggested ? '<button type="button" class="good" data-apply-suggestion>Apply suggestion →</button>' : ''}
      ` : `<div class="muted" style="font-size:.85rem">No specific field — review the whole vacancy below.${suggested ? ' Suggested: <b>' + escapeHtml(suggested) + '</b>' : ''}</div>`}
    </div>`;
}

function manageCard(r, isNew) {
  const el = document.createElement('div');
  el.className = 'draft';
  const flagged = !isNew && ACTIVE_FLAG && String(ACTIVE_FLAG.vacancy_id) === String(r.vacancy_id);
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(isNew ? 'New vacancy' : (r.post_name || '(untitled)'))}</b>
        ${isNew ? '' : `<span class="muted"> · ${escapeHtml(r.organisation || '')}${r.level ? ' · L' + escapeHtml(r.level) : ''}${r.location_city ? ' · ' + escapeHtml(r.location_city) : ''}</span>`}
        <span class="pill">${escapeHtml(isNew ? 'new' : (r.status || ''))}</span>
        ${isNew ? '' : linkDomainBadge(r)}${isNew ? '' : deadlineBadge(r)}
        ${(!isNew && r.marked_for_review) ? '<span class="pill mark-badge" title="Marked for review">🚩 review</span>' : ''}
        ${(!isNew && r.status === 'approved' && WA_PENDING && WA_PENDING.has(r.vacancy_id)) ? '<span class="pill" style="color:#34d399;border-color:rgba(52,211,153,.5)" title="Approved but not yet posted to the WhatsApp channel">📣 not posted</span>' : ''}
        ${flagged ? '<span class="pill" style="background:rgba(244,63,94,.15);border-color:rgba(244,63,94,.4);color:#fda4af">⚑ flagged</span>' : ''}
      </div>
      <div class="acts">
        ${(!isNew && (r.source_file_url || r.official_notification_link)) ? '<button data-act="source">📄 source</button>' : ''}
        ${isNew ? '' : '<button data-act="gsearch" title="Open a Google search (new tab) for this post + organisation deputation PDF">🌐 Google</button>'}
        ${isNew ? '' : `<button data-act="mark" class="${r.marked_for_review ? 'good' : ''}" title="Flag this vacancy for a second look — find it later under Source → 🚩 Marked for review">${r.marked_for_review ? '🚩 Marked' : '🚩 Mark'}</button>`}
        <button data-act="toggle">${(isNew || flagged) ? 'Hide' : 'Edit'}</button>
        ${isNew ? '' : '<button class="bad" data-act="del">Delete</button>'}
      </div>
    </div>
    <div class="editor" style="display:none"></div>`;

  const editor = el.querySelector('.editor');

  // Built lazily on first open (same pattern as the Review cards): the full
  // editor is 20+ inputs incl. the 50-option ministry select — far too heavy
  // to render for every Manage row up-front. isNew/flagged cards start open,
  // so they build immediately below.
  const buildEditor = () => {
    if (el.dataset.built) return;
    editor.innerHTML = `
      ${flagBannerHtml(r)}
      ${(!isNew && r.raw_extraction && r.raw_extraction.detailed_eligibility) ? verbatimHtml(r.raw_extraction.detailed_eligibility) : ''}
      <div class="row">
        ${FIELDS.map(([k, lbl]) => fieldHtml(k, lbl, r)).join('')}
        ${tiersEditorHtml(r)}
        <div><label>Status</label>
          <select data-k="status">
            <option value="approved"${r.status === 'approved' ? ' selected' : ''}>approved (live)</option>
            <option value="draft"${r.status === 'draft' ? ' selected' : ''}>draft</option>
            <option value="rejected"${r.status === 'rejected' ? ' selected' : ''}>rejected (hidden)</option>
          </select>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="good" data-act="save">${isNew ? 'Create' : 'Save changes'}</button>
        <button data-act="cancel">Cancel</button>
      </div>`;
    wireTiersEditor(el);
    el.dataset.built = '1';

    // Flag comparison: spotlight the flagged field's input + wire "Apply suggestion".
    if (flagged) {
      const banner = el.querySelector('[data-flag-banner]');
      const col = banner && banner.dataset.col;
      const targetInput = col ? editor.querySelector(`[data-k="${col}"]`) : null;
      if (targetInput) targetInput.classList.add('flag-target');
      const applyBtn = el.querySelector('[data-apply-suggestion]');
      if (applyBtn && targetInput) {
        applyBtn.onclick = () => {
          targetInput.value = ACTIVE_FLAG.suggested_value || '';
          targetInput.classList.add('flag-applied');
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.focus();
          toast('Suggestion filled in — review, then Save changes');
        };
      }
    }

    el.querySelector('[data-act="cancel"]').onclick = () => {
      if (isNew) { el.remove(); return; }
      editor.style.display = 'none';
      el.querySelector('[data-act="toggle"]').textContent = 'Edit';
    };

    wireSave();
  };

  el.querySelector('[data-act="toggle"]').onclick = (e) => {
    buildEditor();
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    e.currentTarget.textContent = showing ? 'Edit' : 'Hide';
  };

  if (isNew || flagged) {
    buildEditor();
    editor.style.display = 'block';
    // scroll the flagged card into view once rendered
    if (flagged) setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }

  function wireSave() { el.querySelector('[data-act="save"]').onclick = async () => {
    const patch = collectPatch(editor);
    if (!patch.post_name) return toast('Post name is required');
    try {
      if (isNew) {
        const yr = new Date().getFullYear();
        patch.vacancy_id = `${patch.min_code || 'MAN'}-${yr}-L${(patch.level || 'X')}-${Date.now() % 100000}`;
        patch.source_type = patch.source_type || 'manual';
        if (!patch.status) patch.status = 'approved';
        // route through the same smart-merge as ingest: a brand-new vacancy is
        // inserted; a match enriches the existing row or queues an update/duplicate.
        const res = await applyMergeImport([patch]);
        refreshUpdatesCount();
        if (res.inserted) { toast('✅ Added'); el.remove(); }
        else toast(summarizeIngest(res) + ((res.updatesQueued || res.duplicatesFlagged) ? ' — see Updates tab' : ''));
        loadManage();
      } else {
        const res = await api(`/rest/v1/vacancies?id=eq.${r.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(/duplicate|unique/i.test(t) ? 'Would duplicate an existing entry' : t);
        }
        toast('✅ Saved');
        // update the cached row + swap just this card — no full-list reload
        Object.assign(r, patch);
        el.replaceWith(manageCard(r, false));
      }
    } catch (e) { toast('Save failed: ' + e.message); }
  }; }

  const delBtn = el.querySelector('[data-act="del"]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete "${r.post_name}"? This cannot be undone.`)) return;
    try {
      const res = await api(`/rest/v1/vacancies?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      el.remove(); toast('Deleted'); scheduleGc();
    } catch (e) { toast('Delete failed: ' + e.message); }
  };

  const srcBtn = el.querySelector('[data-act="source"]');
  if (srcBtn) srcBtn.onclick = () => openSource(r, String((r.raw_extraction && r.raw_extraction.source_page) || '').replace(/\D/g, ''));

  // Google search: prefers the live edited values if the editor is open,
  // otherwise the row's saved values (same shape as the Review-queue button).
  const gsBtn = el.querySelector('[data-act="gsearch"]');
  if (gsBtn) gsBtn.onclick = () => {
    const val = (k, fb) => {
      const inp = editor.querySelector(`[data-k="${k}"]`);
      return ((inp && inp.value.trim()) || fb || '').trim();
    };
    const post = val('post_name', r.post_name);
    const org = val('organisation', r.organisation);
    const q = `${post} ${org} "Deputation" "2026" "pdf"`.replace(/\s+/g, ' ').trim();
    window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
  };

  // Mark / unmark for review — re-render the card so the badge, button label,
  // and (for an empty Marked filter) the visible row count stay consistent.
  const mkBtn = el.querySelector('[data-act="mark"]');
  if (mkBtn) mkBtn.onclick = async () => {
    const next = !r.marked_for_review;
    mkBtn.disabled = true;
    try {
      const res = await api(`/rest/v1/vacancies?id=eq.${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ marked_for_review: next }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      r.marked_for_review = next;
      const cached = MANAGE_ROWS.find((x) => x.id === r.id);
      if (cached) cached.marked_for_review = next;
      // if we're currently filtered to "Marked for review" and the row just
      // got UNmarked, drop it from the page instead of re-rendering it visibly
      // If we're currently filtered to "Marked" and the row just got UNmarked,
      // drop it from view rather than re-rendering it as visible-but-unmarked.
      const inMarkedView = $('mgStatus') && $('mgStatus').value === 'marked';
      if (inMarkedView && !next) { el.remove(); renderManage(); }
      else el.replaceWith(manageCard(r, false));
      toast(next ? '🚩 Marked for review' : 'Unmarked');
    } catch (e) { toast('Update failed: ' + e.message); mkBtn.disabled = false; }
  };
  return el;
}

/* ---------------- community flags (reported issues) ---------------- */
const FLAG_ISSUE_LABEL = {
  broken_link: 'Broken / dead link', wrong_link: 'Wrong document link',
  wrong_pay_level: 'Wrong pay level', wrong_deadline: 'Wrong deadline',
  closed_already: 'Already closed', wrong_location: 'Wrong location',
  duplicate: 'Duplicate', other: 'Other',
};
const FLAG_FIELD_LABEL = {
  whole: 'whole vacancy', official_notification_link: 'notification link',
  application_form_link: 'apply link', level: 'pay level',
  last_date_to_apply: 'last date', location: 'location', post_name: 'post name', other: 'other',
};

// The flag's `field` vocabulary -> the actual editable DB column (data-k) it maps
// to. 'location' has no single column; we point it at location_city. 'whole'/
// 'other' don't map to one field (banner shows guidance only, no field highlight).
const FLAG_FIELD_TO_COLUMN = {
  official_notification_link: 'official_notification_link',
  application_form_link: 'application_form_link',
  level: 'level',
  last_date_to_apply: 'last_date_to_apply',
  location: 'location_city',
  post_name: 'post_name',
};

// Set when an admin clicks "Open in manager" on a flag; consumed by renderManage
// to auto-expand the matching card and show the current-vs-suggested banner.
let ACTIVE_FLAG = null;

/* ---------------- feedback (contact-form submissions) ---------------- */
async function loadFeedback() {
  const status = $('fbStatus') ? $('fbStatus').value : 'new';
  let url = '/rest/v1/feedback?select=*&order=created_at.desc&limit=500';
  if (status !== 'all') url += `&status=eq.${status}`;
  const list = $('fbList');
  if (list) list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    renderFeedback(await r.json());
  } catch (e) { if (list) list.innerHTML = `<p class="muted">Load error: ${escapeHtml(e.message)}</p>`; }
  refreshFeedbackCount();
}

async function refreshFeedbackCount() {
  const n = await countOf('feedback?status=eq.new');
  if ($('fbCount')) $('fbCount').textContent = n ? `(${n})` : '';
}

// Category order mirrors the Contact page “Category” dropdown (contact.html).
const FB_CATEGORY_ORDER = [
  'General Feedback',
  'Report a Bug',
  'Suggest a Feature',
  'Vacancy Correction',
  'New Rule/Circular',
  'Policy Clarification',
  'WhatsApp Group Issue',
  'Other',
];

function fbCategoryRank(cat) {
  const i = FB_CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? FB_CATEGORY_ORDER.length : i;
}

function fbPageOf(f) {
  return f.page_label || f.page || f.related_page || 'Whole site';
}

function renderFeedback(rows) {
  const list = $('fbList');
  if ($('fbHdrCount')) $('fbHdrCount').textContent = `(${rows.length})`;
  if (!list) return;
  if (!rows.length) { list.innerHTML = '<p class="muted">No feedback in this view.</p>'; return; }
  list.innerHTML = '';

  // Group by category (dropdown order), then by page within each category.
  const byCat = new Map();
  rows.forEach((f) => {
    const cat = f.category || 'General Feedback';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(f);
  });

  const cats = [...byCat.keys()].sort(
    (a, b) => fbCategoryRank(a) - fbCategoryRank(b) || a.localeCompare(b)
  );

  cats.forEach((cat) => {
    const catRows = byCat.get(cat);
    const catHdr = document.createElement('h3');
    catHdr.className = 'fb-cat-hdr';
    catHdr.innerHTML = `${escapeHtml(cat)} <span class="muted">(${catRows.length})</span>`;
    list.appendChild(catHdr);

    // Sub-group by page (dropdown’s second selector).
    const byPage = new Map();
    catRows.forEach((f) => {
      const page = fbPageOf(f);
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(f);
    });
    const pages = [...byPage.keys()].sort((a, b) => a.localeCompare(b));

    pages.forEach((page) => {
      const pageRows = byPage.get(page);
      const pageHdr = document.createElement('h4');
      pageHdr.className = 'fb-page-hdr';
      pageHdr.innerHTML = `📄 ${escapeHtml(page)} <span class="muted">(${pageRows.length})</span>`;
      list.appendChild(pageHdr);
      pageRows.forEach((f) => list.appendChild(feedbackCard(f)));
    });
  });
}

function feedbackCard(f) {
  const el = document.createElement('div');
  el.className = 'draft';
  const when = (f.created_at || '').slice(0, 10);
  const status = f.status || 'new';
  const who = [f.name, f.email].filter(Boolean).join(' · ');
  const link = f.related_link || '';
  const linkHtml = /^https?:\/\//i.test(link)
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>`
    : escapeHtml(link);
  el.innerHTML = `
    <div class="head">
      <div>
        <span class="pill">${escapeHtml(status)}</span>
        <span class="muted"> · ${escapeHtml(when)}</span>
      </div>
      <div class="acts">
        ${status === 'resolved'
          ? '<button data-act="reopen">Re-open</button>'
          : '<button class="good" data-act="resolve">✓ Resolved</button>'}
        <button class="bad" data-act="del">Delete</button>
      </div>
    </div>
    ${f.subject ? `<div style="margin:6px 0;font-weight:600">${escapeHtml(f.subject)}</div>` : ''}
    ${f.message ? `<div style="margin:6px 0;color:var(--text,#cbd5e1);white-space:pre-wrap">${escapeHtml(f.message)}</div>` : ''}
    ${link ? `<div class="muted" style="margin:4px 0"><b>Link:</b> ${linkHtml}</div>` : ''}
    ${who ? `<div class="muted" style="font-size:.8rem">From: ${escapeHtml(who)}</div>` : ''}`;

  const setStatus = async (next) => {
    try {
      const r = await api(`/rest/v1/feedback?id=eq.${f.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast(`Feedback marked ${next}`); loadFeedback();
    } catch (e) { toast('Update failed: ' + e.message); }
  };
  el.querySelector('[data-act="resolve"]')?.addEventListener('click', () => setStatus('resolved'));
  el.querySelector('[data-act="reopen"]')?.addEventListener('click', () => setStatus('new'));
  el.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    const what = f.subject ? `"${f.subject}"` : 'this feedback';
    if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
    try {
      // return=representation so we can confirm a row was actually removed — a
      // missing RLS DELETE policy returns 204 with an empty body (silent no-op).
      const r = await api(`/rest/v1/feedback?id=eq.${f.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const deleted = await r.json().catch(() => []);
      if (!Array.isArray(deleted) || !deleted.length) throw new Error('nothing deleted (permission?)');
      el.remove(); toast('Feedback deleted'); refreshFeedbackCount();
    } catch (e) { toast('Delete failed: ' + e.message); }
  });
  return el;
}

/* ============================================================================
   Verify tab — the second pass over bulk-published vacancies.

   Bulk approve publishes without anyone reading the row (see statusPatch()).
   Those rows are live but carry admin_verified = false, and this is where they
   are checked off. Verifying is the ONLY thing this tab does: it never edits,
   rejects or unpublishes, because the row is already public — the decision here
   is just "yes, I have read this".

   The table deliberately mirrors the public dashboard's columns rather than the
   Review queue's editor cards. You are checking what a visitor sees, so you
   should be looking at what a visitor sees, with the source link one click away.
   ========================================================================== */
const VERIFY_PER = 25;
let VERIFY_PAGE = 1;
let VERIFY_TOTAL = 0;

const VF_SELECT = [
  'id', 'vacancy_id', 'post_name', 'organisation', 'department', 'ministry',
  'level_text', 'location_city', 'location_state', 'last_date_to_apply',
  'notification_date', 'official_notification_link', 'source_file_url',
  'confidence', 'created_at',
].join(',');

// Tab badge. Called after every bulk publish and every verify so the number
// never lies about how much is queued.
async function loadVerifyCount() {
  const n = await countOf('vacancies?status=eq.approved&admin_verified=eq.false');
  const badge = $('verifyCount');
  if (badge) badge.textContent = n ? `(${n})` : '';
  const hdr = $('vfHdrCount');
  if (hdr) hdr.textContent = n ? `— ${n} pending` : '';
  return n;
}

async function loadVerifyQueue(page = VERIFY_PAGE) {
  VERIFY_PAGE = Math.max(1, page);
  const list = $('vfList');
  if (!list) return;
  list.innerHTML = '<p class="muted">Loading…</p>';
  const offset = (VERIFY_PAGE - 1) * VERIFY_PER;
  try {
    const r = await api(
      `/rest/v1/vacancies?status=eq.approved&admin_verified=eq.false`
      + `&select=${VF_SELECT}&order=created_at.desc&limit=${VERIFY_PER}&offset=${offset}`,
      { headers: { Prefer: 'count=exact' } },
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    VERIFY_TOTAL = parseInt(((r.headers.get('content-range') || '/0').split('/')[1]) || '0', 10) || 0;
    const rows = await r.json();
    // Deleting/verifying the last row of a page leaves you stranded past the
    // end — step back a page instead of showing a spurious empty state.
    if (!rows.length && VERIFY_PAGE > 1 && VERIFY_TOTAL > 0) return loadVerifyQueue(VERIFY_PAGE - 1);
    renderVerifyTable(rows);
    renderVerifyPager();
    loadVerifyCount();
  } catch (e) {
    list.innerHTML = `<p class="muted">Load error: ${escapeHtml(e.message)}.`
      + ` If this is the first run, apply <code>supabase/migrations/0017_admin_verified.sql</code> in the SQL editor.</p>`;
  }
}

function vfLocation(r) {
  return [r.location_city, r.location_state].map((x) => (x || '').trim()).filter(Boolean).join(', ') || '—';
}

function vfOrg(r) {
  return (r.organisation || r.department || '').trim() || '—';
}

function renderVerifyTable(rows) {
  const list = $('vfList');
  if (!rows.length) {
    list.innerHTML = '<p class="muted">🎉 Nothing pending — every published vacancy has been verified.</p>';
    if ($('vfCheckAll')) $('vfCheckAll').checked = false;
    updateVerifyBulkBar();
    return;
  }
  const body = rows.map((r) => {
    const link = (r.official_notification_link || '').trim();
    return `
      <tr class="vf-row" data-vf-row="${escapeHtml(String(r.id))}">
        <td class="vf-ribbon-cell">
          <span class="vf-ribbon" title="Admin verification pending" aria-label="Admin verification pending"></span>
        </td>
        <td><input type="checkbox" data-vf-id="${escapeHtml(String(r.id))}" aria-label="Select for bulk verify" /></td>
        <td>
          <strong>${escapeHtml(r.post_name || '—')}</strong>
          <div class="muted" style="font-size:.85em">${escapeHtml(vfOrg(r))}</div>
        </td>
        <td>${escapeHtml(r.level_text || '—')}</td>
        <td>${escapeHtml(r.ministry || '—')}</td>
        <td>${escapeHtml(vfLocation(r))}</td>
        <td>${escapeHtml(r.last_date_to_apply || '—')}</td>
        <td>${link
          ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🔗 Official</a>`
          : (r.source_file_url ? `<a href="${escapeHtml(r.source_file_url)}" target="_blank" rel="noopener noreferrer">📄 Source</a>` : '—')}</td>
        <td><button class="good" data-vf-verify="${escapeHtml(String(r.id))}">✓ Verify</button><button class="vf-edit" data-vf-edit="${escapeHtml(String(r.id))}" title="Open this row in Manage data to edit it" style="margin-left:6px">✎ Edit</button></td>
      </tr>`;
  }).join('');

  list.innerHTML = `
    <table class="vf-table">
      <thead>
        <tr>
          <th aria-label="Verification status"></th>
          <th></th>
          <th>Post / Organisation</th>
          <th>Level</th>
          <th>Ministry</th>
          <th>Location</th>
          <th>Last date</th>
          <th>Link</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;

  list.querySelectorAll('[data-vf-verify]').forEach((b) => {
    b.onclick = () => verifyIds([b.dataset.vfVerify]);
  });
  list.querySelectorAll('[data-vf-edit]').forEach((b) => {
    b.onclick = () => openManageForRow(b.dataset.vfEdit);
  });
  list.querySelectorAll('input[data-vf-id]').forEach((c) => {
    c.onchange = updateVerifyBulkBar;
  });
  if ($('vfCheckAll')) $('vfCheckAll').checked = false;
  updateVerifyBulkBar();
}

function renderVerifyPager() {
  const pager = $('vfPager');
  if (!pager) return;
  const pages = Math.max(1, Math.ceil(VERIFY_TOTAL / VERIFY_PER));
  if (pages <= 1) { pager.innerHTML = ''; return; }
  pager.innerHTML = `
    <button ${VERIFY_PAGE <= 1 ? 'disabled' : ''} data-vf-page="${VERIFY_PAGE - 1}">← Prev</button>
    <span class="muted">Page ${VERIFY_PAGE} / ${pages}</span>
    <button ${VERIFY_PAGE >= pages ? 'disabled' : ''} data-vf-page="${VERIFY_PAGE + 1}">Next →</button>`;
  pager.querySelectorAll('[data-vf-page]').forEach((b) => {
    b.onclick = () => loadVerifyQueue(parseInt(b.dataset.vfPage, 10));
  });
}

function checkedVerifyIds() {
  return [...$('vfList').querySelectorAll('input[data-vf-id]:checked')].map((c) => c.dataset.vfId);
}

function updateVerifyBulkBar() {
  const n = checkedVerifyIds().length;
  const label = $('vfCheckedCount');
  if (label) label.textContent = n ? `${n} selected` : '';
  const btn = $('vfVerifyChecked');
  if (btn) {
    btn.disabled = !n;
    btn.textContent = n ? `✓ Verify checked (${n})` : '✓ Verify checked';
  }
}

/* Mark rows verified. The ribbon turns green in place and the row fades before
 * it leaves, so the click has a visible result instead of the row just
 * vanishing — with a batch of 25 near-identical rows, silent removal makes it
 * genuinely hard to tell which one you just acted on. */
async function verifyIds(ids) {
  if (!ids.length) return;
  const patch = { admin_verified: true, verified_at: new Date().toISOString() };
  const okIds = [];
  let fail = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    try {
      const r = await api(`/rest/v1/vacancies?id=in.(${part.join(',')})`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      okIds.push(...part);
    } catch { fail += part.length; }
  }
  const gone = new Set(okIds.map(String));
  $('vfList').querySelectorAll('[data-vf-row]').forEach((tr) => {
    if (!gone.has(tr.dataset.vfRow)) return;
    const ribbon = tr.querySelector('.vf-ribbon');
    if (ribbon) { ribbon.classList.add('is-verified'); ribbon.title = 'Admin verified'; }
    tr.classList.add('is-verified');
    setTimeout(() => tr.classList.add('is-leaving'), 550);
  });
  toast(`✅ Verified ${okIds.length}${fail ? `, ${fail} failed` : ''}`);
  // Let the green-then-fade play out before the list re-renders under it.
  setTimeout(() => loadVerifyQueue(), 1000);
}

function verifyChecked() {
  const ids = checkedVerifyIds();
  if (!ids.length) return toast('Nothing checked');
  if (!confirm(`Mark ${ids.length} vacanc${ids.length === 1 ? 'y' : 'ies'} as admin-verified?`)) return;
  verifyIds(ids);
}

/* Verify EVERY pending row, not just this page. Same guard shape as Approve
 * all: a large batch has to be confirmed by typing the count, because this
 * clears the whole safety net in one click. */
async function verifyAllPending() {
  const n = await loadVerifyCount();
  if (!n) return toast('Nothing pending');
  const warn = `Mark ALL ${n} pending vacanc${n === 1 ? 'y' : 'ies'} as admin-verified?\n\n`
    + `This covers every page, not just the rows on screen, and asserts that each one has been checked.`;
  if (n >= 50) {
    const typed = prompt(`${warn}\n\nThis is a large batch. Type the number ${n} to confirm:`);
    if (String(typed || '').trim() !== String(n)) return toast('Cancelled — number did not match');
  } else if (!confirm(warn)) {
    return;
  }
  const btn = $('vfVerifyAll');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/rest/v1/vacancies?status=eq.approved&admin_verified=eq.false&select=id', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ admin_verified: true, verified_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(await r.text());
    const done = (await r.json().catch(() => [])).length;
    toast(`✅ Verified ${done} vacanc${done === 1 ? 'y' : 'ies'}`);
    loadVerifyQueue(1);
  } catch (e) {
    toast('Verify failed: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================================
   Projects CMS — manages public.upcoming_projects (V² Upcoming Projects page).
   ========================================================================== */
let PROJ_ROWS = [];

async function loadProjectsAdmin() {
  const list = $('projList');
  if (list) list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api('/rest/v1/upcoming_projects?select=*&order=sort_order.asc,created_at.asc&limit=500');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    PROJ_ROWS = await r.json();
    renderProjectsAdmin(PROJ_ROWS);
  } catch (e) {
    if (list) list.innerHTML = `<p class="muted">Load error: ${escapeHtml(e.message)}. If this is the first run, apply <code>supabase/migrations/0013_upcoming_projects.sql</code> in the SQL editor.</p>`;
  }
  refreshProjectCount();
}

async function refreshProjectCount() {
  const n = await countOf('upcoming_projects');
  if ($('projCount')) $('projCount').textContent = n ? ` (${n})` : '';
}

function renderProjectsAdmin(rows) {
  const list = $('projList');
  if ($('projHdrCount')) $('projHdrCount').textContent = `(${rows.length})`;
  if (!list) return;
  if (!rows.length) { list.innerHTML = '<p class="muted">No projects yet. Click <b>+ Add project</b> to create one.</p>'; return; }
  list.innerHTML = '';
  rows.forEach((p, i) => list.appendChild(projectCard(p, i, rows.length)));
}

function projectCard(p, i, n) {
  const el = document.createElement('div');
  el.className = 'draft';
  const tags = Array.isArray(p.tags) ? p.tags : [];
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(p.title || p.slug)}</b>
        <span class="pill">${escapeHtml(p.status || 'concept')}</span>
        ${p.is_published
          ? '<span class="pill" style="color:var(--good);border-color:var(--good)">live</span>'
          : '<span class="pill" style="color:var(--muted)">hidden</span>'}
        <span class="muted"> · #${p.sort_order ?? 0} · ${escapeHtml(p.slug)}</span>
      </div>
      <div class="acts">
        <button data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
        <button data-act="down" ${i === n - 1 ? 'disabled' : ''} title="Move down">▼</button>
        <button data-act="edit">Edit</button>
        <button data-act="pub">${p.is_published ? 'Unpublish' : 'Publish'}</button>
        <button class="bad" data-act="del">Delete</button>
      </div>
    </div>
    ${p.blurb ? `<div class="muted" style="margin:6px 0;white-space:pre-wrap">${escapeHtml(p.blurb)}</div>` : ''}
    ${tags.length ? `<div style="margin:4px 0">${tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
    ${p.image_url ? `<div class="muted" style="font-size:.8rem">🖼 ${escapeHtml(p.image_url)}</div>` : ''}`;

  el.querySelector('[data-act="edit"]').onclick = () => openProjectForm(p);
  el.querySelector('[data-act="del"]').onclick = () => deleteProject(p);
  el.querySelector('[data-act="pub"]').onclick = async () => {
    try { await patchProject(p.id, { is_published: !p.is_published }); toast(p.is_published ? 'Unpublished' : 'Published'); loadProjectsAdmin(); }
    catch (e) { toast('Failed: ' + e.message); }
  };
  el.querySelector('[data-act="up"]').onclick = () => moveProject(i, -1);
  el.querySelector('[data-act="down"]').onclick = () => moveProject(i, 1);
  return el;
}

/* An UPDATE that changes NOTHING is not an error to PostgREST.
 *
 * With `Prefer: return=minimal` a PATCH returns 204 whether it updated the row
 * or matched nothing at all — and RLS filters rows out *before* the update, so
 * a policy that denies the write is indistinguishable from a successful one.
 * That is why the ▲▼ / Publish buttons appeared to do nothing while still
 * announcing "Reordered" and "Unpublished": every call returned 204 and the
 * reload simply re-drew the unchanged data.
 *
 * `return=representation` makes the row count observable, so a write that
 * touched nothing is reported as the failure it is. deleteProject() has
 * carried this guard for a while (see the note there about a missing DELETE
 * policy) — the update path never got the same treatment.
 */
async function patchProject(id, patch) {
  const r = await api(`/rest/v1/upcoming_projects?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      'nothing was updated — the row is missing, or RLS is blocking the write '
      + '(check the up_admin_write policy on upcoming_projects and that your '
      + 'email is in public.admins)');
  }
  return rows[0];
}

// Reorder by renumbering all rows to clean 0,10,20… positions after the move.
async function moveProject(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= PROJ_ROWS.length) return;
  const arr = PROJ_ROWS.slice();
  const [it] = arr.splice(i, 1);
  arr.splice(j, 0, it);
  try {
    for (let k = 0; k < arr.length; k++) {
      if ((arr[k].sort_order ?? -1) !== k * 10) await patchProject(arr[k].id, { sort_order: k * 10 });
    }
    toast('Reordered'); loadProjectsAdmin();
  } catch (e) { toast('Reorder failed: ' + e.message); }
}

async function deleteProject(p) {
  if (!confirm(`Delete "${p.title || p.slug}"? This cannot be undone. (Votes recorded under project:${p.slug} are stored separately and are kept.)`)) return;
  try {
    // return=representation so a missing DELETE policy (silent 204) is caught
    const r = await api(`/rest/v1/upcoming_projects?id=eq.${p.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const del = await r.json().catch(() => []);
    if (!Array.isArray(del) || !del.length) throw new Error('nothing deleted (permission?)');
    toast('Project deleted'); loadProjectsAdmin();
  } catch (e) { toast('Delete failed: ' + e.message); }
}

function openProjectForm(p) {
  const f = $('projForm');
  f.classList.remove('hidden');
  $('projFormTitle').textContent = p ? 'Edit project' : 'Add project';
  $('pf_id').value     = p ? p.id : '';
  $('pf_title').value  = p ? (p.title || '') : '';
  $('pf_slug').value   = p ? (p.slug || '') : '';
  $('pf_blurb').value  = p ? (p.blurb || '') : '';
  $('pf_status').value = p ? (p.status || 'concept') : 'concept';
  $('pf_icon').value   = p ? (p.icon || 'spark') : 'spark';
  $('pf_tags').value   = p ? ((Array.isArray(p.tags) ? p.tags : []).join(', ')) : '';
  $('pf_order').value  = p ? (p.sort_order ?? 0) : (PROJ_ROWS.length * 10);
  $('pf_image').value  = p ? (p.image_url || '') : '';
  $('pf_pub').checked  = p ? !!p.is_published : true;
  $('pf_msg').textContent = '';
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('pf_title').focus();
}

async function saveProject() {
  const id    = $('pf_id').value.trim();
  const slug  = $('pf_slug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const title = $('pf_title').value.trim();
  const msg   = $('pf_msg');
  msg.className = 'muted';
  if (!title) { msg.textContent = 'Title is required.'; return; }
  if (!slug)  { msg.textContent = 'Slug is required.'; return; }
  const tags = $('pf_tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  const body = {
    slug, title,
    blurb: $('pf_blurb').value.trim(),
    status: $('pf_status').value,
    icon: $('pf_icon').value,
    tags,
    image_url: $('pf_image').value.trim() || null,
    sort_order: parseInt($('pf_order').value, 10) || 0,
    is_published: $('pf_pub').checked,
  };
  $('pf_save').disabled = true; msg.textContent = 'Saving…';
  try {
    // Same reasoning as patchProject(): an edit blocked by RLS comes back 204
    // under return=minimal and would report "Project updated" having saved
    // nothing. Ask for the row back so the write is verifiable.
    const r = id
      ? await api(`/rest/v1/upcoming_projects?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) })
      : await api('/rest/v1/upcoming_projects', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + (/duplicate key/i.test(t) ? ' — slug already exists' : (t ? ' — ' + t.slice(0, 120) : '')));
    }
    const saved = await r.json().catch(() => []);
    if (!Array.isArray(saved) || !saved.length) {
      throw new Error('nothing was saved — RLS is blocking the write (check the '
        + 'up_admin_write policy on upcoming_projects and that your email is in '
        + 'public.admins)');
    }
    toast(id ? 'Project updated' : 'Project added');
    $('projForm').classList.add('hidden');
    loadProjectsAdmin();
  } catch (e) { msg.textContent = 'Save failed: ' + e.message; }
  finally { $('pf_save').disabled = false; }
}

async function loadFlags() {
  const status = $('flagStatus') ? $('flagStatus').value : 'open';
  let url = '/rest/v1/vacancy_flags?select=*&order=endorsements.desc,created_at.desc&limit=500';
  if (status !== 'all') url += `&status=eq.${status}`;
  const list = $('flagsList');
  if (list) list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    renderFlags(rows);
  } catch (e) { if (list) list.innerHTML = `<p class="muted">Load error: ${escapeHtml(e.message)}</p>`; }
}

async function refreshFlagCount() {
  const n = await countOf('vacancy_flags?status=eq.open');
  const badge = $('flagCount');
  if (badge) badge.textContent = n ? `(${n})` : '';
}

function renderFlags(rows) {
  const list = $('flagsList');
  if ($('flagsCount')) $('flagsCount').textContent = `(${rows.length})`;
  if (!list) return;
  if (!rows.length) { list.innerHTML = '<p class="muted">No flags in this view.</p>'; return; }
  list.innerHTML = '';
  rows.forEach((f) => list.appendChild(flagCard(f)));
}

function flagCard(f) {
  const el = document.createElement('div');
  el.className = 'draft';
  const when = (f.created_at || '').slice(0, 10);
  const sv = (f.suggested_value || '').trim();
  const col = FLAG_FIELD_TO_COLUMN[f.field] || '';
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(FLAG_ISSUE_LABEL[f.issue_type] || f.issue_type)}</b>
        <span class="muted"> · ${escapeHtml(FLAG_FIELD_LABEL[f.field] || f.field || 'whole')} · ${escapeHtml(f.vacancy_id || '')}</span>
        <span class="pill">${escapeHtml(f.status || 'open')}</span>
        <span class="muted"> · 👍 ${Number(f.endorsements) || 0} · ${escapeHtml(when)}</span>
      </div>
      <div class="acts">
        ${(f.status === 'open' && col && sv) ? '<button class="good" data-act="applyresolve" title="Write the suggested value to the vacancy and mark this flag ✓ Valid — one click">⚡ Apply &amp; resolve</button>' : ''}
        <button data-act="open">🗂 Open in manager</button>
        ${f.status === 'open' ? '<button class="good" data-act="valid">✓ Valid</button><button class="bad" data-act="dismiss">Dismiss</button>' : '<button data-act="reopen">Re-open</button>'}
      </div>
    </div>
    ${f.note ? `<div style="margin:6px 0;color:var(--text,#cbd5e1)">${escapeHtml(f.note)}</div>` : ''}
    ${sv ? `<div class="muted" style="margin:4px 0"><b>Suggested:</b> ${escapeHtml(sv)}</div>` : ''}
    ${(f.reporter_name || f.reporter_email) ? `<div class="muted" style="font-size:.8rem">Reporter: ${escapeHtml(f.reporter_name || '')} ${escapeHtml(f.reporter_email || '')}</div>` : ''}`;

  const setStatus = async (status) => {
    try {
      const r = await api(`/rest/v1/vacancy_flags?id=eq.${f.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast(`Flag marked ${status}`); loadFlags(); refreshFlagCount();
    } catch (e) { toast('Update failed: ' + e.message); }
  };

  el.querySelector('[data-act="open"]').onclick = () => {
    // remember which flag we're acting on so the manager can show a
    // current-vs-suggested comparison and spotlight the flagged field
    ACTIVE_FLAG = {
      vacancy_id: f.vacancy_id || '',
      field: f.field || 'whole',
      issue_type: f.issue_type || '',
      note: f.note || '',
      suggested_value: f.suggested_value || '',
      endorsements: Number(f.endorsements) || 0,
    };
    // jump to Manage, pre-filtered to this vacancy so the admin can fix it
    document.querySelector('[data-tab="manage"]').click();
    if ($('mgStatus')) $('mgStatus').value = 'all';
    if ($('mgSearch')) $('mgSearch').value = f.vacancy_id || '';
    loadManage();
  };
  el.querySelector('[data-act="valid"]')?.addEventListener('click', () => setStatus('approved'));
  el.querySelector('[data-act="dismiss"]')?.addEventListener('click', () => setStatus('dismissed'));
  el.querySelector('[data-act="reopen"]')?.addEventListener('click', () => setStatus('open'));

  // One-click: write the suggested value to the vacancy, then mark the flag
  // valid. Only when the field maps to a single column AND the vacancy_id
  // resolves to exactly one row — anything murkier goes via Open in manager.
  el.querySelector('[data-act="applyresolve"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const vr = await api(`/rest/v1/vacancies?vacancy_id=eq.${encodeURIComponent(f.vacancy_id)}&select=id,status`);
      if (!vr.ok) throw new Error('HTTP ' + vr.status);
      let rows = await vr.json();
      const live = rows.filter((x) => x.status === 'approved');
      if (live.length) rows = live;
      if (rows.length !== 1) {
        toast(rows.length ? 'Several rows share this vacancy_id — use 🗂 Open in manager' : 'Vacancy not found — it may have been deleted');
        btn.disabled = false; return;
      }
      // normalise the suggestion the same way the editors do
      const patch = {};
      if (col === 'level') {
        const tok = levelTok(sv);
        if (!tok) throw new Error('the suggestion has no recognisable level');
        patch.level = tok; patch.level_text = `Level-${tok}`;
      } else if (col === 'last_date_to_apply') {
        const iso = toISODateInput(sv);
        if (!iso) throw new Error('the suggestion is not a recognisable date');
        patch[col] = iso;
      } else {
        patch[col] = sv;
      }
      const pr = await api(`/rest/v1/vacancies?id=eq.${rows[0].id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!pr.ok) throw new Error('HTTP ' + pr.status);
      await setStatus('approved');
      toast('⚡ Suggestion applied & flag resolved');
    } catch (err) { toast('Apply failed: ' + err.message); btn.disabled = false; }
  });
  return el;
}

/* ================= Pending updates & duplicate suggestions ================= */
let UPDATES_ROWS = [];   // cached so the Sort dropdown can re-order without refetch

async function loadUpdates() {
  const list = $('updatesList');
  if (list) list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api('/rest/v1/vacancy_updates?status=eq.pending&select=*,target:target_id(post_name,organisation,level_text,status,vacancy_id)&order=created_at.desc&limit=500');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    UPDATES_ROWS = await r.json();
    renderUpdates();
  } catch (e) { if (list) list.innerHTML = `<p class="muted">Load error: ${escapeHtml(e.message)}</p>`; }
}

// Adapt an update row to the shape sortRows() reads: notification_date comes
// from the proposed payload (the change being suggested), source from the
// update's own source_*; created_at is already top-level.
function _updSortable(u) {
  return {
    created_at: u.created_at,
    notification_date: (u.proposed && u.proposed.notification_date) || '',
    source_category: u.source_category,
    source_type: u.source_type,
    _u: u,
  };
}

async function refreshUpdatesCount() {
  const n = await countOf('vacancy_updates?status=eq.pending');
  const badge = $('updatesCount'); if (badge) badge.textContent = n ? `(${n})` : '';
}

function renderUpdates() {
  const rows = UPDATES_ROWS;
  const list = $('updatesList');
  if ($('updatesHdrCount')) $('updatesHdrCount').textContent = `(${rows.length})`;
  if (!list) return;
  if (!rows.length) { list.innerHTML = '<p class="muted">No pending updates or duplicate suggestions. 🎉</p>'; return; }
  const mode = ($('updSort') && $('updSort').value) || 'upload';
  const ordered = sortRows(rows.map(_updSortable), mode).map((s) => s._u);
  list.innerHTML = '';
  const showHeaders = mode === 'source';
  let lastSrc = null;
  ordered.forEach((u) => {
    if (showHeaders) {
      const src = _sourceKey(u);
      if (src !== lastSrc) {
        const hdr = document.createElement('div');
        hdr.className = 'jobhdr';
        hdr.textContent = `Source: ${u.source_category || u.source_type || 'unknown'}`;
        list.appendChild(hdr);
        lastSrc = src;
      }
    }
    list.appendChild(updateCard(u));
  });
}

function updateCard(u) {
  const el = document.createElement('div');
  el.className = 'draft';
  const t = u.target || {};
  const diff = u.diff || {};
  const fmt = (v) => (Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''));
  const diffHtml = Object.keys(diff).map((f) => {
    const o = fmt(diff[f].old); const n = fmt(diff[f].new);
    return `<div class="muted" style="font-size:.82rem;margin:2px 0"><b>${escapeHtml(f)}</b>: <span style="opacity:.6;text-decoration:line-through">${escapeHtml(o) || '—'}</span> → <span style="color:var(--text,#cbd5e1)">${escapeHtml(n) || '—'}</span></div>`;
  }).join('') || '<div class="muted">No field differences.</div>';
  const isDup = u.kind === 'duplicate';
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(t.post_name || '(unknown post)')}</b>
        <span class="muted"> · ${escapeHtml(t.organisation || '')}${t.level_text ? ' · ' + escapeHtml(t.level_text) : ''}${t.status ? ' · ' + escapeHtml(t.status) : ''}</span>
        <span class="pill ${isDup ? '' : 'high'}">${isDup ? 'possible duplicate' : 'update'}</span>
        <span class="muted"> · from ${escapeHtml(u.source_category || u.source_type || 'ingest')}</span>
      </div>
      <div class="acts">
        <button data-act="gsearch" title="Open a Google search (new tab) for this post + organisation deputation PDF">🌐 Google</button>
        <button data-act="edit">Edit</button>
        ${isDup
          ? '<button class="good" data-act="merge">Merge into existing</button><button data-act="createnew">Create as new</button><button class="bad" data-act="discard">Discard</button>'
          : '<button class="good" data-act="apply">Apply update</button><button class="bad" data-act="discard">Discard</button>'}
      </div>
    </div>
    <div style="margin:6px 0">${diffHtml}</div>
    <div class="editor" style="display:none"></div>`;

  const editor = el.querySelector('.editor');
  let built = false;

  // Lazy editor pre-filled with the record that WOULD be written: for an update
  // that's the live row with the proposed changes applied; for a duplicate it's
  // the incoming candidate. Reuses the Manage/Review field + tiers editor.
  const buildEditor = async () => {
    if (built) return;
    let eff;
    if (isDup) {
      eff = { ...(u.proposed || {}) };
    } else {
      const tr = await api(`/rest/v1/vacancies?id=eq.${u.target_id}&select=*`);
      const [tgt] = await tr.json().catch(() => []);
      eff = { ...(tgt || {}), ...(u.proposed || {}) };
    }
    const de = eff.raw_extraction && eff.raw_extraction.detailed_eligibility;
    editor.innerHTML = `${de ? verbatimHtml(de) : ''}<div class="row">${FIELDS.map(([k, l]) => fieldHtml(k, l, eff)).join('')}${tiersEditorHtml(eff)}</div>`;
    wireTiersEditor(editor);
    built = true;
  };

  // What to write: edited fields (when the editor was opened) layered over the
  // proposed values so provenance (source_type/file/raw_extraction) is kept.
  const effective = () => (built ? { ...(u.proposed || {}), ...collectPatch(editor) } : (u.proposed || {}));

  const del = () => api(`/rest/v1/vacancy_updates?id=eq.${u.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  const patchTarget = async (patch) => {
    const r = await api(`/rest/v1/vacancies?id=eq.${u.target_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()));
  };

  el.querySelector('[data-act="edit"]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await buildEditor(); } finally { btn.disabled = false; }
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    btn.textContent = showing ? 'Edit' : 'Hide';
  };

  // Google search (new tab): [post name] [organisation] "Deputation" "2026" "pdf".
  // Prefers live edited values, then the target row, then the proposed candidate.
  el.querySelector('[data-act="gsearch"]').onclick = () => {
    const live = (k) => { const inp = editor.querySelector(`[data-k="${k}"]`); return inp && inp.value.trim(); };
    const p = u.proposed || {};
    const post = (live('post_name') || t.post_name || p.post_name || '').trim();
    const org = (live('organisation') || t.organisation || p.organisation || '').trim();
    const q = `${post} ${org} "Deputation" "2026" "pdf"`.replace(/\s+/g, ' ').trim();
    window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
  };

  el.querySelector('[data-act="apply"]')?.addEventListener('click', async () => {
    try { await patchTarget(effective()); await del(); el.remove(); toast('✅ Update applied to the live vacancy'); refreshUpdatesCount(); scheduleGc(); }
    catch (e) { toast('Apply failed: ' + e.message); }
  });
  el.querySelector('[data-act="merge"]')?.addEventListener('click', async () => {
    try {
      const sel = ['id', 'status', 'dedup_key', 'match_key', 'source_type', 'source_category', 'source_file_url', ...CONTENT_FIELDS].join(',');
      const tr = await api(`/rest/v1/vacancies?id=eq.${u.target_id}&select=${sel}`);
      const [tgt] = await tr.json();
      if (!tgt) throw new Error('target vacancy not found');
      // When edited, write the edited fields directly; otherwise smart-merge.
      if (built) { await patchTarget(effective()); }
      else { const { patch, changed } = smartMerge(tgt, u.proposed || {}); if (changed) await patchTarget(patch); }
      await del(); el.remove(); toast('✅ Merged into existing vacancy'); refreshUpdatesCount(); scheduleGc();
    } catch (e) { toast('Merge failed: ' + e.message); }
  });
  el.querySelector('[data-act="createnew"]')?.addEventListener('click', async () => {
    try {
      const cand = { ...(u.proposed || {}), ...(built ? collectPatch(editor) : {}) }; delete cand.id;
      const r = await api('/rest/v1/vacancies?on_conflict=dedup_key', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify([cand]),
      });
      if (!r.ok) throw new Error(await r.text());
      const ins = await r.json().catch(() => []);
      await del(); el.remove();
      toast(ins.length ? '✅ Created as a new draft' : 'Already exists — not created');
      refreshUpdatesCount();
    } catch (e) { toast('Create failed: ' + e.message); }
  });
  el.querySelector('[data-act="discard"]')?.addEventListener('click', async () => {
    try { await del(); el.remove(); toast('Discarded'); refreshUpdatesCount(); }
    catch (e) { toast('Discard failed: ' + e.message); }
  });
  return el;
}

