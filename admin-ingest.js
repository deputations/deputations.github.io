/* admin-ingest.js — gated ingest + review console.
 * Admin signs in with a magic link; uploads a PDF / URL; the `extract` Edge
 * Function runs Gemini and writes DRAFT rows; admin reviews, edits, approves.
 * Only emails present in the Supabase `admins` table can do anything (RLS).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500);
};

// Editable fields shown on each draft card (key -> label).
const FIELDS = [
  ['post_name', 'Post name'],
  ['ministry', 'Ministry'],
  ['organisation', 'Organisation'],
  ['level', 'Pay level'],
  ['location_city', 'City'],
  ['location_state', 'State'],
  ['no_of_posts', 'No. of posts'],
  ['req_level1', 'Eligible level (from)'],
  ['req_level2', 'Eligible level (to)'],
  ['notification_date', 'Notification date'],
  ['last_date_to_apply', 'Last date'],
  ['essential_qualification', 'Essential qualification'],
  ['official_notification_link', 'Official link'],
];

if (!window.SUPABASE_READY || !window.SUPABASE_READY()) {
  $('setupCard').classList.remove('hidden');
} else {
  boot();
}

function boot() {
  const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // ---------- auth ----------
  async function refreshAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    const email = session.user.email;
    // confirm admin (RLS lets a user read only their own admins row)
    const { data: adminRow } = await sb.from('admins').select('email').ilike('email', email).maybeSingle();
    if (!adminRow) {
      $('who').textContent = `${email} — not an admin`;
      $('logoutBtn').classList.remove('hidden');
      showLogin('This email is not on the admin allow-list. Sign out and use an admin email, or add it to the `admins` table.');
      return;
    }
    $('who').textContent = email;
    $('logoutBtn').classList.remove('hidden');
    $('loginCard').classList.add('hidden');
    $('app').classList.remove('hidden');
    loadDrafts();
  }

  function showLogin(msg) {
    $('app').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    if (msg) $('loginMsg').textContent = msg;
  }

  $('loginBtn').onclick = async () => {
    const email = $('loginEmail').value.trim();
    if (!email) return toast('Enter your email');
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.href.split('#')[0] },
    });
    $('loginMsg').textContent = error
      ? 'Error: ' + error.message
      : '✅ Magic link sent. Open it on this device to sign in.';
  };

  $('logoutBtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  sb.auth.onAuthStateChange(() => refreshAuth());

  // ---------- tabs ----------
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

  // ---------- ingest ----------
  let pickedFile = null;
  $('srcType').onchange = () => {
    const isUrl = $('srcType').value === 'url';
    $('urlBlock').classList.toggle('hidden', !isUrl);
    $('fileBlock').classList.toggle('hidden', isUrl);
  };
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
    btn.disabled = true; st.innerHTML = '<span class="spinner"></span> Uploading…';
    try {
      const job = { source_type: srcType, source_label: label };
      if (srcType === 'url') {
        const url = $('urlInput').value.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('Enter a valid http(s) URL');
        job.source_url = url;
      } else {
        if (!pickedFile) throw new Error('Choose a PDF first');
        if (pickedFile.size > 10 * 1024 * 1024) throw new Error('PDF exceeds 10 MB');
        const path = `${Date.now()}_${pickedFile.name.replace(/[^a-z0-9._-]/gi, '_')}`;
        const up = await sb.storage.from('sources').upload(path, pickedFile, { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        job.source_file_url = path;
      }
      const sess = (await sb.auth.getSession()).data.session;
      job.created_by = sess?.user?.email || '';
      const ins = await sb.from('ingest_jobs').insert(job).select().single();
      if (ins.error) throw ins.error;

      st.innerHTML = '<span class="spinner"></span> Extracting with Gemini…';
      const { data, error } = await sb.functions.invoke('extract', { body: { ingest_job_id: ins.data.id } });
      if (error) throw new Error(error.message || 'extract failed');
      st.textContent = `✅ Extracted ${data.rows_extracted} vacanc${data.rows_extracted === 1 ? 'y' : 'ies'} from ${data.candidates} candidate(s).`;
      toast(`Added ${data.rows_extracted} draft(s) to the review queue`);
      pickedFile = null; $('fileInput').value = ''; $('dzText').textContent = 'Click to choose a PDF, or drop it here';
      document.querySelector('[data-tab="review"]').click();
    } catch (err) {
      st.textContent = '❌ ' + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  };

  // ---------- review ----------
  $('refreshBtn').onclick = loadDrafts;

  async function loadDrafts() {
    const { data, error } = await sb.from('vacancies').select('*')
      .eq('status', 'draft').order('ingest_job_id', { ascending: true }).order('vacancy_id');
    if (error) { toast('Load error: ' + error.message); return; }
    $('draftCount').textContent = data.length ? `(${data.length})` : '';
    renderDrafts(data);
  }

  function renderDrafts(rows) {
    const list = $('draftList');
    if (!rows.length) { list.innerHTML = '<p class="muted">No drafts awaiting review. 🎉</p>'; return; }
    // group by ingest job
    const groups = {};
    rows.forEach((r) => { (groups[r.ingest_job_id || 'none'] ||= []).push(r); });
    list.innerHTML = '';
    Object.entries(groups).forEach(([jobId, items]) => {
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
          <div>
            <label>${lbl}</label>
            <input data-k="${k}" value="${escapeHtml(r[k] || '')}" />
          </div>`).join('')}
      </div>`;

    const collect = () => {
      const patch = {};
      el.querySelectorAll('input[data-k]').forEach((inp) => { patch[inp.dataset.k] = inp.value.trim(); });
      // keep level_text in sync with level
      const lvl = (patch.level || '').replace(/\D/g, '');
      patch.level_text = lvl ? `Level-${lvl}` : '';
      return patch;
    };

    el.querySelector('[data-act="approve"]').onclick = async () => {
      const { error } = await sb.from('vacancies').update({ ...collect(), status: 'approved' }).eq('id', r.id);
      if (error) return toast('Approve failed: ' + error.message);
      el.remove(); toast('✅ Approved & published'); bumpCount(-1);
    };
    el.querySelector('[data-act="reject"]').onclick = async () => {
      const { error } = await sb.from('vacancies').update({ status: 'rejected' }).eq('id', r.id);
      if (error) return toast('Reject failed: ' + error.message);
      el.remove(); toast('Rejected'); bumpCount(-1);
    };
    const srcLink = el.querySelector('[data-src]');
    if (srcLink) srcLink.onclick = async (e) => {
      e.preventDefault();
      const { data } = await sb.storage.from('sources').createSignedUrl(srcLink.dataset.src, 120);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
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

  refreshAuth();
}
