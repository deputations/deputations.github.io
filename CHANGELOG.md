# CHANGELOG — version history

```
format:   MAJOR.MINOR.PATCH
encoding: per-release (date + scope)
counter:  ?v= cache-bust on style.css / app.js / site-widgets.js
sections: only [Unreleased] (append-only during cycle) and dated releases
counter_convention:
  msNN:  style.css, app.js (ms = "main site")
  NN:    site-widgets.js (low-numbered counter)
  sbNN:  scripts/build_data.py + admin-ingest.js (sb = "supabase build")
  per-page: defex.js, my-deputation.js, etc. each keep their own counter
```

---

## [Unreleased]

- 3 new top-level docs for AI session continuity: HANDOVER.md, TECHNICAL.md,
  CHANGELOG.md (this file). 4-file framework explained in HANDOVER session
  `shq-2026-07-09-002`.
- session `shq-2026-07-09-003` rewrote all 3 docs in AI-only voice.
- next pick-up: P2-1 Astro scaffold.

---

## [4.0.0] — 2026-07-09
- counter: `app.js?v=ms33` `style.css?v=ms53` `site-widgets.js?v=21`
- new asset: `manifest.webmanifest` (installable PWA)
- new asset: `sw.js` (service worker, origin-gated registration,
  network-first navs, SWR for `/data/`, network-first with cache fallback
  for supabase GETs, no precache list)
- new asset: `feed.xml` (RSS 2.0 of active vacancies with `?v=` deep links)
- new asset: `sitemap.xml` (8 static pages; admin not listed)
- new asset: `robots.txt` (admin path disallowed)
- new file: `push-client.js` + header bell + opt-in modal (pay-level
  prefill from `dep_profile_v1`)
- new migration: `0014_push_subscriptions.sql` (push_subscriptions +
  push_log; RLS service-role only)
- new edge functions: `push-subscribe` (public, verify_jwt=false),
  `push-notify` (web-push npm + VAPID + level/ministry match + dedupe
  via push_log + prune 404/410 + x-cron-key gate)
- new workflow: `.github/workflows/push-notify.yml` (daily cron)
- new doc: `PUSH-SETUP.md` (owner runbook: VAPID secrets + PUSH_CRON_KEY)
- new file: `/faq.html` (moved from `/Rules/faq.html`; old path becomes
  meta-refresh redirect stub)
- removed: `style-legacy.css` (4621 lines, unreferenced)
- P0 batch (commit `292b011`): compact mobile KPI strip + smaller hero,
  hamburger / bottom-sheet nav (8 links reachable), search exempted from
  mobile filter collapse, "Notification" button → "Source PDF" (quiet
  secondary style), "No change" KPI delta hidden when zero, un-nested
  `role="listbox"` on all 8 filter panels, skip-to-content link, footer
  trust line, sitemap.xml + robots.txt, /faq.html move
- push-notify schema fixes (commit `310c8f5`): `vacancies` has no
  `days_left` column (compute from `last_date_to_apply`); `req_level1` /
  `req_level2` are TEXT (parse before comparing to subscriber int)
