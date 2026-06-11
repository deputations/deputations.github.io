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
function api(path, opts = {}) {
  return fetch(`${SB}${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
}

// Count-only query (no rows transferred) via the content-range header.
async function countOf(pathFilter) {
  try {
    const r = await api(`/rest/v1/${pathFilter}${pathFilter.includes('?') ? '&' : '?'}select=id&limit=1`, { headers: { Prefer: 'count=exact' } });
    return parseInt(((r.headers.get('content-range') || '/0').split('/')[1]) || '0', 10) || 0;
  } catch { return 0; }
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
    toast(`↩ Restored ${ids.length} row(s) to the Review queue`);
    loadDrafts();
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
// The A suffix needs a word boundary so "13 and above" stays 13.
const LEVEL_RX = /(\d+)([\s-]*A\b)?/;
function levelTok(v) {
  const m = String(v ?? '').trim().toUpperCase().match(LEVEL_RX);
  return m ? m[1] + (m[2] ? 'A' : '') : '';
}
function levelRank(v) {
  const m = String(v ?? '').trim().toUpperCase().match(LEVEL_RX);
  return m ? parseInt(m[1], 10) + (m[2] ? 0.5 : 0) : null;
}

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

function fieldHtml(k, lbl, r) {
  const val = r[k] || '';
  if (k === 'organisation_type') return buildSelect(k, lbl, val, ORG_TYPES, (s) => String(s || '').toLowerCase().trim());
  if (k === 'ministry') return buildSelect(k, lbl, val, MINISTRY_NAMES, normMinistry);
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

// Prompt the admin pastes into Gemini Advanced / Claude Pro along with the EN PDF.
const EN_PROMPT = `# Extract & Enrich Government of India DEPUTATION Vacancies — Employment News

Extract deputation vacancies from the attached Employment News PDF using the instructions below. If you have code execution, FIRST extract the page text programmatically (e.g. pdfplumber) before classifying — then follow the two-pass workflow.

## Role & Prime Directive
You are extracting Government of India deputation vacancies from the attached weekly Employment News PDF and enriching each one via web search.
Prime directive: Be exhaustive. Missing a deputation vacancy is the single worst outcome — far worse than including a doubtful one. When in doubt, KEEP it and lower the confidence. Never silently drop a borderline ad.

## Workflow — Two Passes (do NOT interleave)

### Pass 1 — Inventory (no enrichment yet)
Go through the ENTIRE issue, first page to last, in chunks of ~2 pages. Do not skim.
On every page, scan EVERY advertisement, notice and boxed item, including: small/boxed ads, bottom-of-page ads, and "continued on page…" items (follow them to the continuation).
For each ad record: page number, organisation, post name(s), and a one-line keep/drop decision.
When the inventory is complete, RE-SCAN once more for boxed/short ads and continuation pages before moving on.
(Pass 1 is an internal working list only — do not include it in the final answer.)

### Pass 2 — Enrich each KEPT vacancy
For each kept vacancy:
1. Web-search for the official detailed notification on the organisation's official site — prefer .gov.in / .nic.in or the body's official domain.
2. Open it and fill ALL fields from the official source (more authoritative than the abridged ad).
3. Put the real link in official_notification_link — prefer the DIRECT PDF URL of the notification document. DO NOT use a generic homepage, a careers / "current vacancies" listing page, or a third-party job-aggregator link.
4. If no credible official source is found: fill from the ad, leave official_notification_link EMPTY, and lower confidence.

## KEEP / DROP Rule
KEEP if deputation is permitted in ANY form: "deputation"; "deputation/absorption"; "deputation (including short-term contract)" / ISTC; or deputation listed as one of several allowed modes.
DROP only when CLEARLY not deputation: pure direct recruitment; contract/tenure engagement; walk-in; apprenticeship/trainee; absorption-only.
If unsure whether deputation is allowed → KEEP with confidence "low".

## Row Expansion
Output ONE object per (post × location/bench × pay level). Never collapse multiple locations, benches, or levels into a single row.

## Output Format
Return ONLY a JSON array — no prose, no markdown fences. Each object uses EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","detailed_eligibility","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

## Field Rules
- ministry: standard GoI ministry name WITHOUT the "Ministry of" / "Department of" prefix (e.g. "Agriculture and Farmers Welfare", "Home Affairs", "Personnel, Public Grievances and Pensions").
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
- level, req_level1: Pay Matrix level as a string — digits with an optional A suffix where the matrix says so (e.g. "12", "13A"). No other text.
- eligibility_tiers: array of {"level","min_years"} (both number-strings) = the feeder grades the post is open to. Include the analogous tier (the post's own level, "min_years":"0") when "analogous posts" is mentioned, plus each lower grade with its required years. Also still fill req_level1/req_level2 + min_years_experience/min_years_experience2 with the first two tiers. Example for a Level-11 post open to "(i) analogous; (ii) L10+3y; (iii) L8+5y": [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]
- notification_date, last_date_to_apply: ISO yyyy-mm-dd. If a deadline is "within N days of the notification/advertisement", compute last_date_to_apply = notification_date + N days.
- official_notification_link: official sources ONLY — the DIRECT ".pdf" link or the specific circular/notification page that opens this vacancy. NEVER a generic homepage, a careers/"current vacancies" listing, or a third-party aggregator. If unsure a link is real, leave it empty. Never invent a URL.
- detailed_eligibility: COPY VERBATIM the complete eligibility / qualification conditions block exactly as printed in the source for THIS post (feeder grades & pay levels, essential and desirable qualifications, experience, age limit). Do NOT paraphrase, summarise, or reorder. "" if the ad states none.
- functional_area: short summary of duties / job description.
- source_page: the PDF page number of the ad in the issue, as a string (for side-by-side verification).
- confidence: "high" ONLY if details came from the official notification AND post, level, location and a date are all clear; otherwise "medium" or "low".

## Batching
If the issue is large, you may answer in batches by page range; I will paste each batch separately. Keep the SAME schema every time and never skip pages between batches.
Return [] only if the issue genuinely contains no deputation vacancies.`;

// Prompt for a SINGLE official notification / vacancy circular (e.g. NCLT).
const NOTIF_PROMPT = `You are extracting Government of India DEPUTATION vacancies from a SINGLE official notification / vacancy circular PDF. Extract EVERY advertised post — be thorough and read all pages and annexures.

1) Set is_deputation=true for posts open on deputation or deputation/absorption basis (the norm for such circulars). Skip any post that is clearly NOT deputation.
2) Expand to ONE object per (post x location/bench x pay level). Never collapse multiple locations or levels into one row.
3) Fill ALL fields from the document. If the circular states its own reference URL, put it in official_notification_link; otherwise leave it blank (you'll attach the PDF below).
4) You may use web search to confirm the organisation's official website or any field the PDF leaves ambiguous.

