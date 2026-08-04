# CHANGELOG — version history

**Current version: `7.2.0` (2026-08-04).** The `VERSION` file at the repo root
is the single source of truth; this file is its history.

```
format:   MAJOR.MINOR.PATCH
anchor:   /VERSION  (one line, no leading "v")
encoding: per-release (date + scope)
counter:  ?v= cache-bust on style.css / app.js / site-widgets.js
sections: only [Unreleased] (append-only during cycle) and dated releases
counter_convention:
  msNN:  style.css, app.js (ms = "main site")
  NN:    site-widgets.js (low-numbered counter)
  sbNN:  config.js + scripts/build_data.py + admin-ingest.js (sb = "supabase build")
  per-page: defex.js, my-deputation.js, etc. each keep their own counter
```

> **Versioning is live from 7.2.0 onward (2026-08-04).** Releases 1.0.0-7.2.0
> were reconstructed from git history on 2026-08-05; their dates are the dates
> of the work, and the grouping is by milestone rather than by a release event
> that actually happened at the time. Everything from 7.2.0 forward is cut as
> it ships.

---

## [Unreleased]

_(nothing yet — append here during the cycle, then cut a dated release)_

---

## [7.2.0] — 2026-08-04
- counter: `app.js?v=ms58` `style.css?v=ms58` `site-widgets.js?v=25`
- AI bar states the NIC block in its own placeholder instead of relying on
  a page-level notice — `01b78a9`
- NIC verification from inside the network: `*.workers.dev` is **DNS-
  sinkholed** into NIC's walled garden (`e.wg.restricted.in` →
  `e.walledgarden.nic.in` → `10.40.124.9`, SOA
  `phishing.domain.clean-pipe.in`), same as `*.supabase.co`. The whole
  `workers.dev` apex is blocked as a category, so the reverse proxy from
  7.0.0 does not work on NIC — `fc15248`
- ⚠ correction to earlier notes: the NIC failure is DNS-level, not the
  TLS-interception described in 6.1.0. Requests never reach a handshake.
  `alldeputations.com` itself resolves fine, which is why a custom domain
  on the apex remains the candidate fix.

---

## [7.1.0] — 2026-08-03
- counter: `app.js?v=ms55` `style.css?v=ms57` `site-widgets.js?v=24`
  `config.js?v=sb3` `my-deputation.js?v=sb6`
- fix: collapsed-filters `grid-template-areas` sat outside its
  `@media (min-width: 769px)` gate, so phones rendered a 34px sidebar with
  the whole dashboard crammed into a 293px column — `065c6d9`
- ultra-wide monitors (≥1600px) open with the filters sidebar expanded;
  inline boot script before first paint, no flash — `d8acead`
- AI search relevance readout: raw cosine rescaled from the band the corpus
  actually occupies onto 0-100%, drawn as a percentage over a proportional
  bar, raw value on hover — `0f9c634`
- AI retrieval switched to asymmetric embeddings (`RETRIEVAL_DOCUMENT` for
  the corpus, `RETRIEVAL_QUERY` for the query), gated on
  `semantic_search_state.embed_task_type` so mismatched vector spaces can't
  occur — `0f9c634`
- relevance band recalibrated against the re-embedded corpus:
  `RELEVANCE_FLOOR` 0.55 / `RELEVANCE_CEIL` 0.73, measured from live
  queries — `57cf770`
- fix: result sub-line was HTML-escaped twice ("Small &amp;amp; Medium")
  — `0f9c634`
- offline-mode banner removed entirely; the AI bar carries the notice —
  `55f004b`, `95d76c4`
- fix: `my-deputation.html` bookmarks reconciled against an empty list when
  Supabase was unreachable, reporting every bookmark as "no longer in the
  current list". Same JSON-primary fix `index.html` got in 5.0.0 — `9f20e09`
- fix: Region filter blank + identical Pay Level counts — `backfillDerived`
  now runs on JSON rows in both branches — `e3b3139`, `0aef1b6`
- fix: AI results panel now clears when the input is emptied — `1f738e9`
- fix: `SB_OK` rejected the proxy URL, so the feedback heart no-opped on
  production — `8f302dc`
- ci: removed the `gh-pages` mirror step from `build-data.yml` — it had
  failed on every run and the branch is dormant — `0465bef`
- docs: Cloudflare Workers Free plan downgrade noted — `a15845c`

---

## [7.0.0] — 2026-08-02
- P3-7 PR 2: Cloudflare Worker reverse proxy at `workers/sb-proxy/`,
  transparent pass-through for REST / RPC / Edge Functions / Realtime —
  `9ed284c`
- `config.js` rewrites `SUPABASE_URL` to the Worker when the page is served
  from `alldeputations.com`; every other host keeps the direct URL
- deployed to `sb-proxy.ncrsarkarishaadi.workers.dev` — `dab4e24`
- ⚠ `api.alldeputations.com` as a Workers Custom Domain is **blocked at the
  zone level**: the apex is on Wix DNS, not this Cloudflare account. No
  token scope fixes it; the zone has to migrate first — `04554da`

---