- P1-9 partial: sticky table first column (nested-scroll owner call)
- DeFeX: cumulative monthly scoring, ministry relabel ("Ministry
  Secretariat"/"Department") — commits `a4ec470`, `c8409ab`,
  `c536607`, `a4c4894`
- site-wide like/dislike feedback widget enabled (`8a01ff3`)
- link preview cards animate scale+slide+fade (`8751299`)
- "Updated <date>" chip from `data/meta.json` (`f001c26`)
- ⚠ breaking: web push schedule causes `push-notify` to write to
  `push_log` on every daily run, even when no matches (intentional,
  for auditability of last-notified timestamp)

---

## [3.0.0] — 2026-05-30
- counter: `app.js?v=sb1` `style.css?v=ms12`
- supabase edge functions: `submit` (public forms, honeypot),
  `extract` (Gemini PDF → draft), `enrich` (Gemini + Google Search
  grounding), `gc_sources` (orphan-source cleanup)
- 8 SQL migrations at the time (later extended by 14)
- `config.js` exposes `SUPABASE_URL` + anon key; anon role limited by RLS
  to `status='approved'` rows
- AI extraction pipeline: Gemini → Mistral (`mistral-large-latest`,
  `mistral-ocr-latest`) → OpenRouter fallback — commits `4853de4`,
  `bac858c`
- provider retries/backoff on 503/429; model jumps on 429 — `a814407`,
  `5c3923d`
- admin review queue at `admin-ingest.html` (126KB JS) with side-by-side
  source viewer, sticky PDF pane
- source PDF storage (supabase + Google Drive fallback), auto-GC after
  approval — `5136d2a`
- standardized Ministry (53) + Organisation type (7) dropdowns in admin —
  `e214e3f`
- forms re-pointed to supabase `submit` (apps script kept as runtime
  fallback) — `6b95591`
- enricher discipline: `official_notification_link` only when real
  notification PDF is fetched — `d3469a7`
- admin rewritten to plain fetch (drop supabase-js); disabled Web Locks —
  `16d7a99`, `6a4b2c9`

---

## [2.0.0] — 2026-05-26
- counter: `app.js?v=sb1` `style.css?v=sb1`
- dark default theme with light variant (no FOUC, `data-theme` attribute
  + inline bootstrap script) — `8ab790e`
- FAQ system at `/Rules/faq.html` — `33f779b`, `52bf363`, `afad0a6`
- chronology page with global +/− expand/collapse controls — `edfa11a`
- gradient headings + blob backgrounds — `287950e` (intentional brand;
  see TECHNICAL.md §10 / WEBSITE-REVIEW P1-6 ON HOLD)
- DeFeX: drop Type column/filter; dedupe Home Affairs (Secretariat) —
  `3462bf0`
- admin email switched to `deputations.goi@gmail.com` — `e45a488`

---

## [1.0.0] — 2026-04-15
- counter: `?v=1`
- pages: `index.html`, `dex.html` (later renamed `defex.html`),
  `rules.html`, `report-vacancy.html`, `contact.html`,
  `my-deputation.html`, `Rules/faq.html`
- data: `vacancies.json`, `meta.json`, `filters.json`, `stats.json`
- build: `scripts/build_data.py` + `requirements.txt` +
  `.github/workflows/build-data.yml`
- vanilla HTML/CSS/JS frontend (no build step)
- google sheets → JSON pipeline via Sheets API
- OG + Twitter card meta; canonical URL; per-scheme `theme-color`
- visitor counter, feedback form (apps script), basic filters

---

## version-bump rules

- **PATCH**: bug fix, copy/spacing/css polish; no behaviour change
- **MINOR**: new feature; no schema change
- **MAJOR**: data model change, supabase schema change, `?v=` scheme change

## counter-bump rules

- each asset has ONE counter; bump on every content change
- `style.css` → bump `?v=msNN` in every HTML linking it
- `app.js` → bump `?v=msNN` in every HTML
- `site-widgets.js` → bump `?v=NN` in every HTML
- per-page scripts keep their own counter
- on version release: bump counters + update `Counter` line at top of
  release section + mirror date in HANDOVER latest block `ended:` field

## cross-link rules

- cite commit SHA-7 inline next to change ("`310c8f5`")
- reference session block IDs from HANDOVER for narrative ("session
  shq-2026-07-09-001")
- reference §3 Status rows from WEBSITE-REVIEW ("P1-6 ON HOLD")
- 4 docs form a directed graph:
  TECHNICAL → HANDOVER → CHANGELOG ← WEBSITE-REVIEW
  (WEBSITE-REVIEW is bidirectional with CHANGELOG via status; TECHNICAL
  references HANDOVER for gotchas)
