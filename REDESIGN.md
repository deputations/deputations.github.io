# alldeputations.com — Redesign Spec

Working spec for a staged redesign. Each phase is independently shippable.
Do not start a phase until the previous one is merged and verified.

---

> ## Status of this document
>
> **This is the durable copy.** The spec was written outside the repo (owner,
> from the live site) and lived only in a Claude session-outputs directory,
> which has since been cleared. Committed 2026-08-07 so a seven-phase project
> stops depending on a temp file.
>
> The owner's original text is preserved verbatim. Everything added afterwards
> is marked **[Amended 2026-08-07]** and is either a shipped-status note or a
> correction where the spec's assumption did not match the code. The spec was
> written from the outside, so some assumptions were always going to be wrong —
> those are corrections, not disagreements.
>
> | Phase | Status |
> |---|---|
> | 0 — Defects | **SHIPPED** `67a6acb` (items 1, 2). Item 3 re-tracked as `P3-10` |
> | 1 — Structural | Not started. Item 4 needs an owner call — see below |
> | 2 — Typography | **Unblocked**, ready to start |
> | 3 — Visual identity | **RESCOPED** — see the amendment in that section |
> | 4 — Eligibility lens | Not started (owner's stated priority) |
> | 5 — Deadline rail | Not started |
> | 6 — Motion | Not started. Item 23 depends on the Astro port; item 25 has no target |
> | 7 — Retention | Not started |
>
> Cross-references: `WEBSITE-REVIEW.md` §3 is the single source of truth for
> status. `P3-9` records the Phase 3 decision; `P3-10` carries the contrast
> work; `P1-6` records the standing "keep neon" decision.

---

## 0. Context

**Site:** alldeputations.com — searchable dashboard of Indian Central Government
deputation vacancies, sourced from Employment News and official circulars.

**Stack:** static site (HTML/CSS/JS), GitHub Pages. No build step currently.
Pages: `index.html`, `rules.html`, `faq.html`, `defex.html`,
`report-vacancy.html`, `contact.html`, `my-deputation.html`,
`upcoming-projects.html`.

> **[Amended 2026-08-07]** True of what *ships*, not of the repo. `astro/`
> holds a complete, dormant port — 384 per-vacancy static pages with
> `JobPosting` JSON-LD and build-time OG images (`P2-1`…`P2-5`). It has never
> run: `astro-build.yml` triggers on an `astro` *branch* that never held the
> port. `astro/src/pages/index.astro:37` hand-duplicates the homepage markup,
> so it drifts further with every phase. Tracked as backlog item **A3** —
> activate or delete.

**Primary user:** a serving government officer at a known pay level, checking
whether any currently-open deputation post is one they are eligible for, and how
long they have to apply.

**Core asset:** trust and data density (384 vacancies, source PDFs, the DeFeX
index). Not visual novelty.

---

## 1. Design direction

The current visual language is dark navy with neon cyan/magenta gradients and an
animated particle-mesh background. This is a widely-used template signature and
reads as generic. Adding more effects to it will not help.

Target direction: **institutional-modern**. Light base, high contrast,
typographic, hairline rules instead of glowing cards, a single accent colour
reserved for state (eligibility, urgency, focus). Reference points: a broadsheet
newspaper's data desk; Linear's density; government statistical publications.

In a category split between 2009-era HTML tables and neon dashboard templates,
restraint is the differentiator.

> **[Amended 2026-08-07] This direction was declined.** See the Phase 3
> amendment and `WEBSITE-REVIEW.md` `P3-9`. The neon identity is deliberate and
> stays; the same calm-down had already been declined once as `P1-6`
> ("keep neon — intentional brand identity"). Phases 1, 2 and 4–7 are
> unaffected — they are structural and functional, not aesthetic.

### Constraints

- Vanilla HTML/CSS/JS. No framework, no build step, no bundler.
- No new runtime dependencies without asking first.
- Progressive enhancement: every feature must degrade to a working table.
- Mobile-first. Officers browse on phones.
- Preserve all existing content, data shape, and URLs.

> **[Amended 2026-08-07]** The progressive-enhancement constraint cannot be
> *preserved*, because it is not currently met. There is no `<noscript>`
> anywhere in the repo and the table is built entirely by `renderTable()` into
> `innerHTML`, so non-JS clients and crawlers see `"Loading vacancies…"`. This
> is net-new work, and properly the Astro port's job. Tracked as **A2**.

---

## 2. Phases

### Phase 0 — Defects

Small, isolated, no design changes.

1. `1 days` in the deadline column — fix pluralisation.
2. Footer reads `© Deputations.github.io` on an `alldeputations.com` domain.
3. Gradient headline fails WCAG AA contrast on the dark background.

**Done when:** all three fixed, nothing else touched.

> **[Amended 2026-08-07] SHIPPED** as `67a6acb`, items 1 and 2.
>
> Item 1 lived at `app.js#formatDaysLeft`; an already-correct twin sat unused at
> `shared/vacancy-utils.js:76`, but importing it would have recoloured every
> deadline pill (three urgency buckets vs five), so the guard was restored in
> place and the duplication deliberately left for Phase 2 item 9.
>
> Item 2 was one string in `site-widgets.js#buildDisclaimer`, which feeds the
> footer on all 8 pages.
>
> **Item 3's diagnosis was inverted.** Measured at the real rendered size
> (40px/800 = WCAG *large* text, 3.0 threshold) against the real tokens, the
> gradient **passes** on dark (`#FF6B6B` 7.38, `#6B66FF` 4.85) and **fails only
> on light** (`#FF6B6B` **2.61**). Corroboration: `rules.html:539` already ships
> a `html[data-theme="light"] .gradient-text` override — that page hit this and
> fixed it locally. Re-tracked as `P3-10`, and now permanent debt rather than
> transitional, since Phase 3 item 12 no longer removes the gradient.

---

### Phase 1 — Structural fixes

4. **Remove the nested scrollbar.** The vacancy table currently scrolls inside a
   container while the page also scrolls. This is the worst usability problem on
   the site. Replace with sticky column headers and a single page-level scroll.
5. **URL-as-state.** Every filter combination produces a shareable permalink;
   loading that URL restores exact filter state. Officers forward these on
   WhatsApp — this is a distribution channel, not a convenience.
6. **Density toggle** — comfortable / compact / dense, persisted in
   `localStorage`.

**Done when:** one scrollbar on the page; filter state survives a copy-paste of
the URL into a fresh tab.

> **[Amended 2026-08-07]**
>
> **Item 4 reverses an owner-approved decision.** `style.css:6238` is labelled
> "P1-9b (M4, owner-approved)" and `WEBSITE-REVIEW.md` `P1-9` records "owner
> approved nested scroll". The wrapper exists *so that* the header row and the
> Post Name column can both pin. `thead th` is **already** `position: sticky` —
> the proposed fix is partly the current implementation. The hard part is the
> pinned first column, which needs the wrapper to be the horizontal scroller.
> Needs an explicit owner call before starting.
>
> **Item 5 is roughly half built.** `hydrateFiltersFromUrl()` (`app.js:765`)
> already parses ten params inbound — `search`, `myPayLevel`, `experience`,
> `level`, `ministry`, `orgType`, `region`, `location`, `status`, `quick`,
> `watchlist`. Missing: the write half, and a `popstate` handler.
> `history.replaceState` is currently used only for the `?v=` modal permalink.

---

### Phase 2 — Typography and rhythm

7. `font-variant-numeric: tabular-nums` on all pay levels, dates, and
   day-counts. Digits currently fail to align vertically down the column.
8. **Fix row jitter.** Organisation names wrap to two or three lines, so row
   heights vary. Clamp to one line with a title tooltip, or fix row height.
9. **Deadline typography.** `93 days` and `1 days` are currently typeset
   identically. Urgency should be readable from weight and colour before the
   number is parsed.

**Done when:** columns align optically; scrolling the table has an even rhythm.

> **[Amended 2026-08-07] Unblocked and ready** — this phase is
> palette-independent and was only ever waiting on the Phase 3 decision.
>
> Item 7: the idiom already exists in 8 places (`.kpi-value`, `.vx-date`, DeFeX
> tables) — it was simply never applied to the vacancy table's numeric columns.
>
> Item 9 is the right home for the `formatDaysLeft` / `getDaysLeftTone`
> duplication left in place during Phase 0.

---

### Phase 3 — Visual identity

10. Rebuild the palette in OKLCH. Ship `light-dark()`; light is the default,
    dark becomes opt-in.
11. Remove the animated particle-mesh background entirely. Do not restyle it.
12. Remove the gradient on the `DEPUTATION VACANCIES` headline. Single weight,
    high contrast.
13. Restrict the accent colour to state only — eligibility, deadline urgency,
    focus rings. Nothing decorative.
14. Consolidate navigation. Eight top-level items is too many; promote Home,
    Rules, DeFeX and move the rest to a secondary menu.

**Done when:** the page reads as authoritative rather than as a dashboard
template, at both breakpoints.

> ### **[Amended 2026-08-07] RESCOPED — see `WEBSITE-REVIEW.md` `P3-9`**
>
> This phase collided head-on with `P3-8` (Liquid Glass, `6a33b10`), whose
> entire premise is that the particle wave and blobs are *"real content to
> refract"*. Item 11 deletes exactly what that layer bends. The owner ruled by
> "whichever was suggested later": `liquid-glass.*` were written at 17:28 and
> committed at 17:34 on 2026-08-06, **after** the conflict was raised. Liquid
> Glass is the later decision and wins.
>
> | Item | Verdict |
> |---|---|
> | 10 — OKLCH, `light-dark()`, light default | **Cut.** Light-as-default contradicts the dark identity |
> | 11 — Remove particle mesh | **Cut.** Guts `P3-8` |
> | 12 — Remove headline gradient | **Cut as written.** Survives only as the contrast fix in `P3-10` |
> | 13 — Accent for state only | **Reduced.** Keep the decorative glass, but make deadline urgency the one signal that outshouts it |
> | 14 — Consolidate nav | **Kept in full.** Structural and palette-independent; mobile nav already overflows (M2) |
>
> Item 14 is wider than it looks: the `<nav>` block is hand-copied into all 8
> pages, and `site-widgets.js` separately injects the mobile hamburger.

---

### Phase 4 — Eligibility lens *(the priority feature)*

The user's pay level is currently buried in a dropdown labelled "Display
deputations for me." It should be the organising principle of the whole page.

15. Ask for pay level once; persist it.
16. Every row gets a gutter spine indicating **eligible / stretch / ineligible**.
17. Ineligible rows collapse to ghosted one-line summaries rather than
    disappearing. The user must be able to see that the full dataset is still
    there, and expand any ghost row.
18. Full keyboard path. Not pointer-only.

**Done when:** a user who has entered a pay level can answer "is any of this for
me?" in one screenful, without losing sight of the rest of the data.

> **[Amended 2026-08-07]** Unaffected by the Phase 3 decision — this is
> functional, not aesthetic.
>
> Item 15 **already exists**: `dep_profile_v1` in `localStorage`, read by
> `autoselectPayLevelFromProfile()` (`app.js:415`) and also used by
> `my-deputation.js` and `push-client.js`. The control is the *first* filter in
> the sidebar, so it is buried by visual weight rather than by position.
>
> Item 16: `enrich.js#isEligible` is **binary**. "Stretch" is new logic and
> needs a rule for how close counts.
>
> Item 17 **collides with pagination** (10 rows/page in table view, 9 in card).
> If ghost rows consume page slots the user sees ~3 real vacancies per page; if
> they do not, the page counts get strange. Needs a pagination answer first.

> ### [BUILT AND DEFERRED TO v2.0 — 2026-08-07]
>
> Phase 4 was implemented in full and **rejected on review by the owner**. It is
> not merged. The work is preserved on branch `phase-4-eligibility-lens`
> (commit `4c6bf7d`) — start there rather than from scratch, most of it is
> sound.
>
> **What the owner judged wrong, in their words:** ghost rows look messy, the
> results-line wording is wrong, and row heights / layout feel broken.
>
> **What was explicitly NOT wrong:** the gutter spine and the band chips. Item
> 16's visual treatment works and should survive into v2.0 unchanged.
>
> So the failure is concentrated in **item 17**, not the phase as a whole:
>
> - **Item 17's premise did not survive contact.** "Ineligible rows collapse to
>   ghosted one-line summaries rather than disappearing" reads well as a
>   principle, but on a real 54-row dataset the muted rows clutter the table
>   more than the hidden dataset cost. The pre-Phase-4 behaviour — a pay level
>   simply filters them out — was cleaner. v2.0 should either drop item 17 or
>   find a way to show "the rest is still there" WITHOUT interleaving it with
>   the rows you care about (a count, a collapsed block below the table, a
>   separate tab).
> - **The results line needs rewording.** `8 for Level 11 · 10 soon · 36 others
>   of 54` — the counts are the right information, the phrasing is not.
> - **Row heights must be flattened, not merely improved.** The build reduced a
>   93/110/127/304/362px spread to 93/110 and stopped, on the argument that
>   forcing uniformity costs ~20% more scrolling. The owner disagreed. Treat
>   uniform row height as a hard requirement in v2.0, not a trade.
>
> Worth keeping regardless of what happens to item 17, because none of it was
> the problem:
> - `enrich.js#eligibilityBand()` — the three-band classifier, including the
>   "right grade, short on service" definition of *stretch* that yields
>   "eligible in N years"
> - item 15's write-back to `dep_profile_v1` (`persistPayLevelToProfile`) —
>   this fixed a genuine bug where a sidebar pay-level choice was discarded on
>   reload
> - the `.sr-only` utility and its `!important`, and the Location-column clamp
>   (both fix pre-existing defects unrelated to the lens)

---

### Phase 5 — Deadline horizon rail

19. A brushable timeline strip pinned above the table. Each vacancy is a tick
    positioned by closing date.
20. Dragging a window along the rail filters the table by date range.
21. Keyboard equivalent required — arrow keys to move the window, not just
    drag.
22. Degrades to the existing date filter where unsupported.

**Done when:** the rail and the table stay in sync in both directions, and the
whole interaction is operable from the keyboard.

> **[Amended 2026-08-07]** **316 of 384 rows are already expired.** A rail
> spanning the real date range renders mostly past unless it scopes to Active.

---

### Phase 6 — Motion and polish

23. Cross-document View Transitions: a table row morphs into its detail page.
    Native API, no library.
24. Scroll-driven CSS animations via `animation-timeline: view()` — row reveals,
    and a reading-progress spine on the Rules pages. No JS scroll listeners.
25. Popover API + CSS anchor positioning for filter dropdowns, replacing native
    `<select>`. Needs a fallback.
26. `prefers-reduced-motion` guard across everything in this phase. Non-optional.

**Done when:** motion is present with the media query off, and completely absent
with it on.

> **[Amended 2026-08-07]**
>
> **Item 23 needs a second document to transition to.** The detail view is a
> `<dialog>` with a `?v=` permalink, not a navigation. The Astro port *does*
> build `/vacancy/{id}/` pages, so this item quietly depends on **A3** — or on
> abandoning the modal.
>
> **Item 25's premise does not hold.** `index.html` contains **zero** `<select>`
> elements. The filters have been custom widgets since `createMultiSelect`
> (`app.js:34`) and `createSingleSelect` (`app.js:182`), with their own focus
> handling and ARIA. This is a rewrite of working, accessible code — not an
> upgrade from native.
>
> Item 24 would replace 6 existing scroll listeners across `app.js`,
> `site-widgets.js`, `home-flourish.js` and `liquid-glass.js`.
>
> Item 26 is already honoured across `home-flourish`, `site-widgets`,
> `liquid-glass` and `hero-wave`.

---

### Phase 7 — Retention and cross-linking

27. **"Since you last visited" diff strip** — `6 new · 2 closed · 1 deadline
    extended`. Snapshot the vacancy list in `localStorage`, diff on load. No
    backend.
28. **DeFeX band chip in every vacancy row**, linking to that organisation's
    DeFeX profile. This is the one asset a competitor cannot clone; surface it
    in the main browsing flow.
29. **Per-vacancy application dossier** — a one-tap print stylesheet. Government
    users print documents and nobody in this category optimises for it.
30. **Saved searches** with notification opt-in. Pairs with 27.

> **[Amended 2026-08-07]** Unaffected by the Phase 3 decision.
>
> Item 27: `isNewVacancy()` (`app.js:1930`) already computes a 7-day NEW badge —
> adjacent, not the same thing.
>
> Item 28: data is ready in `data/defex/{organisations,scores,aliases}.json`.
> Note `Source_Ref` is already rendered as a badge in every row
> (`app.js:1331`) but is empty on all 384 rows — a nearby dead slot.
>
> Item 29: confirmed **zero `@media print`** anywhere in the repo. Genuinely
> greenfield, and the claim that nobody optimises for it holds.
>
> Item 30: the push infrastructure is **already built and dormant** —
> `push-client.js`, the `push-notify` Edge Function, and a daily cron. It waits
> only on the owner running `PUSH-SETUP.md` (migration + VAPID secrets).

---

## 3. Standing rules

- Verify each phase against a real browser before moving on. Take a screenshot
  at 390px and 1440px and compare to the previous state.
- Never break the no-JS path. The vacancy table must render and be readable with
  scripting disabled.
- Accessibility is a gate, not a phase: keyboard operability and WCAG AA
  contrast are checked at the end of every phase, not deferred to the end.
- Ask before adding a dependency, changing the data schema, or altering a URL.
- Keep commits scoped to a single numbered item where practical.

> **[Amended 2026-08-07]** Two notes on verifying, both learned the hard way:
>
> **The Browser pane renders nothing on the owner's machine** (hidden → no rAF,
> no screenshots, 0×0 viewport that trips `max-width` gates). Drive Chromium via
> `.venv-smoke` Playwright for anything visual.
>
> **Measure real pixels, and exercise the real code path.** A synthetic contrast
> model reported false failures everywhere during `P3-8`. The
> organisation-search impact in `6e0756f` was mis-measured twice by modelling
> `fuzzyIncludes` instead of driving the actual input. Both times the modelled
> answer was confidently wrong.
