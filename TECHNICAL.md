# Technical Reference — Deputations.site

> **Audience:** AI sessions (Claude Code or compatible). Human-readable but
> optimized for AI comprehension. No marketing voice, no narrative padding.
> **Read this first** on every cold start, then `HANDOVER.md` (latest block),
> then `CHANGELOG.md`, then `WEBSITE-REVIEW.md`.

---

## 1. What this is

- **Repo:** `deputations.github.io` — single GitHub Pages site for Indian
  central government deputation vacancies.
- **URL:** https://deputations.github.io/
- **Owner:** Vivek Vishal, Section Officer (independent, non-official portal —
  see disclaimer modal in `site-widgets.js`).
- **Audience:** Central Government officers seeking deputation postings.
- **Strict invariant:** "Unofficial site — verify with the original
  notification." Footer + modal in every page.

## 2. Architecture snapshot

### 2.1 Frontend
- **Stack:** Vanilla HTML/CSS/JS. **No** bundler, **no** framework, **no**
  build step for the frontend assets. Scripts loaded as plain `<script src>`.
- **Cache busting:** manual `?v=` query strings (inconsistent: `?v=ms28`,
  `?v=2`, `?v=13`, `?v=21`, `?v=sb1`). This counter **is** the project's
  semantic version. See CHANGELOG.md.
- **Self-hosted:** every page has an inline theme-bootstrap script in `<head>`
  setting `data-theme` to avoid FOUC. Persisted in `localStorage` as
  `deputation_theme_v1`.
- **Shared injection point:** `site-widgets.js` (deferred) — every page loads
  it. Injects visitor counter, disclaimer footer/modal, typewriter on
  `[data-tw]` headlines, mobile nav enhancement.

### 2.2 Data pipeline (two layers)

1. **Static JSON** (built & committed, primary data feed):
   - `scripts/build_data.py` reads a private Google Sheet via Sheets API →
     normalizes → writes `data/vacancies.json`, `data/filters.json`,
     `data/stats.json`, `data/meta.json`, `data/ministries.json`.
   - `scripts/build_defex.py` reads `anonymised-deputation-data.xlsx` →
     writes `data/defex/*.json`. Has a safety gate that FAILS the build
     if a `Suspect_Bribe` column leaks into public files.
   - Scheduled by `.github/workflows/build-data.yml` (daily ~09:05 IST)
     and `.github/workflows/build-defex.yml` (weekly Monday).
   - The bot commits JSON back to `main`.
2. **Supabase** (live source of truth when configured):
   - `config.js` exposes `SUPABASE_URL` + `SUPABASE_ANON_KEY` (intentionally
     public — anon key is safe by design thanks to RLS).
   - RLS limits anon role to `status='approved'` rows.
   - `data/vacancies.json` is ONLY a fallback / SEO baseline.
   - Edge Functions (Deno) in `supabase/functions/`:
     - `submit` — public form intake (vacancy report, contact feedback)
       with honeypot.
     - `extract` — Gemini-powered PDF → draft vacancy (admin-triggered).
     - `enrich` — Gemini + Google Search grounding to fill draft fields.
     - `gc_sources` — orphan-source cleanup.
     - `push-subscribe` + `push-notify` — web push (Dormant until
       PUSH-SETUP.md completed; deploys done, see HANDOVER).
3. **Legacy fallback:** `apps-script/*.gs` — Google Apps Script endpoint,
  wired as runtime fallback in `contact.js` + `report-vacancy.js` +
  `admin-ingest.js`. **Do not add new features to Apps Script** — retire
  it once Supabase stability is confirmed (P3-5).

### 2.3 Pages
- `index.html` (home, 382 vacancies / 155 active at last fetch) — table+card
  view, deep-linkable modal (`?v=<id>`), share links, copy-link, watchlist.
- `defex.html` — DeFeX friendliness index (only page with inline `on*`
  handlers, intentional).
- `my-deputation.html` — personal cockpit, **all localStorage**, no auth.
  82KB of JS rendering overview/bookmarks/searches/tracker/documents/
  calendar/cooling-period/profile.
