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
  ['req_level1', 'Eligible level (from)'], ['req_level2', 'Eligible level (to)'],
  ['min_years_experience', 'Min experience (yrs)'], ['deputation_period_years', 'Deputation period (yrs)'],
  ['notification_date', 'Notification date'], ['last_date_to_apply', 'Last date'],
  ['essential_qualification', 'Essential qualification'], ['eligible_service', 'Eligible service'],
  ['functional_area', 'Functional area / duties'], ['tags_keywords', 'Tags / keywords'],
  ['mode_of_application', 'Mode of application'], ['official_notification_link', 'Official link'],
  ['application_form_link', 'Application form link'], ['source_website', 'Source website'],
];

// Prompt the admin pastes into Gemini Advanced / Claude Pro along with the EN PDF.
const EN_PROMPT = `You are extracting Government of India DEPUTATION vacancies from the attached weekly "Employment News" newspaper PDF, and ENRICHING each using web search. BE EXHAUSTIVE — missing a deputation vacancy is the worst possible outcome, far worse than including a doubtful one.

WORK METHODICALLY — DO NOT SKIM:
STEP 1 — Go through the ENTIRE issue page by page, first page to the very last. Process it in CHUNKS of about 8 pages so nothing is skipped. On every page scan EVERY advertisement, notice and boxed item — small/boxed ads, bottom-of-page ads, and "continued on page…" items included. Track page numbers.
STEP 2 — For each advertisement, decide the basis of appointment. KEEP it if deputation is allowed in ANY form — "deputation", "deputation/absorption", "deputation (including short-term contract)/ISTC", or where deputation is one of several allowed modes. EXCLUDE only when CLEARLY not deputation (pure direct recruitment, contract/tenure engagement, walk-in, apprenticeship/trainee, or absorption-only). If UNSURE whether a post permits deputation, INCLUDE it with confidence "low" rather than dropping it.
STEP 3 — For EACH kept vacancy, SEARCH THE WEB for the OFFICIAL detailed notification on the organisation's official site (prefer .gov.in / .nic.in or the body's official domain). Open it and fill ALL fields from it (more authoritative than the abridged ad). Put the real link in official_notification_link (prefer the direct PDF URL). If no credible official source is found, fill from the ad, leave official_notification_link empty, and lower confidence.
STEP 4 — Expand to ONE object per (post x location/bench x pay level). Never collapse multiple locations or levels into one row.
STEP 5 — BEFORE finalising, re-check: every page covered first to last? boxed/short ads and continuation pages re-scanned? Add anything missed.

Output ONLY a JSON array — no prose, no markdown code fences. Each object must use EXACTLY these keys (use "" when unknown):
{"ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}

Rules:
- Only use official sources for links; never invent a URL. If unsure a link is real, leave it empty.
- Dates in ISO yyyy-mm-dd. If a deadline is "within N days of the notification/advertisement", compute last_date_to_apply = notification_date + N days.
- "level" and "req_level1" = Pay Matrix level NUMBER only, as a string (e.g. "12").
- organisation_type: one of Ministry/Department, Attached Office, Subordinate Office, PSU/CPSE, Autonomous Body, Statutory Body, Tribunal/Commission, Bank/Financial Institution.
- functional_area: a short summary of duties / job description.
- source_page: the PDF page number of the advertisement in the Employment News issue, as a string (for side-by-side verification).
- confidence: "high" only if details came from the official notification and post, level, location AND a date are all clear; otherwise "medium" or "low".
- If the issue is large, you may answer in BATCHES by page range; I will paste each batch separately. Keep the SAME schema every time and never skip pages between batches.
- Return [] only if the issue genuinely contains no deputation vacancies.`;

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
  String(o.level || o.req_level1 || '').replace(/\D/g, '')]
  .map((x) => String(x || '').toLowerCase().trim()).join('|');

