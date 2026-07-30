# Setup — AI vacancy ingestion (Supabase + Gemini)

This wires up the new pipeline: **upload an Employment News PDF / notification PDF / URL
on `admin-ingest.html` → Gemini extracts deputation vacancies → you approve them →
they appear on the live site.** Everything below is free.

You do these one-time manual steps (accounts/keys I can't create for you). Takes ~20 min.

---

## 0. What's already coded
| File | Role |
|------|------|
| `supabase/migrations/0001_init.sql` | Database tables, security rules, file storage |
| `supabase/functions/extract/index.ts` | Server function that calls Gemini and saves drafts |
| `admin-ingest.html` / `admin-ingest.js` | Your private upload + review console |
| `enrich.js` | Shared logic that turns DB rows into display records |
| `app.js`, `config.js`, `index.html` | Public site now reads approved rows from Supabase |

You only need to plug in **two free accounts** (Supabase + Google AI Studio) and paste
a few keys.

---

## 1. Create a free Supabase project
1. Go to <https://supabase.com> → sign in with GitHub → **New project**.
2. Pick a name, a strong DB password (save it), region close to India (e.g. Mumbai/Singapore).
3. Wait ~2 min for it to provision.

## 2. Create the database
1. In the project: **SQL Editor → New query**.
2. Paste the **entire** contents of `supabase/migrations/0001_init.sql` → **Run**.
3. Add yourself as admin (replace with your email):
   ```sql
   insert into public.admins(email) values ('deputations.goi@gmail.com');
   ```

## 3. Get your keys (Supabase)
**Project Settings → API**:
- **Project URL** → e.g. `https://abcdxyz.supabase.co`
- **anon public** key → safe to expose (RLS protects data)
- **service_role** key → SECRET, used only by the Edge Function (next step)

## 4. Get a free Gemini API key
1. Go to <https://aistudio.google.com/app/apikey> (sign in with your Google/Gemini account).
2. **Create API key** → copy it. This is the free tier — fine for a few PDFs/week.

## 4b. Plug GitHub Actions secrets (for the daily data cron)
The `.github/workflows/build-data.yml` workflow runs daily and (since P3-3) calls
`scripts/build_embeddings.py` to bulk-embed ACTIVE vacancies. It needs two secrets
beyond the Supabase anon key already configured:

- **Repository → Settings → Secrets and variables → Actions → New repository secret**:
  - `SUPABASE_SERVICE_ROLE_KEY` — the same `service_role` key from step 3. **Secret.**
  - `GEMINI_API_KEY` — the same key from step 4. **Secret.**

These are only used by the GitHub Action runner — never appear in the site, never
exposed to the public.

## 5. Deploy the Edge Function
Install the Supabase CLI once: <https://supabase.com/docs/guides/cli> (or `npm i -g supabase`).
Then in this repo folder (PowerShell):
```powershell
supabase login
supabase link --project-ref YOUR-PROJECT-REF      # the abcdxyz part of your URL
# store secrets (service_role is auto-available; you only add Gemini):
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY
supabase functions deploy extract
```
> If you'd rather not install the CLI: tell me and I'll switch the function to run in
> **GitHub Actions** instead (the fallback in the approved plan) — no CLI needed.

## 6. Plug keys into the site
Edit **`config.js`** — replace the two placeholders:
```js
window.SUPABASE_URL = "https://abcdxyz.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOi...your anon key...";
```
Commit & push. (While these stay as placeholders, the public site keeps showing the old
`data/vacancies.json`, so nothing breaks before you're ready.)

---

## 7. Try it (verification)
1. Open `https://deputations.github.io/admin-ingest.html` → sign in with your admin email
   (magic link to your inbox).
2. **Ingest tab** → "Official notification PDF" → upload the **NCLT** sample → *Extract*.
   - Expect one draft row per post × bench × location (Joint Registrar Kolkata / New Delhi /
     Chennai / Hyderabad, Deputy Registrar Indore / Mumbai / New Delhi, …).
3. Ingest the **Employment News** PDF → expect ONLY the deputation ad(s) (e.g. the I&B
   Ministry post), with the unrelated recruitment ads (Ordnance Factory, NABFID, FDDI) skipped.
4. **Review tab** → edit anything that's off → **Approve**.
5. Open `index.html` → the approved rows now show; `Days_Left`/`Status` compute correctly.
6. Set a row's last date in the past (in Supabase Table editor) → it drops out of the active
   view automatically (retirement needs no manual action).

---

## 8. Once happy — decommission the old path (optional)
- Disable the daily build: in `.github/workflows/build-data.yml` comment out the `schedule:`
  trigger (keep the file + `build_data.py` for reference).
- The public `report-vacancy.html` (Apps Script → Sheet) can stay as a public "tip" form, or
  we repoint it. Decide later — it's independent of the admin pipeline.

## Cost & limits (all free)
- **Supabase free**: 500 MB DB (5,000 rows ≈ a few MB), 1 GB file storage, pauses after ~7
  days of zero activity — any visit/ingest wakes it.
- **Gemini free tier**: generous daily request limits; one EN issue = one request.
- **GitHub Pages**: free hosting, unchanged.

## Security notes
- The **anon key** in `config.js` is meant to be public; RLS ensures it can read only
  `status='approved'` rows and write nothing.
- The **service_role** and **Gemini** keys live only in Supabase Edge Function secrets — never
  in the browser or the repo.
- `admin-ingest.html` is `noindex` and useless without an allow-listed login.