- `contact.html` — feedback form → Supabase `submit` (or Apps Script).
- `report-vacancy.html` — submit a vacancy → admin review queue.
- `rules.html` — 151KB **single static document** (consolidated guidelines).
- `faq.html` — moved from `/Rules/faq.html` (P0-11). Old path kept as a
  redirect stub.
- `admin-ingest.html/.js` — admin console, Supabase-auth-gated, 126KB JS.
- `upcoming-projects.html` — V² roadmap; nav-hidden at owner's request.
- `Rules/faq.html` → 301-equivalent to `/faq.html` (meta refresh + JS).

### 2.4 PWA
- `manifest.webmanifest` — installable, icons = favicon.svg + apple-touch-icon.
- `sw.js` — service worker. Registration gated to `deputations.github.io`
  origin only — local dev never caches. Network-first navigations,
  stale-while-revalidate for same-origin assets + `/data/`, network-first
  with cache fallback for Supabase GETs. No precache list (runtime caching
  coexists with `?v=` busting).
- `feed.xml` — RSS 2.0 of active vacancies with `?v=` deep links. Generated
  by `scripts/build_data.py::build_feed()`.

## 3. Data model (canonical fields)

Stored in `data/vacancies.json` (Sheet → Supabase columns):

| Field | Type | Source | Notes |
|---|---|---|---|
| `Vacancy_ID` | string | sheet | Used as `?v=` deep link fragment |
| `Post_Name` | string | sheet | Used in search suggestions |
| `Ministry` | string | sheet | Filter axis |
| `Department_Organisation` | string | sheet | |
| `Location_City` / `Location_State` | string | sheet | |
| `Level` | string | sheet | "Level-12" form |
| `Pay_Level` | int | sheet | Compares against user's `pay_level` |
| `Eligibility` | string | sheet | Drives pay-level filtering |
| `Eligibility_Level_From` / `_To` | int | sheet | Used by "Display deputations for me" |
| `Years_Required_At_Level` | int | sheet | Year threshold for personalized filter |
| `Last_Date_To_Apply` | ISO date string | sheet | **THE** date; `days_left` is computed at query time |
| `Notification_Date` | ISO date string | sheet | Default sort key |
| `Official_Notification_Link` | URL string | sheet | Drives the "Source PDF" link |
| `Status` | enum | derived | `Active` / `Inactive` — `expired` if `days_left < 0` |
| `Days_Left` | int | derived (client) | **`last_date_to_apply` − now** — never stored |

**Critical pitfall (logged from commit `310c8f5`):** there is **no
`days_left` column** in `vacancies`. Any code that does
`SELECT days_left FROM vacancies` returns null silently. Compute it from
`last_date_to_apply` (ISO text — parse via JS `new Date()`).

## 4. LocalStorage keys (do not collide)

| Key | Owner | Purpose |
|---|---|---|
| `deputation_theme_v1` | every page | theme: `dark` \| `light` |
| `deputations_watchlist_v1` | index | bookmarked vacancy IDs |
| `dep_profile_v1` | index + my-deputation | user's pay level + years + ministry prefs |
| `dep_saved_searches_v1` | my-deputation | saved filter presets |
| `dep_documents_v1` | my-deputation | checklist state |
| `dep_tracker_v1` | my-deputation | application tracker (status per vacancy) |
| `dep_calendar_v1` | my-deputation | cooling-period + reminders |
| `sw_visit`, `sw_sid`, `sw_voted_*`, `sw_updated` | site-widgets | counter + vote state (per page) |

## 5. URL conventions

- Home deep link: `/index.html?v=<Vacancy_ID>` opens the modal.
- Filter state sync: query params `search`, `payLevel`, `level`, `ministry`,
  `location` (comma-sep), `status`.
- Theme: stored locally; not URL-driven.
- No trailing slash. No `.html` for non-root pages (keep as-is for GH Pages).

## 6. Bot-vs-JS strategy

GitHub Pages cannot pre-render. The current solution:
- Static `data/vacancies.json` exists at `/data/vacancies.json` (so
  crawlers see *something*), but the homepage HTML ships only
  "Loading vacancies..." markup until JS executes.
- **SEO gap:** JSON-LD `ItemList` is injected only post-load.
  Mitigation in P2 (Astro static prerender — see WEBSITE-REVIEW §3 P2-3).

