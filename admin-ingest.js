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
const nowSec = () => Math.floor(Date.now() / 1000);

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
function tiersFor(obj) {
  if (window.DepEnrich && window.DepEnrich.parseTiers) return window.DepEnrich.parseTiers(obj);
  const num = (v) => { const m = String(v ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
  const out = [];
  const l1 = num(obj && obj.req_level1); if (l1 !== null) out.push({ level: l1, min_years: num(obj && obj.min_years_experience) || 0 });
  const l2 = num(obj && obj.req_level2); if (l2 !== null) out.push({ level: l2, min_years: num(obj && obj.min_years_experience2) || 0 });
  return out;
}

function tierRowHtml(t) {
  return `<div class="tier-row" style="display:flex;gap:6px;margin-bottom:5px;align-items:center;">
    <input class="tier-level" type="number" min="1" max="18" placeholder="Level" value="${t ? escapeHtml(t.level) : ''}" style="width:90px;flex:0 0 auto">
    <span class="muted" style="font-size:.8rem">with</span>
    <input class="tier-years" type="number" min="0" max="40" placeholder="Years" value="${t ? escapeHtml(t.min_years) : ''}" style="width:90px;flex:0 0 auto">
    <span class="muted" style="font-size:.8rem">yrs</span>
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

// Read tier rows -> clean [{level,min_years}] (deduped, sorted desc). Returns
// [] when the editor is present but empty, or null when there's no editor.
function collectTiers(scopeEl) {
  const ed = scopeEl.querySelector('[data-tiers]');
  if (!ed) return null;
  const tiers = [];
  ed.querySelectorAll('.tier-row').forEach((row) => {
    const lvl = parseInt(String(row.querySelector('.tier-level').value || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(lvl)) return;
    const yrs = parseInt(String(row.querySelector('.tier-years').value || '').replace(/\D/g, ''), 10) || 0;
    tiers.push({ level: lvl, min_years: yrs });
  });
  const byLevel = new Map();
  tiers.forEach((t) => { const p = byLevel.get(t.level); if (!p || t.min_years < p.min_years) byLevel.set(t.level, t); });
  return [...byLevel.values()].sort((a, b) => b.level - a.level);
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

function fieldHtml(k, lbl, r) {
  const val = r[k] || '';
  if (k === 'organisation_type') return buildSelect(k, lbl, val, ORG_TYPES, (s) => String(s || '').toLowerCase().trim());
  if (k === 'ministry') return buildSelect(k, lbl, val, MINISTRY_NAMES, normMinistry);
  return `<div><label>${lbl}</label><input data-k="${escapeHtml(k)}" value="${escapeHtml(val)}" /></div>`;
}

// Prompt the admin pastes into Gemini Advanced / Claude Pro along with the EN PDF.
const EN_PROMPT = `You are extracting Government of India DEPUTATION vacancies from the attached weekly "Employment News" newspaper PDF, and ENRICHING each using web search. BE EXHAUSTIVE — missing a deputation vacancy is the worst possible outcome, far worse than including a doubtful one.

WORK METHODICALLY — DO NOT SKIM:
STEP 1 — Go through the ENTIRE issue page by page, first page to the very last. Process it in CHUNKS of about 8 pages so nothing is skipped. On every page scan EVERY advertisement, notice and boxed item — small/boxed ads, bottom-of-page ads, and "continued on page…" items included. Track page numbers.
STEP 2 — For each advertisement, decide the basis of appointment. KEEP it if deputation is allowed in ANY form — "deputation", "deputation/absorption", "deputation (including short-term contract)/ISTC", or where deputation is one of several allowed modes. EXCLUDE only when CLEARLY not deputation (pure direct recruitment, contract/tenure engagement, walk-in, apprenticeship/trainee, or absorption-only). If UNSURE whether a post permits deputation, INCLUDE it with confidence "low" rather than dropping it.
STEP 3 — For EACH kept vacancy, SEARCH THE WEB for the OFFICIAL detailed notification on the organisation's official site (prefer .gov.in / .nic.in or the body's official domain). Open it and fill ALL fields from it (more authoritative than the abridged ad). For official_notification_link, put the DIRECT URL of the notification DOCUMENT itself — ideally the ".pdf" link, or the specific notification/circular page that opens that vacancy. DO NOT use a generic homepage, a careers/"current vacancies" listing page, or a third-party job-aggregator link; if you can only find those, leave official_notification_link EMPTY and lower confidence.
STEP 4 — Expand to ONE object per (post x location/bench x pay level). Never collapse multiple locations or levels into one row.
STEP 5 — BEFORE finalising, re-check: every page covered first to last? boxed/short ads and continuation pages re-scanned? Add anything missed.

Output ONLY a JSON array — no prose, no markdown code fences. Each object must use EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

Rules:
- official_notification_link must be the ACTUAL notification document — the direct ".pdf" link, or the specific circular/notification page that opens this vacancy. NEVER a generic homepage, a careers/"current vacancies" listing, or a third-party aggregator. If you don't find the real document, leave it empty. Never invent a URL.
- Dates in ISO yyyy-mm-dd. If a deadline is "within N days of the notification/advertisement", compute last_date_to_apply = notification_date + N days.
- "level" and "req_level1" = Pay Matrix level NUMBER only, as a string (e.g. "12").
- "eligibility_tiers" = the feeder grades the post is open to, as an array of {"level","min_years"} (both NUMBER strings). Include the analogous tier (the post's own level, "min_years":"0") when "analogous posts" is mentioned, plus each lower grade with its required years. Example for a Level-11 post open to "(i) analogous; (ii) L10+3y; (iii) L8+5y": [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]. Also still fill req_level1/req_level2 + min_years_experience/min_years_experience2 with the first two tiers.
- ministry: the standard GoI ministry name WITHOUT the "Ministry of"/"Department of" prefix (e.g. "Agriculture and Farmers Welfare", "Home Affairs", "Personnel, Public Grievances and Pensions").
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
- functional_area: a short summary of duties / job description.
- source_page: the PDF page number of the advertisement in the Employment News issue, as a string (for side-by-side verification).
- confidence: "high" only if details came from the official notification and post, level, location AND a date are all clear; otherwise "medium" or "low".
- If the issue is large, you may answer in BATCHES by page range; I will paste each batch separately. Keep the SAME schema every time and never skip pages between batches.
- Return [] only if the issue genuinely contains no deputation vacancies.`;

// Prompt for a SINGLE official notification / vacancy circular (e.g. NCLT).
const NOTIF_PROMPT = `You are extracting Government of India DEPUTATION vacancies from a SINGLE official notification / vacancy circular PDF. Extract EVERY advertised post — be thorough and read all pages and annexures.

1) Set is_deputation=true for posts open on deputation or deputation/absorption basis (the norm for such circulars). Skip any post that is clearly NOT deputation.
2) Expand to ONE object per (post x location/bench x pay level). Never collapse multiple locations or levels into one row.
3) Fill ALL fields from the document. If the circular states its own reference URL, put it in official_notification_link; otherwise leave it blank (you'll attach the PDF below).
4) You may use web search to confirm the organisation's official website or any field the PDF leaves ambiguous.

