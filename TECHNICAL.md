# TECHNICAL — architecture reference

```
scope: AI-only
read_order: 1 (first on every cold start)
companion_files: HANDOVER.md, CHANGELOG.md, WEBSITE-REVIEW.md
table_of_contents:
  §1  identity
  §2  architecture (frontend, data, pages, PWA)
  §3  data model
  §4  localStorage keys
  §5  URL conventions
  §6  SEO/bot strategy
  §7  CSS architecture
  §8  non-obvious conventions
  §9  things that look broken but are not
  §10 decision log
  §11 open work
  §12 cold-start protocol
```

---

## §1 identity

| field | value |
|---|---|
| repo | `deputations.github.io` |
| url_canonical | https://alldeputations.com/ |
| url_repo | https://deputations.github.io/ |
| public_share | only `alldeputations.com` |
| owner | Vivek Vishal, Section Officer |
| audience | Central Government officers seeking deputation |
| disclaimer | "Unofficial site — verify with the original notification" |
| invariant | footer trust line must remain visible on every page |

---

## §2 architecture

### §2.1 frontend
- stack: vanilla HTML/CSS/JS; no bundler, no framework, no build step
- scripts: plain `<script src>` with `?v=` cache-busting
- version scheme: `?v=` counter IS the project's semantic version
  (see CHANGELOG.md for the `msNN` / `NN` / `sbNN` convention; counters
  are per-asset, bumped on content change)
- theme bootstrap: inline script in `<head>` reads
  `localStorage.deputation_theme_v1`, sets `data-theme` to avoid FOUC
- shared injector: `site-widgets.js` (deferred); every page loads it
- icon sprite: inline `<svg defs>` at top of every HTML (no CDN)
- fonts: Google Fonts (Plus Jakarta Sans, Sora, Unbounded); render-blocking

### §2.2 data
| layer | source | writer | schedule | consumer |
|---|---|---|---|---|
| static JSON | private Google Sheet | `scripts/build_data.py` via Sheets API | daily `35 3 * * *` (~09:05 IST) + on push to scripts/ | homepage (fallback) |
| static DeFeX | `anonymised-deputation-data.xlsx` | `scripts/build_defex.py` | weekly Monday | defex.html |
| live Supabase | approved rows | `extract` + `enrich` + admin review | event-driven | homepage (primary) |
| legacy Apps Script | incoming forms | n/a | runtime fallback | contact, report-vacancy |

Supabase specifics:
- `config.js` exposes `SUPABASE_URL` + anon key (public by design; RLS limits
  anon to `status='approved'` rows)
- Edge Functions:
  - `submit` — public form intake (honeypot)
  - `extract` — Gemini PDF → draft (admin-triggered)
  - `enrich` — Gemini + Google Search grounding
  - `gc_sources` — orphan-source cleanup
  - `push-subscribe` + `push-notify` — web push (live as of 2026-07-09)
- 14 SQL migrations in `supabase/migrations/`

Build actions:
- `.github/workflows/build-data.yml` (daily; bot commits back to main)
- `.github/workflows/build-defex.yml` (weekly Monday; has Suspect_Bribe safety gate)
- `.github/workflows/push-notify.yml` (daily cron; x-cron-key gate)

DeFeX build guard: build FAILS if `Suspect_Bribe` column leaks into public JSON.