Output ONLY a JSON array. Each object must use EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","detailed_eligibility","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

Rules:
- official_notification_link must be the ACTUAL notification document (direct ".pdf" preferred), or the specific circular page — NEVER a generic homepage / listing / aggregator. Leave empty if not found. Never invent a URL.
- Dates ISO yyyy-mm-dd; if "within N days of the notification", compute last_date_to_apply = notification_date + N days.
- "level"/"req_level1" = Pay Matrix level as a string — digits with an optional A suffix where the matrix says so (e.g. "12", "13A"). No other text.
- "eligibility_tiers" = feeder grades as [{"level","min_years"}] (NUMBER strings). Include the analogous tier (post's own level, "0" years) plus each lower grade with its required years; e.g. [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]. Also still fill req_level1/2 + min_years_experience/2 from the first two tiers.
- ministry = standard GoI name WITHOUT the "Ministry of"/"Department of" prefix.
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
- detailed_eligibility = COPY VERBATIM the complete eligibility / qualification conditions block exactly as printed for THIS post (feeder grades & pay levels, qualifications, experience, age limit). Do NOT paraphrase or summarise. "" if none stated.
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

function mapPasted(it, jobId, label, year, i, sourceFileUrl) {
  const lvl = levelTok(it.level || it.req_level1 || '');   // keeps "13A"
  const mc = minCode(it.ministry);
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
    deputation_type: it.deputation_type || '', notification_date: it.notification_date || '', last_date_to_apply: it.last_date_to_apply || '',
    official_notification_link: it.official_notification_link || '', application_form_link: it.application_form_link || '',
    source_website: it.source_website || '', essential_qualification: it.essential_qualification || '',
    eligible_service: it.eligible_service || '', mode_of_application: it.mode_of_application || '',
    functional_area: it.functional_area || '', tags_keywords: it.tags_keywords || '',
    status: 'draft', confidence: (it.confidence || 'medium'), source_type: 'employment_news',
    source_category: label || 'Pasted import', source_file_url: sourceFileUrl || '',
    ingest_job_id: jobId, raw_extraction: it,
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
  'essential_qualification', 'eligible_service', 'mode_of_application', 'tags_keywords',
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
    if (enFile.size > 15 * 1024 * 1024) throw new Error('EN PDF exceeds 15 MB');
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
  const [drafts, updates, flags, closing] = await Promise.all([
    countOf('vacancies?status=eq.draft'),
    countOf('vacancy_updates?status=eq.pending'),
    countOf('vacancy_flags?status=eq.open'),
    countOf(`vacancies?status=eq.approved&last_date_to_apply=gte.${iso(new Date())}&last_date_to_apply=lte.${iso(new Date(Date.now() + 7 * 86400000))}`),
  ]);
  const chip = (n, label, tab, tone) => `<button type="button" class="ov${n && tone ? ' ' + tone : ''}" data-goto="${tab}"><b>${n}</b> ${label}</button>`;
  strip.innerHTML =
    chip(drafts, 'drafts to review', 'review', 'warn') +
    chip(updates, 'pending updates', 'updates', 'warn') +
    chip(flags, 'open flags', 'flags', 'bad') +
    chip(closing, 'live, closing ≤7d', 'manage', '');
  strip.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = () => document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`)?.click();
  });
  // keep the tab badges in sync from the same counts
  if ($('draftCount')) $('draftCount').textContent = drafts ? `(${drafts})` : '';
  if ($('updatesCount')) $('updatesCount').textContent = updates ? `(${updates})` : '';
  if ($('flagCount')) $('flagCount').textContent = flags ? `(${flags})` : '';
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
  RESTORE_LEVEL = ui.draftLevel || '';
  RESTORE_SOURCE = ui.draftSource || '';
  if ($('draftSearch')) $('draftSearch').value = ui.draftSearch || '';
  if ($('mgSearch')) $('mgSearch').value = ui.mgSearch || '';
  if (ui.mgStatus && $('mgStatus')) $('mgStatus').value = ui.mgStatus;
  if (ui.flagStatus && $('flagStatus')) $('flagStatus').value = ui.flagStatus;

  // tabs
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      saveUI({ tab: t });
      $('paneIngest').classList.toggle('hidden', t !== 'ingest');
      $('paneReview').classList.toggle('hidden', t !== 'review');
      $('paneManage').classList.toggle('hidden', t !== 'manage');
      $('paneFlags').classList.toggle('hidden', t !== 'flags');
      $('paneUpdates').classList.toggle('hidden', t !== 'updates');
      // leaving Manage by hand clears any flag-comparison context so it doesn't
      // re-trigger on a later manual visit (the flag's Open button re-sets it)
      if (t !== 'manage') ACTIVE_FLAG = null;
      if (t === 'ingest') loadOverview();
      if (t === 'review') loadDrafts();
      if (t === 'manage') loadManage();
      if (t === 'flags') loadFlags();
      if (t === 'updates') loadUpdates();
    };
  });

  if ($('updRefresh')) $('updRefresh').onclick = loadUpdates;
  if ($('updSort')) $('updSort').onchange = () => { saveUI({ updSort: $('updSort').value }); renderUpdates(); };   // client-side re-sort, no refetch

  $('flagRefresh').onclick = loadFlags;
  $('flagStatus').onchange = () => { saveUI({ flagStatus: $('flagStatus').value }); loadFlags(); };

  $('mgRefresh').onclick = loadManage;
  $('mgStatus').onchange = () => { saveUI({ mgStatus: $('mgStatus').value }); loadManage(); };
  // Populate all three sort dropdowns from the shared option list (keeps them
  // in sync). Review queue defaults to 'source'; Manage/Updates to 'upload'.
  if ($('draftSort')) $('draftSort').innerHTML = sortOptionsHtml(DRAFT_SORT);
  if ($('mgSort')) $('mgSort').innerHTML = sortOptionsHtml(ui.mgSort || 'upload');
  if ($('updSort')) $('updSort').innerHTML = sortOptionsHtml(ui.updSort || 'upload');
  if ($('mgSort')) $('mgSort').onchange = () => { saveUI({ mgSort: $('mgSort').value }); renderManage(); };   // client-side re-sort, no refetch
  let _mgFilterTimer = null;
  $('mgSearch').oninput = () => { clearTimeout(_mgFilterTimer); _mgFilterTimer = setTimeout(() => { saveUI({ mgSearch: $('mgSearch').value }); renderManage(); }, 200); };
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

  const fileToB64 = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

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
        payload.file_base64 = await fileToB64(pickedFile);
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
    const rows = [];
    try {
      for (let from = 0; ; from += 1000) {
        const cr = await api(`/rest/v1/vacancies?status=eq.draft&${filt}&select=id,last_date_to_apply&order=id.asc&limit=1000&offset=${from}`);
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
      const r = await api(`/rest/v1/vacancies?status=eq.draft&${filt}&select=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!r.ok) throw new Error(await r.text());
      const ids = (await r.json().catch(() => [])).map((x) => x.id);
      undoableStatus(ids, `✅ Approved ${ids.length} ${levels.join('/')} draft(s)`);
      loadDrafts();
    } catch (e) { toast('Approve failed: ' + e.message); } finally { b.disabled = false; }
  };

  $('rejectAllBtn').onclick = async () => {
    const n = CURRENT_DRAFT_IDS.length;
    if (!n) return toast('No drafts to reject');
    if (!confirm(`Reject ALL ${n} draft(s)?\nThey move to Manage → Rejected (and you can Undo for a few seconds).`)) return;
    const b = $('rejectAllBtn'); b.disabled = true;
    try {
      const r = await api('/rest/v1/vacancies?status=eq.draft&select=id', {
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
let DRAFT_QUICK = new Set();   // active quick-filter chips (confidence / gaps / deadline)
// one-shot restore for the dynamic Level/Source dropdowns (their options only
// exist after the first loadDrafts) — consumed by populateDraft*Filter below
let RESTORE_LEVEL = '';
let RESTORE_SOURCE = '';

async function loadDrafts() {
  try {
    const r = await api('/rest/v1/vacancies?status=eq.draft&select=*&order=ingest_job_id.asc,vacancy_id.asc');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    CURRENT_DRAFT_IDS = data.map((x) => x.id);   // whole queue — bulk ops use this
    DRAFT_ROWS = data;
    populateDraftSourceFilter();
    DRAFT_PAGE = 1;
    $('draftCount').textContent = data.length ? `(${data.length})` : '';
    populateDraftLevelFilter();
    renderDrafts();
  } catch (e) { toast('Load error: ' + e.message); }
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
        body: JSON.stringify({ status }),
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
        body: JSON.stringify({ ...collectFromCard(el), status }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      el.remove(); ok++; okIds.push(id);
    } catch { fail++; }
  }
  if (bar) bar.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  const msg = `${action === 'approve' ? 'Approved' : 'Rejected'} ${ok}${fail ? `, ${fail} failed` : ''}`;
  if (okIds.length) undoableStatus(okIds, msg); else toast(msg);
  dropFromQueue(okIds);
  updateBulkBar();
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

function renderDraftPager(pages, start, shown, total) {
  const pager = $('draftPager');
  if (!pager) return;
  if (pages <= 1) {
    pager.innerHTML = `<span class="muted">${total} draft(s)</span>`;
    return;
  }
  pager.innerHTML = `
    <button data-pg="prev" ${DRAFT_PAGE <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span class="muted">Page ${DRAFT_PAGE} / ${pages} · showing ${start + 1}-${start + shown} of ${total}</span>
    <button data-pg="next" ${DRAFT_PAGE >= pages ? 'disabled' : ''}>Next ›</button>`;
  pager.querySelector('[data-pg="prev"]')?.addEventListener('click', () => { if (DRAFT_PAGE > 1) { DRAFT_PAGE--; renderDrafts(); window.scrollTo(0, 0); } });
  pager.querySelector('[data-pg="next"]')?.addEventListener('click', () => { if (DRAFT_PAGE < pages) { DRAFT_PAGE++; renderDrafts(); window.scrollTo(0, 0); } });
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
          <span class="muted"> · ${score}% complete</span>
          ${linkDomainBadge(r)}${deadlineBadge(r)}${gapChips(r)}
        </span>
      </div>
      <div class="acts">
        ${(r.source_file_url || r.official_notification_link) ? `<button data-act="source">📄 source${srcPage ? ' p.' + srcPage : ''}</button>` : ''}
        <button data-act="gsearch" title="Open a Google search (new tab) for this post + organisation deputation PDF">🌐 Google</button>
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
    const body = el.dataset.built ? { ...collect(), status: 'approved' } : { status: 'approved' };
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
    else window.open(`https://drive.google.com/file/d/${dm[1]}/view`, '_blank');
    return;
  }
  if (/^https?:\/\//i.test(src)) {
    // external gov links usually block iframing → always open a tab
    window.open(src + (page ? `#page=${page}` : ''), '_blank');
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
  else window.open(url, '_blank');
}


/* ---------------- manage (full CRUD over all rows) ---------------- */
let MANAGE_ROWS = [];

function collectPatch(scopeEl) {
  const patch = {};
  scopeEl.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
  const lvl = levelTok(patch.level);                         // keeps "13A"
  if ('level' in patch) patch.level = lvl;
  patch.level_text = lvl ? `Level-${lvl}` : '';
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

async function loadManage() {
  const status = $('mgStatus').value;
  let url = '/rest/v1/vacancies?select=*&order=created_at.desc&limit=2000';
  if (status !== 'all') url += `&status=eq.${status}`;
  // non-blocking: 📣 badges pop in when the local bridge answers
  refreshWaPending().then(() => { if (WA_PENDING && !$('paneManage').classList.contains('hidden')) renderManage(); });
  try {
    const r = await api(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    MANAGE_ROWS = await r.json();
    renderManage();
  } catch (e) { toast('Load error: ' + e.message); }
}

function renderManage() {
  const q = ($('mgSearch').value || '').toLowerCase().trim();
  const filtered = !q ? MANAGE_ROWS : MANAGE_ROWS.filter((r) => rowMatchesQuery(r, q));
  const mode = ($('mgSort') && $('mgSort').value) || 'upload';
  const rows = sortRows(filtered, mode);
  $('manageCount').textContent = `(${rows.length})`;
  const list = $('manageList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<p class="muted">No matching rows.</p>'; return; }
  const showHeaders = mode === 'source';
  let lastSrc = null;
  rows.forEach((r) => {
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
    list.appendChild(manageCard(r, false));
  });
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
        ${(!isNew && r.status === 'approved' && WA_PENDING && WA_PENDING.has(r.vacancy_id)) ? '<span class="pill" style="color:#34d399;border-color:rgba(52,211,153,.5)" title="Approved but not yet posted to the WhatsApp channel">📣 not posted</span>' : ''}
        ${flagged ? '<span class="pill" style="background:rgba(244,63,94,.15);border-color:rgba(244,63,94,.4);color:#fda4af">⚑ flagged</span>' : ''}
      </div>
      <div class="acts">
        ${(!isNew && (r.source_file_url || r.official_notification_link)) ? '<button data-act="source">📄 source</button>' : ''}
        <button data-act="toggle">${isNew ? 'Hide' : (flagged ? 'Hide' : 'Edit')}</button>
        ${isNew ? '' : '<button class="bad" data-act="del">Delete</button>'}
      </div>
    </div>
    <div class="editor" style="${(isNew || flagged) ? '' : 'display:none'}">
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
      </div>
    </div>`;

  const editor = el.querySelector('.editor');
  el.querySelector('[data-act="toggle"]').onclick = (e) => {
    const showing = editor.style.display !== 'none';
    editor.style.display = showing ? 'none' : 'block';
    e.currentTarget.textContent = showing ? 'Edit' : 'Hide';
  };

  // Flag comparison: spotlight the flagged field's input + wire "Apply suggestion".
  if (flagged) {
    const banner = el.querySelector('[data-flag-banner]');
    const col = banner && banner.dataset.col;
    const targetInput = col ? el.querySelector(`.editor [data-k="${col}"]`) : null;
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
    // scroll the flagged card into view once rendered
    setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }
  el.querySelector('[data-act="cancel"]').onclick = () => {
    if (isNew) { el.remove(); return; }
    editor.style.display = 'none';
    el.querySelector('[data-act="toggle"]').textContent = 'Edit';
  };

  el.querySelector('[data-act="save"]').onclick = async () => {
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
  };

  const delBtn = el.querySelector('[data-act="del"]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`Delete "${r.post_name}"? This cannot be undone.`)) return;
    try {
      const res = await api(`/rest/v1/vacancies?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      el.remove(); toast('Deleted'); scheduleGc();
    } catch (e) { toast('Delete failed: ' + e.message); }
  };

  wireTiersEditor(el);

  const srcBtn = el.querySelector('[data-act="source"]');
  if (srcBtn) srcBtn.onclick = () => openSource(r, String((r.raw_extraction && r.raw_extraction.source_page) || '').replace(/\D/g, ''));
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
  try {
    const r = await api('/rest/v1/vacancy_flags?status=eq.open&select=id');
    if (!r.ok) return;
    const rows = await r.json();
    const badge = $('flagCount');
    if (badge) badge.textContent = rows.length ? `(${rows.length})` : '';
  } catch { /* */ }
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
  try {
    const r = await api('/rest/v1/vacancy_updates?status=eq.pending&select=id');
    if (!r.ok) return;
    const n = (await r.json()).length;
    const badge = $('updatesCount'); if (badge) badge.textContent = n ? `(${n})` : '';
  } catch { /* */ }
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
