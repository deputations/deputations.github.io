# CHANGELOG — version history

**Current version: `7.3.13` (2026-08-09).** The `VERSION` file at the repo root
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

## [7.3.13] — 2026-08-09
**Theme: neural loader for AI search latency.**
The semantic-search Edge Function takes 500–1500ms on a healthy
network and 3–6s on NIC (after the P3-7 proxy fix). Until now the
only feedback during that window was a tiny status line ("Finding
AI-ranked matches…"). This release adds a 6-node / 15-edge SVG
neural network above the AI search bar that emerges while the
request is in flight: nodes pop in one by one, edges draw between
them, the network pulses, a status text cycles every 1.3s through
four phases of intent extraction.

- counter: `style.css?v=ms70` → `?v=ms71`, `app.js?v=ms64` → `?v=ms72`
  on index.html only (the loader is scoped to the AI bar there)

**Changed**
- `index.html`: new `<div id="semanticLoader">` template injected as a
  sibling of `.ai-search-bar` inside `.ai-search-section`. Contains a
  240×160 SVG (gradient defs, two empty `<g>` containers the JS fills
  with nodes/edges), a `.semantic-loader-status` paragraph, and a
  `.semantic-loader-echo` line for the user's query. Hidden by default.
- `style.css`: ~140 lines for `.semantic-loader` + its keyframes
  (`sem-edge-draw`, `sem-edge-fade`, `sem-node-in`, `sem-node-pulse`,
  `sem-core-in`, `sem-core-pulse`), light-theme override (deeper
  navy + indigo dropshadow instead of cyan), and a reduced-motion
  fallback that collapses the animation to a static dot + plain status
  text.
- `app.js`: ~80 lines added in the semantic-search block —
  `SEMANTIC_STATUS[]` (4 messages), `SEMANTIC_NODE_POS[]` (6
  positions), `buildSemanticLoaderNetwork()` (idempotent SVG fill,
  15 edges with per-line `--len` for stroke-dasharray draw-in),
  `showSemanticLoader(query)` (reveal + start 1.3s status cycle),
  `hideSemanticLoader()` (fade-out + 300ms hidden). `runSemanticSearch()`
  now calls `showSemanticLoader(query)` after the Supabase probe
  succeeds and `hideSemanticLoader()` in the `finally` block.

**Verified**
- `node --check app.js` clean.
- Playwright DOM sweep at 4 checkpoints (load, after_typing,
  after_cycle_1, after_5s):
    - hidden=true at load
    - hidden=false + isActive=true after a 3+ char keystroke
    - edgeCount=15, nodeCount=6 (every node connected to every other)
    - status text cycled from "Understanding your request…" →
      "Extracting intent & filters…" within 1.4s
    - hidden=true, isActive=false after 5s (response resolved and
      loader auto-truncated)
- NIC safety: `showSemanticLoader()` is only called AFTER
  `ensureSupabaseAvailable()` returns true, so NIC users (who fail
  the TLS probe) never see the loader — they keep the existing
  "AI search unavailable on this network" message instead.

## [7.3.12] — 2026-08-09
**Theme: rewrite the "Why Deputation" copy on DeFeX.**
The `#manpower` section on `defex.html` (the rationale block that opens
the page above the explorer) carried a 6-paragraph prose version of
"why deputation is good for Government". Owner asked for a rewrite
that lands harder: lead with the "win-win" framing, name the human
incentives, walk the Government's logic in the same register, address
the lending-office concern head-on, and close with a quotable
declarative line ("deserves to be facilitated, not discouraged").

- counter: none (text-only, no asset bump)

**Changed**
- `defex.html` `#manpower-h` heading: "Deputation as a Tool for Better
  Manpower Utilisation" → "Deputation: A Win-Win That Deserves
  Encouragement".
- `defex.html` `#manpower` article body: 6 paragraphs + closing
  bold-line replaced with 7 paragraphs in the same shape — opening
  one-liner, 4 body paragraphs (mechanism, employee side, Government
  side, lending-office concern), one bridging paragraph on
  promotional stagnation, and the new bold closing.
- Inline `<a href="#manpower-foot">` on the phrase "have greater value"
  so the closing line is reachable from the body without scrolling
  hunt.

**Verified**
- Playwright DOM sweep on the running static server: heading reads
  "Deputation: A Win-Win That Deserves Encouragement", 7 paragraphs
  present in expected order, `#manpower-foot` anchor resolved.
- Section screenshot captured at `.tmp-navcheck3/defex-manpower-new.png`
  matches the supplied reference.

## [7.3.11] — 2026-08-10
**Theme: #manpower reveal at literal reading pace.**
Owner asked for ~230 wpm after 7.3.10's ~545 wpm. `WORD_MS` 110 → 260, so
242 words take **~63s** end to end.

This crosses a line the previous settings stayed on the right side of.
At 11ms, 55ms and 110ms the reveal outran reading, so it could never make
anyone wait for text. At 260ms it matches reading, so a reader following
along now sits at the leading edge rather than behind it. Flagged before
implementing; the owner reaffirmed. Raising `WORD_MS` back above ~150ms
restores the headroom.

The fade ratio inverts with it: 340ms → **200ms**, now deliberately
*shorter* than the stagger so each word settles fully before the next
begins. At the earlier fast staggers a long fade was what turned the
leading edge into a wave; at reading pace that same overlap would mean
asking the reader to read half-faded words. CSS `--word-ms` fallback
110ms → 260ms in step with the JS constant.

Cache-bust `defex.css` / `defex.js` `ms18 → ms19`.

Not separately verified, per the owner's standing request — the change is
the pace constant and its two paired values, on the code path 7.3.9 verified.

## [7.3.10] — 2026-08-10
**Theme: halve the #manpower reveal pace again.**
Owner asked to cut the pace to half after seeing 7.3.8's 55ms live.
`WORD_MS` 55 → 110, so 242 words now take ~27s instead of ~13s. Fade
220ms → 340ms to hold roughly a 3x ratio to the stagger — without that,
a wider stagger degrades the soft leading edge into words popping on one
at a time. The CSS `--word-ms` fallback moved 55ms → 110ms in step with
the JS constant.

Still above reading pace at ~545 wpm vs ~230 wpm, so the reveal continues
to stay ahead of the reader rather than making anyone wait for text.

Cache-bust `defex.css ms16 → ms18`, `defex.js ms17 → ms18`.

Not separately verified at owner's request — the change is the one pace
constant plus its two paired values, on the code path 7.3.9 verified.

## [7.3.9] — 2026-08-10
**Fix: the #manpower reveal could leave the copy permanently invisible.**
Caught while verifying 7.3.8 on the live site: the section reported as in
view, yet stayed at `data-typing="pending"` — every word at `opacity: 0` —
until something forced a scroll.

The flip from `pending` to `run` went through `requestAnimationFrame`.
A backgrounded tab parks rAF indefinitely, so the callback never ran, and
because the words are hidden until that flip, the whole essay rendered as
blank space. Opening the page in a background tab (middle-click, "open in
new tab") was enough to hit it. Present in 7.3.7 and 7.3.8.

- The observer path no longer uses rAF at all. Observer callbacks are
  delivered after the rendering step, so the `pending` styles have already
  resolved and the transition runs from a direct assignment. rAF survives
  only on the no-IntersectionObserver fallback, where the flip would
  otherwise coalesce into the same task as `pending` and skip the
  transition entirely.
- Added a 1s interval guard as a last line of defence: if the section is on
  screen but still hidden, it forces the reveal and stops itself. Timers keep
  running in a hidden tab; rAF does not. Missing the animation is fine —
  unreadable copy is not.
- The guard applies the *same* 5% visible-fraction test as the observer,
  shared through one `VISIBLE_FRACTION` constant. The first cut of the guard
  tripped on any single visible pixel, which overrode the observer threshold
  and played the reveal while the section was barely peeking in at the
  bottom of a short viewport — caught by the below-the-fold case.

Cache-bust `defex.js ms16 → ms17`.

Verified by parking `requestAnimationFrame` outright, which is exactly what
the defect is: against shipped 7.3.8 the copy sits at 0/242 words revealed,
`pending`, forever; with the fix it reveals normally. Plus foreground load
animates and settles 242/242, below-the-fold still waits for the scroll and
then reveals, and viewport heights 800/831/900/1000 all start at load.

## [7.3.8] — 2026-08-10
**Theme: slow the #manpower reveal to a followable pace.**
7.3.7 shipped the word-by-word reveal at an 11ms stagger — 242 words in
2.7s. Owner saw it live and said it was too fast to follow.

The stagger is now a single named constant, `WORD_MS = 55` in
`typeManpower()`, pushed to CSS as `--word-ms` so the value lives in one
place and `transition-delay: calc(var(--w) * var(--word-ms, 55ms))` reads
it. 55ms over 242 words is **13.3s** end to end — 5× slower. The fade also
went 150ms → 220ms, roughly 4× the stagger, so several words are always in
flight and the leading edge reads as a soft wave rather than words
snapping on one at a time.

On "normal reading speed": literal reading pace is ~230 wpm, i.e. 260ms a
word and a **63-second** animation, which is not a usable page effect. 55ms
is ~1,090 wpm — deliberately above reading pace. That is the property worth
keeping: the reveal always stays ahead of the reader, so it is visible as
typing but never makes anyone wait for text. Change `WORD_MS` alone to
retune; nothing else needs touching.

Cache-bust `ms15 → ms16`.

Verified: `--word-ms` applied, last-word delay 13.255s matching words × 55ms,
fade 0.22s, reveal front sampled at 1s/3s/6s/10s = 52/95/150/223 words
(gradual, never jumping to the end), settles fully visible, copy intact,
zero console errors.

## [7.3.7] — 2026-08-10
**Theme: full-width manpower section + word-by-word reveal.**
Follow-up to 7.3.6, same section. Owner asked for the copy to fill the
full width and for the text to type in word by word, fast, on load.

**Full width.** Dropped `max-width: calc(78ch + 4rem)` and
`margin-inline: auto` from `.dex-manpower-card`. The card now measures
1176px at a 1440px viewport — identical width and left edge to the
coverage strip and the hero above it. 7.3.6 had capped it to keep the
reading measure at 78ch; the owner asked for full width after seeing it,
so the cap is gone.

**Word-by-word reveal.** `typeManpower()` walks the section's text nodes,
wraps each word in `<span class="dex-type-w">` carrying its ordinal in a
`--w` custom property, then flips `data-typing` from `pending` to `run`.
CSS does the rest:

```css
.dex-manpower[data-typing="run"] .dex-type-w {
  opacity: 1;
  transition: opacity 150ms ease-out;
  transition-delay: calc(var(--w) * 11ms);
}
```

One attribute change drives all 242 words — no per-word timers. Only
opacity moves, so the words hold their space and nothing reflows. Total
run ≈ 2.7s plus the 150ms tail fade.

Details that matter:
- **Called pre-paint**, next to `applyScope()` at the bottom of the IIFE,
  not from `init()`. From `init()` the copy would paint at full opacity
  first and then snap to transparent before fading back in.
- **Splitting preserves whitespace** (`split(/(\s+)/)`), so wrapping cannot
  move a line break or detach punctuation from its word. The four `<strong>`
  runs survive intact — 55 of the 242 words sit inside them.
- **Starts on intersection**, which on desktop is immediately at load and on
  a phone waits for the scroll rather than playing to nobody.
- **`prefers-reduced-motion: reduce` skips wrapping entirely**, and the CSS
  carries a matching guard in case the preference changes after load.
- **The `[data-typing]` attribute only exists once JS has run**, so with JS
  off the copy is plainly visible — verified with `java_script_enabled=False`.

Span count (242) runs three above the token count (239) because trailing
punctuation sitting outside a `<strong>` is its own text node. There is no
line-break opportunity between a word and a following comma, so it renders
identically; the verified invariant is that no visible text is left
unwrapped, not that spans equal tokens.

Cache-bust: `defex.css` / `defex.js` / the in-file `V` constant `ms14 → ms15`.

Verified with an ad-hoc Playwright pass: no unwrapped text, contiguous
indices 0–241, bold runs intact, partial reveal mid-flight (a real
animation, not an instant paint), fully settled after the run, all copy
phrases byte-intact, card width equal to the coverage strip, reduced-motion
and no-JS fallbacks, zero console errors, and no horizontal overflow at
375px. `scripts/_verify_scope_limit.py` and `tests/test_defex.py` still pass
unchanged.

## [7.3.6] — 2026-08-10
**Theme: DeFeX Phase 1 — Ministries and Departments only.**
`defex.html` published all 561 mapped organisations: ministries and
departments alongside 169 attached offices, 117 autonomous bodies, 92
subordinate offices, 73 statutory bodies and 26 PSUs. The owner wants
only ministries and departments live for now, with the rest shown in a
later release, and wants the rollback to be trivial.

Implemented as a single fenced `SCOPE` object at the top of `defex.js`
(`/* ══ BEGIN scope-limit ══ */ … /* ══ END scope-limit ══ */`). The
filter is applied exactly once, in `load()`:

```js
state.allOrganisations = orgs;                       // untouched
state.organisations    = orgs.filter(o => SCOPE.has(o));
```

Everything downstream already read `state.organisations`, so the explorer
grid, hero search (the Fuse index is now built from the scoped list rather
than the raw fetch), leaderboard, both tab counts, the ministry filter, the
readiness-checklist dropdowns and deep-link resolution all follow with no
per-view code. **561 → 77** organisations · 51 ministries · 37 rated · 9
with an OM · 81 reports.

Three supporting pieces, all no-ops when the switch is off:
- **Counters.** The coverage strip used `updates.json`'s precomputed totals;
  `SCOPE.counts()` recomputes them over the visible set so the tiles cannot
  advertise 561 while the table shows 77.
- **Copy.** `SCOPE.copy` / `SCOPE.attrs` override the eight strings the limit
  invalidates — the hero lede ("or CCA"), the hero button and explorer `h2`
  ("Explore organisations" → "Explore ministries & departments"), the explorer
  sub, the first tile label, and the hero search placeholder, whose examples
  ("CBIC", "Railway Board") are now out of scope and would dead-end. Applied by
  `applyScope()` synchronously at the bottom of the IIFE — `defex.js` sits at the
  end of `<body>`, so the swap lands before first paint. `defex.html` keeps the
  full-coverage wording plus a pointer comment; it needs no edit to revert.
- **Disclosure.** A "Phase 1" note above `#explorer` says what is missing and
  why. An out-of-scope `#org=` deep link — a link shared before this landed —
  flips it to an amber "Not shown yet" state naming the organisation and its
  type, instead of failing silently.

One source-data quirk is pinned around: **Ministry of Railways (Railway Board)**
is typed `Attached Office` in the ingest xlsx, so a strict type filter deleted the
whole Ministry of Railways — rated, DeFeX 90, Deputation-friendly — from the view.
`SCOPE.alsoInclude` pins it by id and `SCOPE.typeLabel()` prints "Ministry" for it
so its card, suggestion row and drawer don't read "Attached Office" inside a
Ministries-only view. Fixing `type` in the source data makes both lines
unnecessary. No data file was touched.

**Reverting is `on: false`** — nothing else. That path was executed and verified
end to end, not just asserted: all 561 organisations return, the original copy
comes back, the note disappears, CBIC is searchable again, and the file diffs
clean.

### Also in this release, on the same page

**"Deputation as a Tool for Better Manpower Utilisation."** New prose section
(`#manpower`) directly below the DeFeX hero box, above the coverage strip —
owner-supplied copy, six paragraphs, three inline bold runs and a bold closing
statement set apart in a mint callout. The card is sized to the text rather than
the container (`max-width: calc(78ch + 4rem)`, centred) so the measure stays
readable instead of running the full 1240px like the disclaimer does.

**Readiness Checklist withdrawn.** The whole `#checklist` box and the hero's
"Check my readiness" button are commented out rather than deleted — uncomment
both fences and the feature is back, no other file needs touching.
`populateFilters()` and `bindChecklist()` now no-op when `#chk-ministry` is
absent (they threw on `null` before), so the markup is the only switch. The
`scripts/_verify_scope_limit.py` checklist assertion is likewise conditional and
re-arms itself if the section returns.

Cache-bust: `defex.css?v=ms12 → ms14`, `defex.js?v=ms12 → ms14`, and the in-file
`V` constant that busts `data/defex/*.json` (kept in step per its own comment).

Verified by `scripts/_verify_scope_limit.py` — 20 checks plus 1 skip covering
every rendered row and card, CBIC's absence from search, exact counter values,
all eight copy overrides, both deep-link paths and a zero-console-error sweep —
plus a second pass over the checklist removal and the new section (markup gone,
no `chk-` ids left, no dead `#checklist` anchor, section placed between hero and
coverage strip, all four bold runs intact, both themes, no horizontal overflow at
375px) and a real-Chrome run through the extension. `tests/test_defex.py` 4/4. The six
suite failures in `test_feedback_proxy` / `test_region_filter` /
`test_semantic_search` are pre-existing: confirmed identical on a stashed tree.

## [7.3.5] — 2026-08-09
**Theme: drop the inner table scrollbar.**
The dashboard table on desktop (≥769px) had `max-height: calc(100vh −
150px)` + `overflow-y: auto` on `.table-wrapper` — a leftover from
when result sets could be longer than the viewport. The table is now
paginated to a fixed small row count, so the inner scroll context
serves no purpose. Removed the cap; the page scrolls natively. The
P1-9b sticky header + sticky Post Name column still work because
`position: sticky` rides against any scroll context (including the
page itself). The existing top-of-page scroll-progress bar already
owns the "more data" signal.

- counter: `style.css?v=ms69` → `?v=ms70` on index.html only

**Changed**
- `style.css`: deleted `#dataContainer.view-table .table-wrapper {
  max-height: calc(100vh - 150px); overflow-y: auto; }` and
  the surrounding media-query comment block (which was describing
  the deleted rule). Replaced with a short comment explaining why
  the cap is gone.

**Verified**
- `node --check app.js` clean (no JS changes in this release).
- Playwright DOM sweep on the running static server at three scroll
  positions (top, 800px down, table-into-view). At every position
  `wrapper.scrollHeight == wrapper.clientHeight` → `innerScrollable
  = false` → no inner scrollbar. Sticky header `thead` position
  confirmed pinned to top of visible table (`head.t = 1px` after
  scroll, `head.t = 21px` when table is at viewport top).
- 384-row live dataset: dashboard renders identically; pagination
  controls, filters, modal all unaffected.

## [7.3.4] — 2026-08-09
**Theme: corner brand and hero refinement.**
The v7.3.3 corner (full site name "All Deputation Vacancies" + V² logo
inline) read as too busy. Two refinements were asked for: a cursive
stylised "All" prefix on the home hero that turns the headline into
"All Deputation Vacancies" with a lively superscript word, and a
quieter nav corner that keeps only the V² chrome logo and surfaces
the wording "a V² Product" as a hover tooltip on the logo. The
upcoming-projects page drops the corner logo entirely (the centre
hero already carries the V² artwork).

- counter: `style.css?v=ms68` → `?v=ms69`, `navbar.css?v=6` → `?v=7`
  on index.html + upcoming-projects.html (the only files where the
  hero / corner rules changed)

**Changed**
- `index.html` hero `<h1>`: split into `<span class="header-all">All</span>`
  + `<span class="gradient-text" data-tw>Deputation Vacancies</span>`.
  Added Great Vibes (Google Fonts) to the fonts URL for the cursive.
- `style.css`: new `.header-all` rule — Great Vibes at 1.6rem (1.3rem
  on ≤768px), `line-height: 1.6`, `padding-top: 0.9em`, `-4deg` rotate,
  multi-colour gradient (coral → violet → pink) painted via
  `background-clip: text`. `margin-right` 0.08em → 0.35em so "All"
  doesn't kiss the following word.
- `index.html`, `defex.html`, `contact.html`, `faq.html`,
  `my-deputation.html`, `report-vacancy.html`, `rules.html` nav brand:
  now `<a class="nav-brand" title="a V² Product"><img class="nav-brand-mark
  nav-brand-v2">…</a>` — just the chrome logo, with the brand wording
  as the native browser tooltip on hover.
- `upcoming-projects.html` nav brand: anchor removed entirely; corner
  intentionally blank (centre hero carries the V² art).
- `navbar.css`: deleted ~35 lines of dead `.nv2-pre` / `.nv2-post` /
  in-flow-logo gradient rules that v7.3.3 added — the spans those
  rules painted are gone.

**Verified**
- `node --check app.js` clean.
- Playwright DOM sweep on the running static server, dark + light
  theme, 4 pages × 2 themes = 8 captures. Nav corner resolves to:
  `brandCount=1` on home/defex/faq, `brandCount=0` on upcoming-projects.
  Brand anchor `title` attribute = `"a V² Product"` everywhere. The
  `.nv2-pre` / `.nv2-post` selectors return `null` (cleaned up). Logo
  `alt` = `"V² — V Square"` for a11y.
- "All" hero: `gapBetweenAllAndGrad = 7px` in both themes (was 0
  pre-fix).

## [7.3.3] — 2026-08-09
**Theme: the nav corner carries the website name and the V² brand.**
The nav brand block in the top-left used to be "D Deputations" — a
generic initial mark and a redundant label that already lived on every
page. Two changes were asked for: the website's actual name ("All
Deputation Vacancies", matching the hero headline) instead of the
placeholder word, and the existing V² chrome logo
(`/assets/brand/v2-logo.png`, already in use on the Upcoming Projects
hero) instead of the hand-drawn cyan→violet "D" mark.

- counter: `navbar.css?v=2` → `?v=3` on every page that loads it
  (index + 7 secondary pages)

**Changed**
- Nav brand `<a class="nav-brand">` block, on **all 8 HTML pages**
  (index, defex, contact, faq, my-deputation, report-vacancy, rules,
  upcoming-projects): replaced the inline `<svg>` "D" mark with an
  `<img src="/assets/brand/v2-logo.png" class="nav-brand-mark
  nav-brand-v2" alt="V² — V Square">`, and the brand name from
  "Deputations" to "All Deputation Vacancies". The `aria-label`
  matches the visible name.
- New `.nav-brand-mark.nav-brand-v2` modifier in `navbar.css` turns
  off the default `border-radius: 9px` + cyan glow that the SVG mark
  had. The PNG carries its own chrome V silhouette and transparent
  background — the rounded mask clipped the artwork's outer edges and
  the cyan glow produced a halo that fought the artwork's white
  highlights. Both now reset to `none` for the PNG variant only.

**Verified**
- `node --check app.js` clean.
- All 8 pages load `/assets/brand/v2-logo.png` (Playwright DOM sweep
  on the running static server, 8/8 success). Rendered dimensions
  32 × 32, natural 400 × 400. `aria-label="All Deputation Vacancies
  — home"` present on every page.

## [7.3.2] — 2026-08-09
**Theme: the badge gets a short form.** The 7.3.1 badge restored the full
edition string ("Employment News 30 May - 5th June 2026") under every Source
PDF link. That string clips inside the 108 px table cell — visible truncation
on most rows. The fix: keep the full source category in the tooltip, render
only `EN- DD Mon YY` in-cell so the cell fits and the tooltip stays one
consistent label everywhere.

- counter: `app.js?v=ms63` → `app.js?v=ms64` on `index.html`
- counter: `style.css` unchanged

**Changed**
- New `formatSourceBadgeShort(item)` helper (`app.js:885`) is the single
  source of truth for both the cell text and the tooltip, mirroring the
  modal's phrasing. Returns `{ short, full }`:
  - `short` — `EN- DD Mon YY` for Employment News rows whose category
    carries a day + month + year; falls back to the category with the
    "Employment News" wrapper replaced by `EN- ` otherwise; non-EN
    categories are passed through untouched.
  - `full` — the unedited `Source Category` (with a `p${page} of ` prefix
    when `Source_Page` is present). This is what the tooltip shows.
- Both the **table cell** (`app.js:1400-1403`) and the **card foot**
  (single at `app.js:2530` + 2547, grouped at `app.js:2640`) now read
  from `formatSourceBadgeShort`. Cell text is `b.short`, `title=` is
  `b.full`. The legacy `formatSourceBadge(item)` helper is retained for
  any external caller and currently has no callers in `app.js` — left in
  for one cycle in case the modal or admin views want it later.

**Fixed**
- Table-cell source badge clipping. The 7.3.1 badge rendered the full
  edition string at 0.6rem inside a 108 px cell; "Employment News
  30 May - 5th June 2026" overflowed on every row, getting cropped to
  "EN 30 May-5 Jun 20…" with no ellipsis. Now the cell shows "EN- 30
  May 26" — fits cleanly, with the full text one hover away.

**Verified**
- `node --check app.js` clean.
- Playwright DOM sweep on the running static server:
  - Table: all 10 rendered badges have `truncated=false`. Coverage
    spans four edition shapes:
    | Source Category | Short |
    |---|---|
    | `Employment News 30 May - 5th June 2026` | `EN- 30 May 26` |
    | `Employment News (11-17 Apr 2026)` | `EN- 11 Apr 26` |
    | `Employment News 20th-26th June 2026` | `EN- 20 Jun 26` |
    | `EN 25 Apr 2026` | `EN- 25 Apr 26` |
  - Card view: same compact form; title attribute carries the full
    `Source Category` on every row.
- Manual visual check: badge stays inside the cell on every row in
  the table; tooltip text matches what the modal shows for the same row.

## [7.3.1] — 2026-08-09
**Theme: a missing badge comes back, and WhatsApp gets its own button.**
Both changes are small, but both were visibly broken — the EN-edition badge
that used to live under every Source PDF link had stopped appearing because
the renderer was keyed on a field that the data pipeline no longer populates,
and the WhatsApp share was reachable only from inside the modal. Together
they restore two affordances that the dashboard had quietly lost.

- counter: `app.js?v=ms62` → `app.js?v=ms63` on `index.html`
- counter: `style.css` unchanged (no asset bump needed; new rules ride the
  same `?v=ms62`)

**Added**
- WhatsApp share button beside the existing Share button on every card
  (single card + grouped card), using the already-present `#i-whatsapp`
  glyph from the icon sprite. New `data-card-action="share-wa"` branches
  off the existing delegated click handler — opens
  `https://wa.me/?text=${encodeURIComponent(buildShareText(item))}` using
  the same body text the modal's WhatsApp button uses (`app.js:1194-1199`).
  Same WhatsApp-green tint and hover state as the modal's `.share-wa`
  button, with light-theme override for parity.

**Fixed**
- EN edition + page badge restored under the Source PDF link in **table view**
  and **card view** (single + grouped). The modal already showed it (since
  `6f0102d`); the table and card branches had been keyed on `item.Source_Ref`
  — a field that is empty on every row in the live dataset, so the badge
  never fired. New `formatSourceBadge(item)` helper (`app.js:865`) is the
  single source of truth, mirroring the modal's phrasing: renders
  `pNN of <edition>` when both fields are present, just `<edition>` when
  only the category is, and nothing when both are absent. Today every badge
  renders the edition string only (e.g. `EN 30 May-5 Jun 2026`); the
  `pNN` prefix appears automatically the moment any row carries a
  `Source_Page`.
- Card-view badge wrap behaviour: `.vx-src` previously used `white-space:
  nowrap` + `text-overflow: ellipsis`, so the longer "p33 of EN 30 May-5
  Jun 2026" string would have been cropped. Switched to a 2-line `-webkit-
  line-clamp` so the badge always shows in full, with a sensible cap.

**Verified**
- `node --check app.js` clean.
- Full smoke suite at baseline + with the patch: same 5 pre-existing
  failures (1 feedback-proxy ×2 — locator ` .sw-fb .like` not found; 3
  region-filter; 1 semantic-search offline-mode), none of which touch the
  table cell, card view, modal, or share dispatch this release changes.
  A/B-verified by stashing the patch and re-running — every failure
  reproduces identically without the changes. The watchlist 0→1 test
  flake that fires only under full-suite load (per P3-4 gotchas memory,
  handover `shq-2026-07-31-006`) passed cleanly on the dedicated rerun.
- 37 of the remaining 40 tests pass (the 3 not in the pre-existing set
  are the watchlist re-run that's a known flake, and the 2 feedback-
  proxy tests which fail at baseline).

---

## [7.3.0] — 2026-08-06
**Theme: the glass is real now.** The dashboard has looked like a glass UI
since 1.0. It wasn't one. Five of the six "glass" surfaces were translucent
fills with no optical layer at all — verified against the live site with
computed styles before a line was written:

| surface | before |
|---|---|
| `.top-nav` | `blur(22px) saturate(1.55)` — the only real glass on the page |
| `.filters-sidebar` | `backdrop-filter: none` |
| `.ai-search-bar` | `backdrop-filter: none` |
| `.kpi-card` ×4 | `backdrop-filter: none` (`.97` alpha — effectively opaque) |
| `.toolbar-line` | `backdrop-filter: none` |
| `.data-table thead th` | frosted at `style.css:4738`, then explicitly killed at `:4789` |

Meanwhile a three.js particle wave and three blurred brand blobs sit behind
everything — real content to refract, unused until now.

- counter: `liquid-glass.css?v=1` `liquid-glass.js?v=1` (new files; no
  `style.css` / `app.js` change, so `ms58` is unchanged)

**Added**
- `liquid-glass.css` + `liquid-glass.js` — a fenced, self-contained optical
  layer on `index.html`, in the same shape as `hero-wave` and `home-flourish`.
  Deleting the two lines inside the `<!-- BEGIN/END liquid-glass -->` fences is
  a complete revert. `style.css` is **not touched** — at 6,519 lines with the
  table header defined three separate times, editing it in place was the
  larger risk.
- Five composited layers per surface, not a blur filter: backdrop
  (blur + saturate + brightness), pointer-angled tint, a rim lens carrying its
  *own* `backdrop-filter` masked to an 8px border band, chromatic aberration
  whose cyan/violet fringes slide in opposite directions with the cursor, and
  a pointer-tracked specular highlight.
- Capability ladder on `<html>`, so nobody gets a broken page:
  `lg-on` (frost + rim + depth) → `lg-fx` (pointer/scroll reactivity) →
  `lg-refract` (SVG `feDisplacementMap` refraction on the AI bar and stat
  cards; Chromium-only, feature-detected). Below the bar — no
  `backdrop-filter`, `prefers-reduced-transparency`, ≤768px, `saveData`, or
  `deviceMemory < 4` — the previous look renders untouched.
- The nav *thickens* as content passes under it: blur 22→34px, tint and
  shadow all interpolating on scroll depth.
- One rAF engine with passive listeners and an `IntersectionObserver`, so
  off-screen surfaces cost nothing. It reuses the `--hf-mx`/`--hf-my` pointer
  variables `home-flourish.js` already publishes rather than adding a second
  tracker over the same cards.

**Changed**
- Stat cards are translucent again, reversing `home-flourish.css:122` (which
  had forced `.97` alpha because the wave bled through). Legibility is bought
  back on the *text* instead of the opacity: a centre scrim behind the number,
  a lifted metallic ramp, and brighter labels. The glass stays bold at the
  edges where the wave actually reads.
- `--lg-tint-scale` in `:root` is a single knob for the whole system — lower it
  to walk every surface back from bold toward calibrated at once.

**Fixed**
- `.kpi-title` contrast **2.43:1 → 6.08:1**. It was below the WCAG AA floor
  *before* this release; the audit done for the glass work surfaced it.

**Verified**
- Contrast measured from real rendered pixels against a disabled-layer
  baseline, both themes, 1440 + 1920: every label passes AA. Deltas —
  `kpi title` 2.43→6.08, `results count` 6.94→7.39, `ai hint` 7.29→11.23,
  `kpi value` 9.94→9.70.
- Smoke suite shows no regressions: the failures present are identical with
  the layer stashed out, and `test_watchlist` / `test_my_deputation` fail at
  baseline too (data-dependent flakes).
- Mobile confirmed fully opted out — no `backdrop-filter`, no injected SVG
  filter, zero page errors.

**Known / open**
- **The sticky table-header blur has never been measured on real GPU
  hardware.** It sits behind a runtime A/B frame probe (`measureStickyCost`)
  that compares median frame time with and without the blur while nudging the
  scroller 1px, caches the verdict in `localStorage.dep_lg_thead_v1`, and is
  fail-safe: no measurement means no blur. Headless software rendering always
  declines it. On a real GPU it should enable itself on first visit.
- Light-theme table-header text measures 4.42:1, below AA. Pre-existing —
  it measured *exactly* 4.42 on the baseline — so it was left alone rather
  than folded into this release.

---

## [7.2.0] — 2026-08-04
**Theme: the NIC verdict.** The reverse proxy built in 7.0.0 was finally
tested from inside a NIC office machine. It does not work there. This
release records that finding and makes the dashboard say so honestly.

- counter: `app.js?v=ms58` `style.css?v=ms58` `site-widgets.js?v=25`

**Changed**
- The AI search bar now carries its own unavailability notice in the
  placeholder — "Unavailable in NIC network — use keyword search" — with the
  bar dimmed and the "AI-POWERED" badge dropped. Previously the only signal
  was a page-level banner above the KPI grid, far from where the user was
  about to type — `01b78a9`

**Verified (P3-7 PR 2 — NEGATIVE result)**
- `sb-proxy.ncrsarkarishaadi.workers.dev` is unreachable from NIC. Two
  independent test runs from inside the network agree on the outcome and
  describe the same block at different layers — `fc15248`
  - **Where it starts (DNS):** NIC's resolver sinkholes the request into its
    walled garden — `sb-proxy.…workers.dev` → CNAME `e.wg.restricted.in` →
    CNAME `e.walledgarden.nic.in` → A `10.40.124.9`, with SOA
    `phishing.domain.clean-pipe.in`. The **entire `workers.dev` apex** is
    blocked, not just this subdomain: the bare apex and
    `ncrsarkarishaadi.workers.dev` resolve to the same sinkhole.
  - **How the browser reports it (TLS):** Chrome logs four
    `net::ERR_SSL_PROTOCOL_ERROR` entries against the proxy host — the
    sinkhole answers on 443 but cannot present a valid certificate for the
    requested name. Same event, one layer up.
  - **Scope:** `cloudflare.com` and `cloudflareworkers.com` resolve
    normally, so Cloudflare is not blocked as an operator —
    `workers.dev` is blocked as a *category* (free app-hosting). Swapping
    Supabase for a Worker traded one blocklisted domain for another.
- Dashboard behaviour on NIC is correct and usable: `ensureSupabaseAvailable()`
  returns false, the same-origin `data/vacancies.json` snapshot loads all 384
  vacancies, filters and sorting work, bookmarks persist locally.
- What is lost on NIC: live data freshness (up to 24 h stale), the visitor
  counter (hidden by the 3-strike breaker), AI search, and server-side
  sentiment votes (the heart fills optimistically but the RPC never lands).

**Notes**
- ⚠ This supersedes the diagnosis carried since 6.1.0 that NIC runs an
  SSL-inspecting middlebox defeating TLS 1.3 + post-quantum + ECH. The
  handshake failure is real but it is a *symptom*; the block originates at
  DNS. `workers/sb-proxy/README.md` still describes the old theory.
- `alldeputations.com` itself resolves normally on NIC. Because the block is
  per-domain categorisation, a `api.alldeputations.com` custom domain
  inherits an already-uncategorised apex — which makes the Wix → Cloudflare
  apex migration the actual candidate fix rather than a hopeful one. Still
  unproven: SNI-level filtering has not been ruled out.
- Side effect worth knowing: any other site on `*.workers.dev` is equally
  unreachable from NIC machines.

---

## [7.1.0] — 2026-08-03
**Theme: making the AI search number mean something, plus a run of layout
and offline-path fixes.** The largest single-day release so far.

- counter: `app.js?v=ms56` `style.css?v=ms57` `site-widgets.js?v=24`
  `config.js?v=sb3` `my-deputation.js?v=sb6` `enrich.js?v=sb14`

**Layout**
- fix: **the mobile dashboard was squeezed into a 34px strip.** The
  collapsed-filters `grid-template-areas` override — added alongside the AI
  search row — sat *outside* the `@media (min-width: 769px)` gate that scopes
  the rest of that experiment. `filters-collapsed` is the default body class,
  so on phones `.main-layout` grew an implicit second column: the sidebar
  collapsed to its 34px min-width (padding + border, contents clipped by
  `overflow:hidden`) and the KPI strip, AI bar, toolbar and vacancy list were
  all crammed into a 293px column beside it. Verified at 375 / 768 / 1440 CSS
  px with no horizontal overflow — `065c6d9`
- **Ultra-wide monitors open with the filters sidebar expanded.** Ministry
  desktops are commonly 1920px+, where the full sidebar and the whole table
  fit side by side; the compact "My Pay Level" card was leaving that room
  unused and hiding eight filters behind a click. An inline boot script runs
  before first paint (no collapsed→expanded flash) and drops the body class
  at `min-width: 1600px` — the point where 300px of sidebar plus the table's
  1100px intrinsic width still clears the container padding. Toggling remains
  a per-visit choice; nothing is persisted — `d8acead`

**AI search**
- **Relevance is now a calibrated percentage, not raw cosine similarity.**
  The old display showed the bare number, so an exact post-name match read
  "0.64" and looked like a failure. It wasn't: each vacancy is embedded as
  its *whole record* (post name + ministry + location + level + eligibility +
  job description, ~100 words), so a five-word query only ever overlaps a
  fraction of it. The scale has both a low ceiling and a high floor. The band
  the corpus actually occupies is now rescaled onto 0-100% and clamped, drawn
  as a percentage over a proportional bar, with raw cosine on hover —
  `0f9c634`
  - An intermediate attempt normalised against the top hit (best = 100%,
    rest in proportion). Rejected after testing: it compressed everything
    into 75-100% and made an unrelated Director General read 90%.
- **Retrieval switched to asymmetric embeddings** — `RETRIEVAL_DOCUMENT` for
  the corpus, `RETRIEVAL_QUERY` for the query — instead of leaving both on
  the API default, which is tuned for comparing texts of similar shape.
  Vectors from different task types are not comparable, so
  `build_embeddings.py` records the task type it used in
  `semantic_search_state.embed_task_type` on *complete runs only*, and the
  Edge Function reads that key before deciding what to send. A half-finished
  migration degrades to the previous behaviour rather than returning
  nonsense — `0f9c634`
- **Relevance band recalibrated against the re-embedded corpus:**
  `RELEVANCE_FLOOR` 0.55, `RELEVANCE_CEIL` 0.73. Measured from live queries —
  exact-title matches peak at 0.704 / 0.713 / 0.727, while nonsense and
  off-domain queries still peak at 0.531 / 0.544 / 0.553 (a query the corpus
  can't answer still returns its ten nearest rows, which is why the floor
  sits there). Sample results after: "senior vice president in finance" →
  86 / 37 / 28 / 21 / 16; a nonsense query → all 0% — `57cf770`
  - The corpus re-embed happened unnoticed: `build-data.yml` has a push
    trigger on `paths: scripts/**`, so committing `build_embeddings.py`
    re-embedded everything immediately.
- fix: the result sub-line was HTML-escaped twice — parts were escaped
  individually and then escaped again on join — rendering "Micro, Small
  &amp;amp; Medium Enterprises" — `0f9c634`
- fix: the ranked-matches panel didn't clear when the input was emptied
  (a race against the in-flight fetch) — `1f738e9`

**Offline / NIC path**
- **The offline-mode banner was removed entirely.** A once-daily vacancy
  refresh doesn't warrant a persistent notice; the AI bar now carries the
  only message that mattered. Markup, CSS and both JS call sites that unhid
  it are gone; the `is-supabase-down` body class remains, since the AI bar's
  dimming hooks off it — `55f004b`, `95d76c4`
- fix: **`my-deputation.html` bookmarks vanished on blocked networks.** The
  page reported "N bookmarked vacancies are no longer in the current list
  (likely closed or removed)" while the header still counted them.
  `fetchVacancies()` branched on `SUPABASE_READY()`, which only checks the
  URL and anon key *look* valid — they do on NIC, where the block is a DNS
  sinkhole, not a malformed config. So it took the Supabase branch, the
  cross-origin fetch rejected, `loadVacancies()`'s `.catch` left `vacancies`
  empty, and reconciliation against an empty list marked every bookmark
  stale. Now JSON-primary with Supabase gated on the reachability probe —
  the same fix `index.html` received in 5.0.0 — `9f20e09`
- fix: **the feedback heart no-opped on production.** `site-widgets.js`'s
  `SB_OK` used a hard-coded `supabase.co` regex that rejected the
  `workers.dev` proxy URL introduced in 7.0.0; it now delegates to
  `SUPABASE_READY()` — `8f302dc`

**Data / filters**
- fix: **Region filter blank and every Pay Level count identical.** A
  regression from `c9557e4` (5.0.0), which removed the JSON enrichment step
  and never restored it — `build_data.py` does not compute `Region` or
  `eligibility_tiers`. Added `enrich.js#backfillDerived`, a narrow
  Title_Case-aware backfill, called on JSON rows in **both** fetch branches
  (the first fix only patched one) — `e3b3139`, `0aef1b6`

**Infrastructure**
- ci: **removed the "Mirror data onto gh-pages" step** from
  `build-data.yml`. It had failed on **all 21 runs since it was introduced**
  — it never once succeeded. Two stacked bugs: the bootstrap fallback ran
  under `bash -e`, where `git branch -D gh-pages` exits 1 on a missing branch
  and kills the subshell before the worktree add is reached; and even if
  reached, `--detach` and `-b` are mutually exclusive. Removed rather than
  repaired, because nothing consumes `gh-pages`: `astro-build.yml` publishes
  an uploaded artifact rather than a branch, the Astro build reads
  `data/vacancies.json` at *build* time so a mirrored file couldn't refresh
  generated pages anyway, and that workflow has never run. First green
  build-data run since 2026-07-29 followed — `0465bef`
- `sb-proxy` downgraded from Workers Paid ($5/mo) to Free. The paid plan was
  only needed for WebSocket egress, and the live Realtime toast is redundant
  given the 60 s polling fallback — `a15845c`

---

## [7.0.0] — 2026-08-02
**Theme: a network-layer attempt to reach Supabase from inside NIC.**
Superseded by 7.2.0, which found the approach doesn't work there.

**Added**
- **Cloudflare Worker reverse proxy** at `workers/sb-proxy/` — a transparent
  pass-through that forwards every request to Supabase unchanged: apikey,
  Authorization header, body and query string all preserved, with CORS
  layered on top so the browser doesn't see a missing
  `Access-Control-Allow-Origin` on Edge Function responses. Covers all four
  surfaces the dashboard uses: REST tables, RPC, Edge Functions, and
  Realtime WebSocket upgrade — `9ed284c`
  - `cf-*`, `x-forwarded-for` and `Host` are stripped on the way upstream;
    `Set-Cookie` and HSTS are stripped on the way back.
  - Upstream failure returns a 502 with CORS intact rather than a bare
    network rejection.
  - 7 unit tests (plain `node --test`, no Playwright) cover GET/POST
    forwarding, header stripping in both directions, the 502 path, and the
    WebSocket upgrade.
- `config.js` rewrites `window.SUPABASE_URL` to the Worker when the page is
  served from `alldeputations.com` (or its `www` variant); every other host
  — github.io, localhost, dev — keeps the direct Supabase URL. One URL that
  flips itself by hostname, so no call site needed editing.
- Deployed to `sb-proxy.ncrsarkarishaadi.workers.dev` and verified end to
  end from a home network — `dab4e24`

**Notes**
- ⚠ The intended host was `api.alldeputations.com`. That is **blocked at the
  zone level, not merely pending**: Workers Custom Domains require the apex
  zone to be on Cloudflare, and `alldeputations.com` is on Wix DNS
  (`ns10/11.wixdns.net`). Confirmed via the Cloudflare API —
  `/zones?name=alldeputations.com` returns `total_count: 0`. A new API token
  with `Zone:DNS:Edit` would be necessary but **not sufficient**; the zone
  itself has to migrate first — `04554da`
- The reasoning that justified the workers.dev host — that it sits on "the
  same Cloudflare trust path" as `alldeputations.com` — turned out to be
  wrong. NIC filters by domain category, not by trust path. See 7.2.0.

---

## [6.1.0] — 2026-07-31
**Theme: AI semantic search ships, plus the first NIC-aware behaviour.**

- counter: `app.js?v=ms46` `style.css?v=ms52`

**Added — AI semantic search (P3-3, four PRs)**
- Migration `0016_semantic_search.sql`: the `pgvector` extension,
  a `vacancy_embeddings` table (vacancy_id PK, `vector(768)`, model,
  updated_at), an HNSW cosine index, a `semantic_search_state` key/value
  table for the soft-disable flag, and a `search_vacancies()` RPC
  (SECURITY DEFINER, granted to anon) that returns top-K by cosine distance
  and filters the join to `status in ('Active','approved')` — `8f85d52`
- `scripts/build_embeddings.py`: bulk-embeds ACTIVE vacancies with Gemini
  `gemini-embedding-001`, truncated to 768 dims via `outputDimensionality`,
  and upserts them via PostgREST. Runs in the daily cron. On HTTP 429 it
  writes `disabled_until = tomorrow 00:00 UTC` and exits cleanly; the next
  successful run clears the flag.
- `semantic-search` Edge Function: embeds the visitor's query, calls the
  RPC, hydrates the results with public vacancy fields, and returns them
  with a score. Free-tier guards on both ends — a cheap DB pre-check before
  any Gemini call, auto-disable on 429, and a 200-entry in-memory LRU that
  dedupes repeat queries — `ff83c06`
- PR 4 relocated the UI: the sidebar `✨ AI` toggle chip was replaced by a
  dedicated full-width search bar directly below the KPI grid. AI search is
  now always-on with no toggle, and the sidebar keyword input remains a
  separate, independent path — `87d32c8`, `4053a67`
- Ships with a documented **negative**: the score shown was raw cosine
  similarity, which reads far lower than users expect. Addressed in 7.1.0.

**Added — FAQ discrepancy reporting (P3-6)**
- Migration `0015_faq_discrepancies.sql`, new branches in the `submit` Edge
  Function, and `faq.html` wired to Supabase so readers can flag incorrect
  answers; friendlier empty/error copy on the public list — `d867634`,
  `f2478f3`, `66318e3`

**Added — NIC awareness (P3-7 PR 1)**
- `window.ensureSupabaseAvailable()`: a one-time HEAD probe to `/rest/v1/`
  with a 2 s timeout. Any HTTP response — even a 401 — means the connection
  completed; a rejection means Supabase is unreachable from this network.
  Every Supabase consumer can now short-circuit instead of retrying, which
  is what silenced the console spam on locked-down networks — `061b503`
- An offline-mode banner appeared when the probe failed (removed again in
  7.1.0 once the AI bar carried the message itself).
- fix: the feedback widget's heart and thumbs-down are rendered
  unconditionally. Gating them on the probe hid controls users expected to
  be there — `58215de`

**Changed**
- P3-7 PR 3 bookmark UX: header pulse on first bookmark, a "stored on this
  device" hint so nobody expects cross-browser sync, a count-aware
  aria-label, and watchlist smoke tests — `bb54b91`

**Fixed**
- `vacancy_embeddings.vacancy_id` aligned with the `vacancies` table —
  `2f3d9e5`
- Gemini `embedContent` URL was malformed — the `/` before the model name
  and the `:embedContent` suffix are both required, and Gemini returns a
  404 with an empty body if either is missing — `3d13d58`
- PostgREST upsert used PATCH-with-filter, which only updates matching rows
  and therefore no-opped against an empty table. Switched to POST +
  `Prefer: resolution=merge-duplicates` — `55b479c`

---

## [6.0.0] — 2026-07-30
**Theme: an Astro port for SEO, and the first automated test coverage.**

**Added — Astro port (P2, four checkpoints)**
- P2-1 scaffold: `Layout.astro` (one source of truth for `<head>`, theme
  bootstrap, skip-link, scroll-progress), `Navbar.astro` (auto-active via
  `Astro.url.pathname`, replacing eight hand-rolled copies),
  `IconSprite.astro` (all 26 icon symbols in one place, previously pasted
  into every HTML file), `Footer.astro`, and an `astro-build.yml`
  workflow — `c2d995c`
- P2-2: all 8 pages ported. `InlinePageBody.astro` reads each static HTML
  file at build time and strips scripts/links, so every Astro page stays
  30-50 lines instead of duplicating 300-3000 lines of markup — edits to
  the static HTML propagate on rebuild. Internal links are rewritten from
  `/foo.html` to `/foo/` to match Astro's directory output, and a 404 page
  redirects legacy bookmarks — `6c95e01`
- P2-3: **per-vacancy static pages** — one `dist/vacancy/<id>/index.html`
  per row, each carrying `JobPosting` JSON-LD (datePosted, validThrough,
  hiringOrganization with parentOrganization for the ministry, jobLocation,
  and qualifications assembled from the eligibility fields). Status is
  recomputed per page rather than trusting the JSON's stale `Status`
  string. `scripts/build_sitemap.py` regenerates a 392-URL sitemap on every
  cron run — `eb349e3`
- P2-4: **build-time OG images** — one 1200×630 PNG per vacancy rendered
  with Pillow (brand gradient strip, wordmark, post name, ministry, and
  level/location/closing-date pills). Chosen over satori+resvg to avoid a
  heavy npm stack, since Pillow was already a cron dependency. `og/` is
  gitignored — 14 MB of PNGs daily would bloat git history — `277f1d6`

**Added — test coverage (P3-4, five PRs)**
- Playwright smoke suite covering index, defex, report-vacancy, contact,
  my-deputation, faq, rules, the admin login, and redirects — plus a drift
  guard asserting `tests/fixtures/constants.py` still mirrors `config.js`,
  so stubs can never silently point at the wrong Supabase project —
  `c5366ba`, `b027e5d`, `8791f0a`, `98f800a`, `6dc4658`

**Removed**
- P3-5: the Apps Script runtime fallback is retired. The Supabase `submit`
  Edge Function is now the single backend for every form and the visitor
  counter. Failures surface immediately instead of being silently masked by
  a second path — `411206c`

**Fixed**
- push-client: the pay-level `<select>` options were unthemed and unreadable
  in dark mode — `885b4f7`

**Notes**
- ⚠ GitHub Pages still serves `main`. The Astro build is complete but
  **inert** — and, as discovered in 7.1.0, its workflow has never run at
  all: it triggers on push to an `astro` *branch* that has never existed
  (the port lives in the `astro/` *directory* on main).

---

## [5.0.0] — 2026-07-28
**Theme: a new domain, and a hard week of data-layer reliability work.**
Users on government networks were seeing an empty dashboard; everyone else
was seeing month-old data. Both are fixed here.

**Breaking**
- ⚠ **Canonical domain switched to `alldeputations.com`.** `CNAME` added at
  the repo root, and every user-facing URL rewritten: canonical, `og:url`,
  `og:image` and `twitter:image` across all pages, all 16 URLs in
  `feed.xml`, all 8 `sitemap.xml` locs, the fake browser-chrome captions in
  the manual, and the push-client hint text. The share/JSON-LD builders in
  `app.js` were deliberately left alone — they already use
  `window.location.origin` — `912380c`

**Fixed**
- **Vacancies failed to load on NIC networks.** Two causes: the SSL-blocked
  Supabase calls, and a code bug — `fetchVacancies()` only fell back to JSON
  when `SUPABASE_READY()` was false, which is *true* on NIC (the config is
  valid, the network isn't), so the fallback never ran. Rewritten so the
  same-origin JSON is the primary source and Supabase is an enhancement
  behind a 4 s timeout, merged by `Vacancy_ID`. Separately, `rpc()` gained a
  3-strike circuit breaker that stops retrying and hides the visitor counter
  pill, ending 12+ console errors per minute — `5379c9e`
- **The daily cron was publishing a stale Google Sheet.** It dumped 53 rows
  / 0 active while live Supabase served 384 / 75 — the Sheet was the
  project's original manual-entry source, but admin approvals had been
  writing to Supabase for months. `build_data.py` now fetches from Supabase
  first (32 columns translated snake_case → Title_Case) and falls back to
  the Sheet only if that fails, raising loudly if both do. The anon key
  suffices, since RLS already limits it to approved rows — `f2928d2`
- **Rows rendered blank with `Status: Unknown`.** The merge passed every row
  through `enrichAll()`, but `enrichRecord()` reads snake_case keys while
  JSON rows are Title_Case — so untouched JSON rows came out with empty
  derived fields. Now handled per case: JSON-only rows are kept as-is
  (already enriched by the build script), Supabase-only rows go through
  `enrichRecord()`, and shared IDs prefer the JSON row. `Status` is also
  recomputed client-side from `last_date_to_apply`, so the count stays
  honest between cron runs instead of decaying for 24 h — `c9557e4`
- The service worker registered only on `deputations.github.io`, so the PWA
  was dead on the new domain — `dbdd063`
- Clicking the "Total Vacancies" KPI card now shows all rows — `4953955`

**Added**
- P3-1: **"N new vacancies since you opened" toast.** Two layers — a
  Supabase Realtime WebSocket for instant delivery, and 60 s polling on
  `data/vacancies.json` as a universal fallback. The polling layer is the
  one that matters: it is same-origin and therefore works on every network,
  including NIC, where the WebSocket cannot connect — `894339d`
- docs: the AI session-continuity framework — `HANDOVER.md`,
  `TECHNICAL.md`, `CHANGELOG.md` — `05aeec3`, `a156143`

---

## [4.0.0] — 2026-07-09
**Theme: the site becomes installable and starts reaching out.** PWA
plumbing, syndication, web push alerts, and the accessibility/mobile
backlog (P0) cleared in one batch.

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
**Theme: Supabase replaces the spreadsheet, and AI takes over data entry.**
The largest architectural change in the project's history — from a
Sheets-driven static dump to a real backend with an AI extraction pipeline
and a human review queue in front of it.

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
**Theme: visual identity and reference content.** The dashboard gains its
dark-first look and the rules/FAQ material that turns it from a listing into
something officers can actually act on.

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
**Theme: the original static dashboard.** Everything built in one day — a
Google Sheet as the database, a Python script to flatten it into JSON, a
GitHub Action to run that daily, and vanilla HTML/CSS/JS to render it. No
build step, no framework, no backend. That shape survives today: the JSON
snapshot this release introduced is still the primary data source, and it's
the reason the site works on networks that block everything else.

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