### §2.3 pages
| file | role | data | auth |
|---|---|---|---|
| `index.html` | dashboard (table+card views, deep-link modal) | supabase or static | none |
| `defex.html` | DeFeX friendliness index | defex/* JSON | none |
| `my-deputation.html` | personal cockpit (bookmarks/tracker/docs/calendar) | localStorage | none |
| `contact.html` | feedback form | supabase `submit` | none |
| `report-vacancy.html` | public vacancy submission | supabase `submit` → draft queue | none |
| `rules.html` | consolidated guidelines (151KB single doc) | static | none |
| `faq.html` | community FAQ (was `/Rules/faq.html`, moved) | static | none |
| `admin-ingest.html` | review console (126KB) | supabase | supabase auth |
| `upcoming-projects.html` | V² roadmap; nav-hidden by owner | static | none |
| `Rules/faq.html` | redirect stub → /faq.html (meta refresh + JS) | — | — |

Notable:
- `defex.html` is the only page with inline `on*` handlers (intentional)
- `my-deputation.html` is 82KB JS, 100% localStorage, no server
- `Rules/faq.html` kept for back-compat (P0-11)

### §2.4 PWA
| asset | behaviour |
|---|---|
| `manifest.webmanifest` | installable; icons = favicon.svg (any) + apple-touch-icon.png 180×180 |
| `sw.js` | service worker |
| `feed.xml` | RSS 2.0 active vacancies with `?v=` deep links |

Service worker specifics:
- origin-gated registration: only `deputations.github.io`; localhost never
  cached (allows untainted local dev)
- navigations: network-first
- same-origin + `/data/`: stale-while-revalidate
- Supabase GETs: network-first with cache fallback
- no precache list (runtime caching + `?v=` busting coexist)

---

## §3 data model

### §3.1 vacancy row
| field | type | source | notes |
|---|---|---|---|
| `Vacancy_ID` | string | sheet | used as `?v=` deep link fragment |
| `Post_Name` | string | sheet | search suggestions |
| `Ministry` | string | sheet | filter axis |
| `Department_Organisation` | string | sheet | filter axis |
| `Location_City` | string | sheet | location filter |
| `Location_State` | string | sheet | location filter |
| `Level` | string | sheet | "Level-12" form |
| `Pay_Level` | int | sheet | compared to subscriber int |
| `Eligibility` | string | sheet | shown in modal |
| `Eligibility_Level_From` | int | sheet | drives personalised filter |
| `Eligibility_Level_To` | int | sheet | drives personalised filter |
| `Years_Required_At_Level` | int | sheet | year threshold for personalised filter |
| `Last_Date_To_Apply` | ISO date string | sheet | **the** date; `days_left` derived at query time |
| `Notification_Date` | ISO date string | sheet | default sort key |
| `Official_Notification_Link` | URL string | sheet | drives "Source PDF" link |
| `Status` | enum | derived | `Active` if `days_left >= 0`, else `Inactive` |
| `Days_Left` | int | derived client-side | `last_date_to_apply - now`; never stored |

### §3.2 critical pitfalls
- **`vacancies.days_left` does NOT exist.** Compute from
  `last_date_to_apply`. Any code doing `SELECT days_left` returns null.
  Reference fix: commit `310c8f5`.
- **`req_level1` / `req_level2` are TEXT, not int.** Parse before comparing
  to subscriber's int `pay_level`. Reference fix: commit `310c8f5`.
- `Eligibility_Level_From` may be empty string; treat as `null`.

---

## §4 localStorage keys

| key | owner page | shape | purpose |
|---|---|---|---|
| `deputation_theme_v1` | every | `dark` \| `light` | theme |
| `deputations_watchlist_v1` | index | string[] of `Vacancy_ID` | homepage watchlist |
| `dep_profile_v1` | index + my-deputation | `{pay_level, years, ministries[]}` | personalised filter + push prefill |
| `dep_saved_searches_v1` | my-deputation | `[{name, filters}]` | saved filter presets |
| `dep_documents_v1` | my-deputation | `[{id, name, checked}]` | checklist |
| `dep_tracker_v1` | my-deputation | `[{vacancy_id, status, notes}]` | application tracker |
| `dep_calendar_v1` | my-deputation | `[{date, label, kind}]` | cooling-period + reminders |
| `sw_visit` | site-widgets | `{total, today}` | counter cache (session) |
| `sw_sid` | site-widgets | string UUID | counter per-tab session id |
| `sw_voted_<page>` | site-widgets | `"up"` \| `"down"` | like/dislike per page |
| `sw_updated` | site-widgets | date string | "Updated on" chip |

Namespace prefixes: `deputation*`, `deputations*`, `dep_*`, `sw_*`. Do not
introduce new prefixes without updating this table.

---

## §5 URL conventions

| pattern | use |
|---|---|
| `/index.html?v=<Vacancy_ID>` | open vacancy modal directly |
| `/index.html?search=...&payLevel=...&level=...&ministry=...&location=...&status=...` | filter state restore |
| `/Rules/faq.html` | legacy; meta-refreshes to /faq.html |
| `/Rules/Documents/*.html` | source circulars (no nav back) |
| no trailing slash; keep `.html` for GH Pages |

Theme is localStorage-only; never URL-driven.

---

## §6 SEO/bot strategy

| state | bot sees |
|---|---|
| no JS | `<div id="resultsCount">Loading vacancies...</div>` placeholder; nothing else |
| JS executes | rows render via `renderDashboard()`; JSON-LD `ItemList` injected via `injectJsonLd()` (app.js ~line 593) |
| static fallback | `data/vacancies.json` exists for fetch (not HTML) |

Gap: no SSR; non-JS crawlers see no content. Mitigation in P2 (Astro
static prerender — see WEBSITE-REVIEW §3 P2-3).

---

## §7 CSS architecture

| file | size | role |
|---|---|---|
| `style.css` | 164 KB | tokens + global |
| `navbar.css` | small | shared top nav |
| `defex.css`, `my-deputation.css`, `report-vacancy.css`, `contact.css`, `upcoming-projects.css` | small | per-page additions |

Token system: `:root` in `style.css` for dark default; `[data-theme="light"]`
override block for light. 31 `@media` blocks. Mobile rules live in
`@media (max-width: 640px)` and `(max-width: 768px)` blocks.

---

## §8 non-obvious conventions

| rule |
|---|
| every page has the same inline SVG sprite at top of body; add new icons to index.html AND replicate to every other HTML until P2-1 lands |
| prefer custom dropdowns `createSingleSelect` / `createMultiSelect` over native `<select>` so design tokens flow through |
| matching whitespace: spaces or tabs per file convention; do not mix |
| all scripts `defer` or at end of `<body>`; never render-blocking above existing Google Fonts preconnect |
| `?v=` bumps on every content change of style.css / app.js / site-widgets.js; per-page scripts have their own counter |
| `[data-tw]` attribute triggers typewriter in site-widgets.js; opt out by removing attribute |
| OG/Twitter meta is static and identical across pages; share-* embeds vacancy detail in the share text itself |
| VAPID keys: `supabase/.vapid.keys` is gitignored; never commit; rotate via PUSH-SETUP.md |
| inline HTML icon sprite: 22 symbols in index.html `defs` |

---

## §9 things that look broken but are not

| phenomenon | actual |
|---|---|
| "Loading vacancies..." in crawler HTML | known; see §6 |
| `style-legacy.css` referenced anywhere? | no; deleted in P0 |
| Apps Script still wired | intentional fallback; P3-5 retires it |
| "Updating" build markers | daily `chore: build` commits |

---

## §10 decision log

| date | decision | rationale | source |
|---|---|---|---|
| 2026-07-08 | keep neon-glassmorphism look | owner: "vibrant look is intentional brand identity" | WEBSITE-REVIEW.md P1-6 SKIP |
| 2026-07-08 | lazy-load WebGL hero | phone CPU budget | commit `b666711` |
| 2026-07-09 | cache-bust counter = semantic version | already the de-facto version | CHANGELOG.md |
| 2026-07-09 | 4-file doc split (HANDOVER/TECHNICAL/CHANGELOG/WEBSITE-REVIEW) | one audience per file | TECHNICAL.md §0 |
| 2026-07-09 | HANDOVER is append-only markdown (not JSONL) | `git diff` readability + deterministic regex parse | HANDOVER.md schema block |
| 2026-07-09 | docs are not in sitemap.xml + not linked from HTML | humans should not land on them | session -002 decisions |
| 2026-05-31 | `vacancies.days_left` is computed, not stored | the schema never had it; push-notify bug exposed this | commit `310c8f5` |

---

## §11 open work

| tier | id | title | effort | notes |
|---|---|---|---|---|
| P2 | 2-1 | Astro scaffold | L | foundation for static prerender + per-vacancy pages |
| P2 | 2-3 | per-vacancy `/vacancy/{id}/` + JobPosting JSON-LD | M | SEO unlock |
| P3 | 3-2 | AI eligibility explainer (Gemini Edge Function) | L | flagship modern feature |

Hold:
- P1-6 (visual calm-down) — owner decision, do not pick up
- P1-7 (font self-host, drop 3rd family) — bundled with P1-6 on hold
- P1-8 (KPI sparklines) — blocked on no data history source

---

## §12 cold-start protocol

1. read TECHNICAL.md (this file)
2. read HANDOVER.md — find last `## session` block at file bottom
3. read CHANGELOG.md — find latest version section
4. read WEBSITE-REVIEW.md — §3 Backlog Status column only

Total: ~3k tokens. Stop reading evidence sections in WEBSITE-REVIEW.md §1/§2 —
they exist for the owner's quarterly skim, not for decision-making.

On session end:
1. append a new block to HANDOVER.md (do not edit prior blocks)
2. if any visible UI changed, bump the relevant `?v=` counters
3. extend CHANGELOG.md `[Unreleased]` if shipping
4. update WEBSITE-REVIEW.md §3 Status column if any backlog row moved
5. commit; push to origin