## [6.1.0] — 2026-07-31
- counter: `app.js?v=ms46` `style.css?v=ms52`
- P3-6 FAQ discrepancy reporting: migration `0015_faq_discrepancies.sql`,
  `submit` Edge Function branches, `faq.html` wiring — `d867634`,
  `f2478f3`, `66318e3`
- P3-3 semantic search: migration `0016_semantic_search.sql` (pgvector,
  `vacancy_embeddings`, HNSW cosine index, `search_vacancies()` RPC,
  `semantic_search_state` soft-disable flag) — `8f85d52`
- P3-3: `scripts/build_embeddings.py` (ACTIVE-only, Gemini
  `gemini-embedding-001` truncated to 768 dims, 429 → auto-disable)
- P3-3: `semantic-search` Edge Function with free-tier guards + in-memory
  LRU — `ff83c06`
- P3-3 PR 4: AI search relocated from a sidebar chip to a dedicated
  full-width bar below the KPI grid; always-on, no toggle — `87d32c8`,
  `4053a67`
- P3-3 fixes: `vacancy_id` alignment, Gemini `embedContent` URL, PostgREST
  upsert via POST + merge-duplicates — `2f3d9e5`, `3d13d58`, `55b479c`
- P3-7 PR 1: one-time reachability probe (`ensureSupabaseAvailable`) +
  offline-mode banner; feedback widget renders unconditionally —
  `061b503`, `58215de`
- P3-7 PR 3: bookmark UX — header pulse, "stored on this device" hint,
  count-aware aria-label, watchlist smoke tests — `bb54b91`

---

## [6.0.0] — 2026-07-30
- P2-1: Astro scaffold — `Layout`, `Navbar`, `IconSprite`, `Footer`,
  `astro-build.yml` deploying to `gh-pages` — `c2d995c`
- P2-2: all 8 pages ported via `InlinePageBody` (reads the static HTML at
  build time) + 404 redirector for legacy `/foo.html` URLs — `6c95e01`
- P2-3: per-vacancy static pages with `JobPosting` JSON-LD;
  `scripts/build_sitemap.py` emits 392 URLs — `eb349e3`
- P2-4: build-time OG images, Pillow 1200×630 per vacancy, `og/`
  gitignored — `277f1d6`
- P3-5: Apps Script runtime fallback retired — Supabase `submit` is now the
  single backend for every form — `411206c`
- P3-4: Playwright smoke suite across 5 PRs — index, defex,
  report-vacancy, contact, my-deputation, faq, rules, admin login,
  redirects, plus a constants drift guard — `c5366ba`, `b027e5d`,
  `8791f0a`, `98f800a`, `6dc4658`
- push-client: themed the pay-level `<select>` options — `885b4f7`
- ⚠ GitHub Pages still serves `main`; the Astro build lands on `gh-pages`
  and is dormant until the source is switched by hand

---

## [5.0.0] — 2026-07-28
- ⚠ breaking: canonical domain switched to **alldeputations.com**. `CNAME`
  added; every canonical / `og:url` / `og:image` / `twitter:image`, all 16
  `feed.xml` URLs, all 8 `sitemap.xml` locs and the push-client hint
  rewritten — `912380c`
- fix: vacancies failed to load on NIC networks. `fetchVacancies()` flipped
  to JSON-primary with Supabase as an enhancement behind a 4 s timeout;
  `rpc()` gained a 3-strike circuit breaker that hides the visitor counter
  — `5379c9e`
- fix: the daily cron dumped a stale Google Sheet (53 rows / 0 active) while
  live Supabase served 384 / 75. `build_data.py` now reads Supabase first
  and falls back to the Sheet — `f2928d2`
- fix: enrich-merge shape mismatch — JSON rows win for shared IDs,
  Supabase-only rows go through `enrichRecord`, and `Status` is recomputed
  client-side from `last_date_to_apply` — `c9557e4`
- fix: service worker registered on `alldeputations.com` (was gated to
  `deputations.github.io`) — `dbdd063`
- fix: clicking the "Total Vacancies" KPI shows all rows — `4953955`
- P3-1: "N new vacancies since you opened" toast — Supabase Realtime WS
  with a 60 s polling fallback that works on every network — `894339d`
- docs: AI session-continuity framework — `HANDOVER.md`, `TECHNICAL.md`,
  `CHANGELOG.md` — `05aeec3`, `a156143`

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
- **MAJOR**: data model change, supabase schema change, `?v=` scheme change,
  canonical-URL change

## release procedure (BINDING from 7.2.0 onward)

Every change-set that reaches `origin/main` gets a version. No exceptions for
"small" fixes — a PATCH bump costs one line.

1. Bump `/VERSION` to the new number.
2. Move the `[Unreleased]` bullets into a new `## [X.Y.Z] — YYYY-MM-DD`
   section at the top of the dated list, and leave `[Unreleased]` empty.
3. Record the `counter:` line for any asset whose `?v=` changed in this
   release (see counter-bump rules below).
4. Cite the commit SHA-7 next to each bullet.
5. Mirror the date in the latest HANDOVER block's `ended:` field.

Data-only commits (`chore: build deputation data` from the cron) do NOT get a
version — they carry no code change. Everything else does.

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