async function importPasted(label, st) {
  const raw = $('pasteJson').value.trim();
  if (!raw) throw new Error('Paste the JSON array first');
  let items = parsePastedArray(raw);
  if (!items) throw new Error('Could not find a JSON array — copy the model\'s [ ... ] output (prose/code-fences are OK).');
  items = items.filter((x) => x && x.post_name);
  if (!items.length) throw new Error('No rows with a post_name found.');

  st.innerHTML = '<span class="spinner"></span> Importing…';

  // de-duplicate against drafts already in the queue (so chunked batches accumulate cleanly)
  let existing = [];
  try {
    const exRes = await api('/rest/v1/vacancies?status=eq.draft&select=post_name,organisation,location_city,level');
    if (exRes.ok) existing = await exRes.json();
  } catch { /* best effort */ }
  const seen = new Set(existing.map(dedupKey));
  const before = items.length;
  items = items.filter((it) => { const k = dedupKey(it); if (seen.has(k)) return false; seen.add(k); return true; });
  const skipped = before - items.length;
  if (!items.length) { st.textContent = `All ${before} row(s) were already in the queue (skipped duplicates).`; return; }
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
  const ins = await api('/rest/v1/vacancies', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error('Insert failed: ' + (await ins.text()));
  st.textContent = `✅ Imported ${rows.length} row(s)` + (skipped ? ` (skipped ${skipped} duplicate(s))` : '') + ' to the review queue.';
  toast(`Imported ${rows.length} draft(s)` + (skipped ? `, skipped ${skipped} dup(s)` : ''));
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
      if (t === 'review') loadDrafts();
    };
  });

  // source type toggle
  $('srcType').onchange = () => {
    const t = $('srcType').value;
    $('urlBlock').classList.toggle('hidden', t !== 'url');
    $('pasteBlock').classList.toggle('hidden', t !== 'paste');
    $('fileBlock').classList.toggle('hidden', t === 'url' || t === 'paste');
    $('ingestBtn').textContent = t === 'paste' ? 'Import rows' : 'Extract vacancies';
  };

  $('copyPromptBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(EN_PROMPT); toast('Prompt copied — paste it into Gemini/Claude with the EN PDF'); }
    catch { $('pasteJson').value = EN_PROMPT; toast('Copy blocked — prompt placed in the box; cut it from there'); }
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
      st.textContent = `✅ Extracted ${data.rows_extracted} vacanc${data.rows_extracted === 1 ? 'y' : 'ies'} from ${data.candidates} candidate(s).`;
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
        ${r.source_file_url ? `<button data-act="source">📄 source${srcPage ? ' p.' + srcPage : ''}</button>` : ''}
        <button data-act="enrich" title="Find the official notification PDF and fill blank fields">🔎 Official PDF</button>
        <button class="good" data-act="approve">Approve</button>
        <button class="bad" data-act="reject">Reject</button>
      </div>
    </div>
    <div class="row">
      ${FIELDS.map(([k, lbl]) => `
        <div><label>${lbl}</label><input data-k="${k}" value="${escapeHtml(r[k] || '')}" /></div>`).join('')}
    </div>`;

  const collect = () => {
    const patch = {};
    el.querySelectorAll('input[data-k]').forEach((inp) => { patch[inp.dataset.k] = inp.value.trim(); });
    const lvl = (patch.level || '').replace(/\D/g, '');
    patch.level_text = lvl ? `Level-${lvl}` : '';
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
    try { await patchRow({ ...collect(), status: 'approved' }); el.remove(); toast('✅ Approved & published'); bumpCount(-1); }
    catch (e) { toast('Approve failed: ' + e.message); }
  };
  el.querySelector('[data-act="reject"]').onclick = async () => {
    try { await patchRow({ status: 'rejected' }); el.remove(); toast('Rejected'); bumpCount(-1); }
    catch (e) { toast('Reject failed: ' + e.message); }
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
  let url = '';
  const src = r.source_file_url || '';
  if (/^https?:\/\//i.test(src)) {
    // external official link — gov sites usually block iframing, so open a tab
    window.open(src + (page ? `#page=${page}` : ''), '_blank');
    return;
  }
  try {
    const res = await api(`/storage/v1/object/sign/sources/${encodeURIComponent(src)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }),
    });
    const d = await res.json();
    if (d.signedURL) url = SB + '/storage/v1' + d.signedURL;
  } catch { /* */ }
  if (!url) return toast('Could not open source');
  if (page) url += `#page=${page}`;
  $('viewerLabel').textContent = (r.post_name || 'Source') + (page ? ` — p.${page}` : '');
  $('viewerFrame').src = url;
  $('viewerPane').style.display = 'block';
}

function bumpCount(d) {
  const cur = parseInt(($('draftCount').textContent.match(/\d+/) || [0])[0], 10) + d;
  $('draftCount').textContent = cur > 0 ? `(${cur})` : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
