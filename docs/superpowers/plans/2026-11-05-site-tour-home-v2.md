# Site Tour — Home v2 (every Home feature + page montage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-step Home tour with the owner-approved ~75 s tour: brand intro, eight Home-feature steps, the page montage and a finale whose cards link to each page.

**Architecture:** Builds on stage 1 (engine, kit, loader). The engine gains a brand intro and a "keep the last scene" finale with page links. Scenes are split across three files so each stays focused: `home.js` (steps 1–3 + registration), `home-more.js` (steps 4–7), `pages.js` (step 8).

**Tech Stack:** as stage 1 (vanilla JS, GSAP 3.15.1 vendored, pytest + Playwright).

**Spec:** `docs/superpowers/specs/2026-11-04-site-tour-design.md` §3.1 (revised 2026-11-05)

## Global Constraints

- All stage-1 constraints still hold (see `docs/superpowers/plans/2026-11-04-site-tour-stage1.md`), plus the review fixes on this branch (feeder-grade sample data, sample labels, inert page, Back closes, steps view for small screens).
- Intro headline exactly `Your one stop solution to Deputation`; brand exactly `ALL Deputations.com`.
- Step titles exactly, in order: `Only the posts you can apply for`, `Narrow it down`, `Just ask`, `Sort and switch views`, `Save posts you like`, `Never miss a vacancy`, `Light or dark — your choice`, `Explore more pages`.
- Page cards, in order, with hrefs: India Map `/india-map.html`, DeFeX `/defex.html`, My Deputation `/my-deputation.html`, Report Vacancy `/report-vacancy.html`, Rules `/rules.html`, FAQs `/faq.html`.
- Loader asset order for `home`: gsap, tour.css, tour-engine.js, tour-kit.js, `scenes/map.js`, `scenes/pages.js`, `scenes/home-more.js`, `scenes/home.js` (each `?v=1`: nothing has been deployed yet, so no cache-bust bump is needed).
- Layout-property animation (width/height, clip-path) is allowed only for the ≤ 6 morphing rows (step 4) and the theme wipe layer (step 7).

## Review Focus

1. Brand wordmark on a 390 px phone and a 1440 px desktop: fits on screen, never overflows (test `test_brand_fits_the_screen`).
2. Clicking a page card in the finale: tour closes, seen is written, then the page navigates (test `test_page_card_opens_its_page`).
3. Keyboard users at the finale can Tab to the page links and the CTA (test `test_finale_links_are_keyboard_reachable`).
4. Skipping ahead with → through nine steps still reaches the CTA (test `test_cta_opens_pay_level`, updated).
5. Reduced-motion steps view lists every step title in order (test `test_steps_view_lists_every_step`).

---

### Task 1: Engine — brand intro and finale that keeps the scene

**Files:** Modify `tour/tour-engine.js`, `tour/tour.css`; Test `tests/test_tour_engine.py`.

**Interfaces:**
- `register(key, { intro: { headline, brand? }, scenes, cta: { label, action, keepScene? } })`.
- Brand: `.dt-brand` with spans `.dt-brand-a` (first word), `.dt-brand-b` (rest without `.com`), `.dt-brand-tld` (`.com`); font size fitted so its width is 86–92 % of the viewport (tall layout: two lines, first word on its own line). Sequence: headline in (as now) → headline out → brand scales 2.6 → 1 with blur 18 → 0, sweep, hold 1.6 s → fly-through out.
- Finale with `keepScene`: no dimming; CTA at the bottom (`.dt-finale.is-bottom`); `.dt-stage` loses `aria-hidden`; overlay gets `dt-finale-on`; `a.dt-page-link` inside the overlay: click → `close('link')`, then `location.assign(href)` after the overlay is removed. Focus trap covers `a[href]` and buttons.
- Steps view: unchanged (titles + summaries; CTA on the last step).

- [ ] **Step 1: Failing tests** — `test_brand_follows_the_headline` (`.dt-brand` text `ALL Deputations.com` appears after the headline), `test_brand_fits_the_screen` (at 1440×900 and 390×844 during the hold its width is between 0.8 and 0.95 of the viewport and fully on screen), `test_keep_scene_finale_shows_links` (probe scene appends `a.dt-page-link[href="/x.html"]`; at the finale the stage has no `aria-hidden`, the link is clickable, CTA has class `is-bottom` parent), `test_page_card_opens_its_page` (click link → URL path `/x.html` (route stubbed 200), seen written), `test_finale_links_are_keyboard_reachable` (Tab cycles through link and CTA).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `tests/test_tour_engine.py` → all PASS.
- [ ] **Step 5: Commit** `feat(tour): brand intro and link finale`.