Output ONLY a JSON array. Each object must use EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

Rules:
- official_notification_link must be the ACTUAL notification document (direct ".pdf" preferred), or the specific circular page — NEVER a generic homepage / listing / aggregator. Leave empty if not found. Never invent a URL.
- Dates ISO yyyy-mm-dd; if "within N days of the notification", compute last_date_to_apply = notification_date + N days.
- "level"/"req_level1" = Pay Matrix level NUMBER only (e.g. "12").
- "eligibility_tiers" = feeder grades as [{"level","min_years"}] (NUMBER strings). Include the analogous tier (post's own level, "0" years) plus each lower grade with its required years; e.g. [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]. Also still fill req_level1/2 + min_years_experience/2 from the first two tiers.
- ministry = standard GoI name WITHOUT the "Ministry of"/"Department of" prefix.
- organisation_type: EXACTLY one of — Ministry; Department; Attached and Subordinate Offices; Constitutional Bodies; Statutory Bodies; Autonomous Bodies; Central Public Sector Enterprises (CPSEs).
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
  const lvl = String(it.level || it.req_level1 || '').replace(/\D/g, '');
  const mc = minCode(it.ministry);
  return {
    vacancy_id: `${mc}-${year}-L${lvl || 'X'}-${String(i + 1).padStart(3, '0')}`,
    ministry: it.ministry || '', min_code: mc, department: it.department || '', organisation: it.organisation || '',
    organisation_type: it.organisation_type || '', post_name: it.post_name || '',
    level: lvl, level_text: lvl ? `Level-${lvl}` : '',
    location_city: it.location_city || '', location_state: it.location_state || '',
    req_level1: String(it.req_level1 || lvl || '').replace(/\D/g, ''), req_level2: String(it.req_level2 || '').replace(/\D/g, ''),
    min_years_experience: String(it.min_years_experience || ''), min_years_experience2: String(it.min_years_experience2 || ''),
    eligibility_tiers: tiersFor(it),
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

const dedupKey = (o) => [o.post_name, o.organisation, o.location_city,
  String(o.level || o.req_level1 || '').replace(/\D/g, ''), (o.notification_date || '')]
  .map((x) => String(x || '').toLowerCase().trim()).join('|');

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
  // on_conflict=dedup_key + ignore-duplicates -> rows already stored are skipped;
  // return=representation lets us count what actually landed.
  const ins = await api('/rest/v1/vacancies?on_conflict=dedup_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error('Insert failed: ' + (await ins.text()));
  const insertedRows = await ins.json().catch(() => []);
  const inserted = Array.isArray(insertedRows) ? insertedRows.length : rows.length;
  const skipped = before - inserted;
  await api(`/rest/v1/ingest_jobs?id=eq.${job.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ rows_extracted: inserted }),
  }).catch(() => {});
  st.textContent = `✅ Imported ${inserted} row(s)` + (skipped > 0 ? ` (skipped ${skipped} duplicate(s))` : '') + ' to the review queue.';
  toast(`Imported ${inserted} draft(s)` + (skipped > 0 ? `, skipped ${skipped} dup(s)` : ''));
  $('pasteJson').value = '';
  $('enPdf').value = '';
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
  loadDrafts();
  refreshFlagCount();
}

/* ---------------- app wiring ---------------- */
function wireApp() {
  // tabs
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      $('paneIngest').classList.toggle('hidden', t !== 'ingest');
      $('paneReview').classList.toggle('hidden', t !== 'review');
      $('paneManage').classList.toggle('hidden', t !== 'manage');
      $('paneFlags').classList.toggle('hidden', t !== 'flags');
      if (t === 'review') loadDrafts();
      if (t === 'manage') loadManage();
      if (t === 'flags') loadFlags();
    };
  });

  $('flagRefresh').onclick = loadFlags;
  $('flagStatus').onchange = loadFlags;

  $('mgRefresh').onclick = loadManage;
  $('mgStatus').onclick = () => {};
  $('mgStatus').onchange = loadManage;
  let _mgFilterTimer = null;
  $('mgSearch').oninput = () => { clearTimeout(_mgFilterTimer); _mgFilterTimer = setTimeout(renderManage, 200); };
  $('mgAddBtn').onclick = () => {
    const blank = { id: null, status: 'approved', source_type: 'manual' };
    $('manageList').prepend(manageCard(blank, true));
  };

  // source type toggle
  $('srcType').onchange = () => {
    const t = $('srcType').value;
    $('urlBlock').classList.toggle('hidden', t !== 'url');
    $('pasteBlock').classList.toggle('hidden', t !== 'paste');
    $('fileBlock').classList.toggle('hidden', t === 'url' || t === 'paste');
    $('ingestBtn').textContent = t === 'paste' ? 'Import rows' : 'Extract vacancies';
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
      st.textContent = `✅ Extracted ${data.rows_extracted} vacanc${data.rows_extracted === 1 ? 'y' : 'ies'} from ${data.candidates} candidate(s)` +
        (data.duplicates_skipped ? `, skipped ${data.duplicates_skipped} duplicate(s)` : '') +
        ((data.providers && data.providers.length) ? ` · via ${data.providers.join(', ')}` : '') + '.';
      toast(`Added ${data.rows_extracted} draft(s) to the review queue`);
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

  $('viewerClose').onclick = () => { $('viewerFrame').src = 'about:blank'; $('viewerPane').style.display = 'none'; };

  $('approveAllBtn').onclick = async () => {
    const levels = [];
    if ($('cfHigh').checked) levels.push('high');
    if ($('cfMedium').checked) levels.push('medium');
    if ($('cfLow').checked) levels.push('low');
    if (!levels.length) return toast('Tick at least one confidence level');
    const filt = `confidence=in.(${levels.join(',')})`;
    // count how many match
    let count = 0;
    try {
      const cr = await api(`/rest/v1/vacancies?status=eq.draft&${filt}&select=id`, { headers: { Prefer: 'count=exact' } });
      count = parseInt(((cr.headers.get('content-range') || '/0').split('/')[1]) || '0', 10) || 0;
    } catch { /* */ }
    if (!count) return toast('No drafts match the ticked confidence');
    if (!confirm(`Approve & publish ${count} draft(s) with confidence: ${levels.join(', ')}?\n(Unsaved inline edits aren't included — Save those first if needed.)`)) return;
    const b = $('approveAllBtn'); b.disabled = true;
    try {
      const r = await api(`/rest/v1/vacancies?status=eq.draft&${filt}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast(`✅ Approved ${count} ${levels.join('/')} draft(s)`); loadDrafts(); scheduleGc();
    } catch (e) { toast('Approve failed: ' + e.message); } finally { b.disabled = false; }
  };

  $('rejectAllBtn').onclick = async () => {
    const n = CURRENT_DRAFT_IDS.length;
    if (!n) return toast('No drafts to reject');
    if (!confirm(`Delete ALL ${n} draft(s)? This cannot be undone.`)) return;
    const b = $('rejectAllBtn'); b.disabled = true;
    try {
      const r = await api('/rest/v1/vacancies?status=eq.draft', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast(`Deleted ${n} draft(s)`); loadDrafts(); scheduleGc();
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

/* ---------------- review queue ---------------- */
async function loadDrafts() {
  try {
    const r = await api('/rest/v1/vacancies?status=eq.draft&select=*&order=ingest_job_id.asc,vacancy_id.asc');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    CURRENT_DRAFT_IDS = data.map((x) => x.id);
    $('draftCount').textContent = data.length ? `(${data.length})` : '';
    renderDrafts(data);
  } catch (e) { toast('Load error: ' + e.message); }
}

function renderDrafts(rows) {
  const list = $('draftList');
  if (!rows.length) { list.innerHTML = '<p class="muted">No drafts awaiting review. 🎉</p>'; return; }
  const groups = {};
  rows.forEach((r) => { (groups[r.ingest_job_id || 'none'] ||= []).push(r); });
  list.innerHTML = '';
  Object.values(groups).forEach((items) => {
    const hdr = document.createElement('div');
    hdr.className = 'jobhdr';
    hdr.textContent = `Source: ${items[0].source_category || items[0].source_type || 'unknown'} · ${items.length} row(s)`;
    list.appendChild(hdr);
    items.forEach((r) => list.appendChild(draftCard(r)));
  });
}

function draftCard(r) {
  const el = document.createElement('div');
  el.className = 'draft';
  const conf = (r.confidence || 'medium').toLowerCase();
  const score = window.DepEnrich ? window.DepEnrich.enrichRecord(r).completeness_score : '';
  const srcPage = String((r.raw_extraction && r.raw_extraction.source_page) || '').replace(/\D/g, '');
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(r.post_name || '(untitled)')}</b>
        <span class="pill ${conf}">${conf}</span>
        <span class="muted"> · ${score}% complete</span>
      </div>
      <div class="acts">
        ${(r.source_file_url || r.official_notification_link) ? `<button data-act="source">📄 source${srcPage ? ' p.' + srcPage : ''}</button>` : ''}
        <button data-act="enrich" title="Find the official notification PDF and fill blank fields">🔎 Official PDF</button>
        <button class="good" data-act="approve">Approve</button>
        <button class="bad" data-act="reject">Reject</button>
      </div>
    </div>
    <div class="row">
      ${FIELDS.map(([k, lbl]) => fieldHtml(k, lbl, r)).join('')}
      ${tiersEditorHtml(r)}
    </div>`;

  wireTiersEditor(el);

  const collect = () => {
    const patch = {};
    el.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
    const lvl = (patch.level || '').replace(/\D/g, '');
    patch.level_text = lvl ? `Level-${lvl}` : '';
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

  el.querySelector('[data-act="approve"]').onclick = async () => {
    try { await patchRow({ ...collect(), status: 'approved' }); el.remove(); toast('✅ Approved & published'); bumpCount(-1); scheduleGc(); }
    catch (e) { toast('Approve failed: ' + e.message); }
  };
  el.querySelector('[data-act="reject"]').onclick = async () => {
    try {
      // delete outright (not status='rejected') so its dedup_key is freed and the
      // same vacancy can be re-added later if it genuinely re-appears
      const r2 = await api(`/rest/v1/vacancies?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r2.ok) throw new Error('HTTP ' + r2.status);
      el.remove(); toast('Rejected & removed'); bumpCount(-1); scheduleGc();
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

function bumpCount(d) {
  const cur = parseInt(($('draftCount').textContent.match(/\d+/) || [0])[0], 10) + d;
  $('draftCount').textContent = cur > 0 ? `(${cur})` : '';
}

/* ---------------- manage (full CRUD over all rows) ---------------- */
let MANAGE_ROWS = [];

function collectPatch(scopeEl) {
  const patch = {};
  scopeEl.querySelectorAll('[data-k]').forEach((inp) => { patch[inp.dataset.k] = (inp.value || '').trim(); });
  const lvl = (patch.level || '').replace(/\D/g, '');
  patch.level_text = lvl ? `Level-${lvl}` : '';
  if (patch.ministry) patch.min_code = MIN_CODE_BY_NAME[patch.ministry] || minCode(patch.ministry);
  applyTiersToPatch(patch, scopeEl);
  return patch;
}

async function loadManage() {
  const status = $('mgStatus').value;
  let url = '/rest/v1/vacancies?select=*&order=created_at.desc&limit=2000';
  if (status !== 'all') url += `&status=eq.${status}`;
  try {
    const r = await api(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    MANAGE_ROWS = await r.json();
    renderManage();
  } catch (e) { toast('Load error: ' + e.message); }
}

function renderManage() {
  const q = ($('mgSearch').value || '').toLowerCase().trim();
  const rows = !q ? MANAGE_ROWS : MANAGE_ROWS.filter((r) =>
    [r.post_name, r.organisation, r.ministry, r.location_city, r.vacancy_id]
      .some((f) => String(f || '').toLowerCase().includes(q)));
  $('manageCount').textContent = `(${rows.length})`;
  const list = $('manageList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<p class="muted">No matching rows.</p>'; return; }
  rows.forEach((r) => list.appendChild(manageCard(r, false)));
}

function manageCard(r, isNew) {
  const el = document.createElement('div');
  el.className = 'draft';
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(isNew ? 'New vacancy' : (r.post_name || '(untitled)'))}</b>
        ${isNew ? '' : `<span class="muted"> · ${escapeHtml(r.organisation || '')}${r.level ? ' · L' + escapeHtml(r.level) : ''}${r.location_city ? ' · ' + escapeHtml(r.location_city) : ''}</span>`}
        <span class="pill">${escapeHtml(isNew ? 'new' : (r.status || ''))}</span>
      </div>
      <div class="acts">
        ${(!isNew && (r.source_file_url || r.official_notification_link)) ? '<button data-act="source">📄 source</button>' : ''}
        <button data-act="toggle">${isNew ? 'Hide' : 'Edit'}</button>
        ${isNew ? '' : '<button class="bad" data-act="del">Delete</button>'}
      </div>
    </div>
    <div class="editor" style="${isNew ? '' : 'display:none'}">
      <div class="row">
        ${FIELDS.map(([k, lbl]) => fieldHtml(k, lbl, r)).join('')}
        ${tiersEditorHtml(r)}
        <div><label>Status</label>
          <select data-k="status">
            <option value="approved"${r.status === 'approved' ? ' selected' : ''}>approved (live)</option>
            <option value="draft"${r.status === 'draft' ? ' selected' : ''}>draft</option>
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
        patch.source_type = 'manual';
        const res = await api('/rest/v1/vacancies?on_conflict=dedup_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=ignore-duplicates' },
          body: JSON.stringify([patch]),
        });
        if (!res.ok) throw new Error(await res.text());
        const ins = await res.json();
        if (!ins.length) return toast('That vacancy already exists (duplicate) — not added');
        toast('✅ Added'); el.remove(); loadManage();
      } else {
        const res = await api(`/rest/v1/vacancies?id=eq.${r.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(/duplicate|unique/i.test(t) ? 'Would duplicate an existing entry' : t);
        }
        toast('✅ Saved'); loadManage();
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
  const sv = f.suggested_value || '';
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(FLAG_ISSUE_LABEL[f.issue_type] || f.issue_type)}</b>
        <span class="muted"> · ${escapeHtml(FLAG_FIELD_LABEL[f.field] || f.field || 'whole')} · ${escapeHtml(f.vacancy_id || '')}</span>
        <span class="pill">${escapeHtml(f.status || 'open')}</span>
        <span class="muted"> · 👍 ${Number(f.endorsements) || 0} · ${escapeHtml(when)}</span>
      </div>
      <div class="acts">
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
    // jump to Manage, pre-filtered to this vacancy so the admin can fix it
    document.querySelector('[data-tab="manage"]').click();
    if ($('mgStatus')) $('mgStatus').value = 'all';
    if ($('mgSearch')) $('mgSearch').value = f.vacancy_id || '';
    loadManage();
  };
  el.querySelector('[data-act="valid"]')?.addEventListener('click', () => setStatus('approved'));
  el.querySelector('[data-act="dismiss"]')?.addEventListener('click', () => setStatus('dismissed'));
  el.querySelector('[data-act="reopen"]')?.addEventListener('click', () => setStatus('open'));
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