## 7. CSS architecture

- `style.css` (single file, ~164 KB) — full `:root` token system,
  glassmorphism dark default, `[data-theme="light"]` overrides.
- `navbar.css` — shared top nav.
- `defex.css`, `my-deputation.css`, `report-vacancy.css`,
  `contact.css`, `upcoming-projects.css` — per-page additions.
- 31 `@media` blocks in `style.css`. Mobile rules live in the existing
  `@media (max-width: 640px)` block — see P0-3 for the compact KPI strip.
- **Do NOT add a CSS-in-JS layer.** Static CSS is intentional.

## 8. Non-obvious conventions

- **HTML icon sprite** is inline at the top of every page (avoids icon CDN).
  Add new icons to `index.html`'s `<svg defs>` block AND replicate in every
  other HTML file (until P2-1's Layout component lands).
- **Custom dropdowns** (`createSingleSelect` / `createMultiSelect` in
  `app.js`) implement Escape/focus-return — **prefer them** over native
  `<select>` so the design tokens flow through consistently.
- **Whitespace in HTML is significant** — repo uses spaces, tabs in some
  files. Match the file you're editing.
- **All script tags use `defer` or are at the end of `<body>`** — never
  put anything render-blocking above the existing Google Fonts preconnect.
- **Cache-bust discipline:** when editing `style.css`, bump `?v=msNN` in
  every HTML that links it (and the line in `index.html`'s `<link>` +
  every other page). Same for `app.js` (`?v=msNN`). Bump `?v=NN` for
  per-page scripts (no shared scheme — see CHANGELOG for the convention).
- **The `data-tw` attribute** triggers the typewriter animation in
  `site-widgets.js`. Remove the attribute to opt a headline out.
- **Open Graph / Twitter meta** are static and identical across all pages
  (the share-* function embeds vacancy detail in the share text itself,
  not the meta tag). See `<head>` of any page.

## 9. Things that look broken but aren't

- The "Loading vacancies..." placeholder seen by crawlers → known, see §6.
- The README for SETUP.md mentions local-only steps that assume
  `python -m http.server` + a populated `data/vacancies.json`. Local dev
  is fine; nothing on the public site depends on this.
- The `style-legacy.css` deletion is intentional — was unreferenced.

## 10. Decision log (AI-extractable)

| Date | Decision | Rationale | Source |
|---|---|---|---|
| 2026-07-08 | Keep neon-glassmorphism look | Owner decision: "vibrant look is intentional brand identity" | WEBSITE-REVIEW.md P1-6 SKIP |
| 2026-07-08 | Lazy-load WebGL hero | Phones get CPU-budget relief | commit `b666711` |
| 2026-07-09 | Cache-bust counter = semantic version | Already the de-facto versioning; formalize without behavior change | this doc |
| 2026-07-09 | 4-file documentation split (HANDOVER/TECHNICAL/CHANGELOG/WEBSITE-REVIEW) | Each has a single audience + purpose | this doc |
| 2026-07-09 | HANDOVER is append-only | Idempotency + simple grep/diff | HANDOVER.md preamble |

## 11. Open work (from WEBSITE-REVIEW §3)

| Tier | Next | Effort | Note |
|---|---|---|---|
| P2-1 | Astro scaffold | L | Foundation for static prerender + per-vacancy pages |
| P2-3 | Per-vacancy `/vacancy/{id}/` + JobPosting JSON-LD | M | SEO unlock |
| P3-2 | AI eligibility explainer (Gemini) | L | Flagship "modern tech" feature |

P1-6/P1-7 (visual calm-down + self-host fonts) are on OWNER HOLD —
do not pick up without explicit approval.

## 12. Reading order on every cold start

1. **TECHNICAL.md** — this file (the doc you're reading). Sets
   architecture context.
2. **HANDOVER.md** — read ONLY the latest session block + check the
   `ending_head`. If your session is a continuation, append a new
   block; never edit previous ones.
3. **CHANGELOG.md** — user-facing version log. Confirms what shipped.
4. **WEBSITE-REVIEW.md** — current roadmap + status.

Total: ~2500 lines. ~3k tokens. Cheap.