### Task 2: Home steps 1–3, loader order, registration

**Files:** Modify `tour/scenes/home.js`, `tour/tour-loader.js`; Create stubs `tour/scenes/home-more.js`, `tour/scenes/pages.js`; Test `tests/test_tour_home.py`, `tests/test_tour_loader.py`.

**Interfaces:** `home.js` registers `home` with `intro {headline, brand}`, scenes `[eligibility, filters, ask, ...DepTourHomeMore.scenes, DepTourPages.montageScene]`, `cta {label: 'Try it with your pay level', action: openPayLevel, keepScene: true}`; if `DepTourHomeMore`/`DepTourPages` are missing, those steps are left out (never throws). `filters` scene: `.dt-fpill` ×3 (`Ministry`, `Organisation`, `Location`), `.dt-qchip` ×4, `.dt-frow` ×8 rows, counter `.dt-fcount` 1,240 → 214 → 46 → 12; end state: Ministry pill text `Ministry · 2`, chips `Delhi/NCR` and `Closing in 7 days` have `is-on`, 3 rows remain visible, counter `aria-label` `12`.

- [ ] **Step 1: Failing tests** — update `HEADLINE`, `TITLES` (all eight), `test_scene_order`, `test_cta_opens_pay_level` (press → nine times), `test_force_play_loads_in_order` (new order); add `test_filters_end_state`, `test_steps_view_lists_every_step`.
- [ ] **Step 2–4:** RED → implement (`home-more.js` and `pages.js` may be empty stubs registering nothing until Tasks 3–4) → GREEN.
- [ ] **Step 5: Commit** `feat(tour): Home intro, filters step and new order`.

### Task 3: Home steps 4–7 (`home-more.js`)

**Interfaces:** `window.DepTourHomeMore = { scenes: [table, bookmark, alerts, theme] }`.
- `table`: `.dt-table` with header cells (`Post`, `Level`, `Ministry`, `Location`, `Days left`), 6 `.dt-trow`; end state: rows ordered by days left ascending, the `Days left` header has `is-sorted`, `.dt-table` has `is-cards` and each row's box is a card (height ≥ 1.6 × table-row height).
- `bookmark`: `.dt-heart` gets `is-saved`; `.dt-badge-count` `aria-label` `1`.
- `alerts`: `.dt-bell` gets `is-on`; `.dt-push` visible on `.dt-phone` with text containing `Level 8` and `Delhi`.
- `theme`: `.dt-theme-light` clip circle expands from the toggle (mid-scene radius > 0) and closes again (scene end radius 0).

- [ ] **Step 1: Failing tests** `test_table_sorts_then_becomes_cards`, `test_bookmark_counts_one`, `test_alert_arrives_on_the_phone`, `test_theme_wipes_to_light_and_back`. **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** `feat(tour): sort, views, bookmark, alerts and theme steps`.

### Task 4: Page montage (`pages.js`)

**Interfaces:** `window.DepTourPages = { montageScene }`; six `a.dt-page-card.dt-page-link` (order and hrefs from Global Constraints), each with `.dt-page-art` (mini animation) and title; final grid wide 3 × 2, tall 2 × 3, no overlaps, all inside the canvas; mini map uses `DepTourMap.data` states (no districts).

- [ ] **Step 1: Failing tests** `test_montage_cards_and_links` (6 cards, titles + hrefs in order), `test_montage_grid_layout` (wide: two rows of three, left-to-right order; tall: three rows of two; no overlaps). **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** `feat(tour): page montage and link finale`.

### Task 5: Visual pass, regression, docs, previews, PR

- [ ] Screenshot every step at 1440×900 and 390×844; fix what looks wrong (each fix with a test where behaviour is testable).
- [ ] Full tour suite and full project suite vs baseline.
- [ ] CHANGELOG `[Unreleased]` entry updated; HANDOVER block appended.
- [ ] Re-record desktop + phone previews; send to the owner.
- [ ] Open the **draft** PR (body from the stage-1 draft, updated).
