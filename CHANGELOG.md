# Changelog

> **Format:** [Keep a Changelog](https://keepachangelog.com/) style — versions
> are MAJOR.MINOR.PATCH, dates in YYYY-MM-DD.
> **Versions track the `?v=` cache-bust counter** on the project's three core
> assets (style.css, app.js, site-widgets.js). The counter is the project's
> behavioral version; bumping it forces browsers to refetch.
> **For AI sessions:** see `HANDOVER.md` (continuity) and `TECHNICAL.md`
> (architecture) in addition. This file is the human-readable release history.

---

## [Unreleased]

### Added
- **AI-only continuity framework** — three docs for cross-session pickup:
  `HANDOVER.md` (append-only session log), `TECHNICAL.md` (architecture
  + decision record), `WEBSITE-REVIEW.md` (roadmap + status).
- **Cache-bust scheme formalized** — single counter per asset, bumped on
  every content change. Old inconsistent counters (`ms28`, `v=2`, `v=13`,
  `v=21`, `sb1`–`sb51`) preserved verbatim until next content change.

### Pending (next session pick-up)
- P2-1 — Astro scaffold (foundation for static prerender + per-vacancy pages)
- P3-2 — AI eligibility explainer (flagship "modern tech" feature)

---

## [4.0.0] — 2026-07-09 — PWA + push + retention

> Cache-bust: `app.js?v=ms33`, `style.css?v=ms53`, `site-widgets.js?v=21`

### Added
- `manifest.webmanifest` (installable PWA).
- `sw.js` (service worker — network-first navs, SWR for `/data/`,
  network-first with cache fallback for Supabase GETs; registration
  gated to deputations.github.io origin only).
- `feed.xml` — RSS 2.0 of active vacancies with `?v=` deep links.
- **Web push notifications** end-to-end (P1-3, P1-4):
  - `push-client.js` + header bell + opt-in modal (pay-level prefill
    from `dep_profile_v1`).
  - `supabase/migrations/0014_push_subscriptions.sql` (push_subscriptions,
    push_log; RLS-gated service-role only).
  - Edge Functions `push-subscribe` + `push-notify` (web-push npm,
    VAPID, level+ministry match, dedupe via push_log, prune 404/410,
    `x-cron-key` gate).
  - `.github/workflows/push-notify.yml` daily cron.
  - `PUSH-SETUP.md` owner runbook (VAPID keys as Supabase secrets,
    `PUSH_CRON_KEY` as GitHub Actions secret).
- `robots.txt` + `sitemap.xml` (P0-10/11 — admin page disallowed,
  /faq.html canonical, 8 static pages listed).
- `/faq.html` (P0-11 — moved from `/Rules/faq.html`; old path kept as
  redirect stub).

### Changed
- **P0 batch** (commit `292b011`): compact mobile KPI strip + smaller
  hero, hamburger/bottom-sheet nav (8 links reachable), search exempted
  from mobile filter collapse, "Notification" button → "Source PDF"
  (quiet secondary style), "No change" KPI delta hidden when zero,
  un-nested `role="listbox"` on all 8 filter panels, skip-to-content
  link, footer trust line.
- Push-notify schema fixes (commit `310c8f5`): `vacancies` has NO
  `days_left` column — compute from `last_date_to_apply` (ISO text).
  `req_level1`/`req_level2` are TEXT — parse to int before comparing
  to subscriber's int `pay_level`.
- Settings link preview cards animate scale+slide+fade
  (commit `8751299`).
- Site-wide like/dislike feedback widget enabled
  (commit `8a01ff3`).
- Sticky table first column (P1-9 — partial; nested-scroll owner call).
- DeFeX cumulative monthly scoring (commit `a4ec470`) + ministry
  relabel "Ministry Secretariat"/"Department" (commits `c8409ab`,
  `c536607`, `a4c4894`).

### Removed
- `style-legacy.css` (4621 lines, unreferenced, dead).

---

## [3.0.0] — 2026-05-30 — Supabase + AI ingestion pipeline

> Cache-bust: `app.js?v=sb1`, `style.css?v=ms12`

### Added
- **Supabase backend** as the live source of truth:
  - Edge Functions: `submit` (public forms, honeypot), `extract`
    (Gemini PDF → draft vacancy), `enrich` (Gemini + Google Search
    grounding), `gc_sources` (orphan-source cleanup).
  - 8 SQL migrations (anonymous read of `status='approved'` rows).
  - `config.js` exposes `SUPABASE_URL` + anon key (public by design —
    RLS limits anon role to approved rows).
- **AI-assisted vacancy extraction** via Gemini → Mistral → OpenRouter
  fallback chain (commits `4853de4`, `bac858c`).
- **Provider-rich extraction** with retry/backoff on 503/429, model
  jumps (commits `a814407`, `5c3923d`).
- **Admin review queue** at `admin-ingest.html` (126KB JS) — side-by-side
  source viewer, sticky PDF pane, per-row page jump.
- **Source PDF storage** (Supabase + Google Drive fallback), auto-garbage-
  collected after review approval (commit `5136d2a`).
- **Standardized Ministry (53) + Organisation type (7) dropdowns**
  in admin review (commit `e214e3f`).

### Changed
- Forms re-pointed to Supabase `submit` function (commit `6b95591`);
  Apps Script kept as runtime fallback.
- Enricher: `official_notification_link` only set when real notification
  PDF is fetched; generic official page → `source_website` instead
  (commit `d3469a7`).
- Admin rewrites to plain fetch (drop supabase-js); disabled Web Locks
  that caused upload hangs (commits `16d7a99`, `6a4b2c9`).

---

## [2.0.0] — 2026-05-26 — Theming, FAQ, chronology, admin consolidation

> Cache-bust: `app.js?v=sb1`, `style.css?v=sb1`

### Added
- Dark default theme with light variant — first-class
  (no FOUC, `data-theme` attribute + inline bootstrap script in every
  page) (commit `8ab790e`).
- FAQ system — `/Rules/faq.html` (commit `33f779b`, `52bf363`) with
  topic-section collapse (commit `afad0a6`).
- Chronology page with global +/− controls to expand/collapse all cards
  (commit `edfa11a`).
- Gradient headings + blob backgrounds (commit `287950e`) — intentional
  brand identity (see P1-6 OWNER HOLD).

### Changed
- DeFeX drop Type column/filter; dedupe Home Affairs (Secretariat)
  (commit `3462bf0`).
- Admin consolidated under official `deputations.goi@gmail.com`
  (commit `e45a488`).

---

## [1.0.0] — 2026-04-15 — Initial public site

> Cache-bust: `?v=1` (the original scheme)

### Added
- All pages: `index.html`, `dex.html` (later `defex.html`), `rules.html`,
  `report-vacancy.html`, `contact.html`, `my-deputation.html`,
  `Rules/faq.html`.
- All data files: `vacancies.json`, `meta.json`, `filters.json`,
  `stats.json`.
- `scripts/build_data.py` + `requirements.txt` + `.github/workflows/build-data.yml`.
- Vanilla HTML/CSS/JS frontend — no build step. `style.css` + `app.js`
  loaded directly. Inline SVG icon sprite.
- Google Sheets → JSON data pipeline via Sheets API.
- OG + Twitter card meta, canonical URL, per-scheme `theme-color`.
- Initial visitor counter, feedback form (Apps Script), basic filters.

---

## Versioning rules (for maintainers / AI)

1. **Single counter per asset.** When editing `style.css`, bump
   `?v=msNN` in every HTML that links it. When editing `app.js`, bump
   `?v=msNN` in every HTML. When editing `site-widgets.js`, bump `?v=NN`.
   Per-page scripts (defex.js, my-deputation.js, etc.) keep their own
   numbered counter.
2. **Bump PATCH** for bug fixes, copy/spacing/CSS polish that doesn't
   change behavior. **Bump MINOR** for new feature. **Bump MAJOR** for
   any change that touches the data model, Supabase schema, or `?v=`
   scheme itself.
3. **Append here** under `[Unreleased]`; on release, move to a dated
   header. Mirror date in `HANDOVER.md` session `ended:` field on the
   last session of that release.
4. **Cross-link** with `HANDOVER.md` session IDs (the canonical
   "what happened in this release"). Citation format:
   `(commit sha7)` inline next to changes.
