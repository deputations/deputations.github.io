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
  ['level', 'Pay level'], ['location_city', 'City'], ['location_state', 'State'],
  ['no_of_posts', 'No. of posts'], ['req_level1', 'Eligible level (from)'],
  ['req_level2', 'Eligible level (to)'], ['notification_date', 'Notification date'],
  ['last_date_to_apply', 'Last date'], ['essential_qualification', 'Essential qualification'],
  ['official_notification_link', 'Official link'],
];

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
    const isUrl = $('srcType').value === 'url';
    $('urlBlock').classList.toggle('hidden', !isUrl);
    $('fileBlock').classList.toggle('hidden', isUrl);
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
}

/* ---------------- review queue ---------------- */
async function loadDrafts() {
  try {
    const r = await api('/rest/v1/vacancies?status=eq.draft&select=*&order=ingest_job_id.asc,vacancy_id.asc');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
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
  el.innerHTML = `
    <div class="head">
      <div>
        <b>${escapeHtml(r.post_name || '(untitled)')}</b>
        <span class="pill ${conf}">${conf}</span>
        <span class="muted"> · ${score}% complete</span>
      </div>
      <div class="acts">
        ${r.source_file_url ? `<a class="muted" href="#" data-src="${escapeHtml(r.source_file_url)}">source</a>` : ''}
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
  const srcLink = el.querySelector('[data-src]');
  if (srcLink) srcLink.onclick = async (e) => {
    e.preventDefault();
    try {
      const r2 = await api(`/storage/v1/object/sign/sources/${encodeURIComponent(srcLink.dataset.src)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 120 }),
      });
      const d = await r2.json();
      if (d.signedURL) window.open(SB + '/storage/v1' + d.signedURL, '_blank');
    } catch { toast('Could not open source'); }
  };
  return el;
}

function bumpCount(d) {
  const cur = parseInt(($('draftCount').textContent.match(/\d+/) || [0])[0], 10) + d;
  $('draftCount').textContent = cur > 0 ? `(${cur})` : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
