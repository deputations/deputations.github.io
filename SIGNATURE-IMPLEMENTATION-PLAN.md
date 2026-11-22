# SIGNATURE — Numbered Implementation Plan
**AllDeputations.com | Plan v2.0 | 12 October 2026**

> **Planning specification — not an implementation or approval to deploy.** Signature is a third **opt-in** homepage *experience*. Existing Classic Light and Classic Dark modes must be preserved. Only the owner can approve a phase or change production defaults.

## Mission and decisions
- Deliver a beautiful, search-first, accessible and intelligent government-deputation discovery experience without compromising result correctness, trust or speed.
- Correct production repository: `deputations/deputations.github.io` (GitHub Pages, vanilla HTML/CSS/JS). The separate `deputations/Home` repository is **not** the current production baseline.
- Reuse current Supabase primary source, static JSON/NIC fallback, existing semantic search, watchlist, personalised eligibility, DeFeX, source links and My Deputation.
- **Theme architecture:** keep `deputation_theme_v1` limited to `dark|light`. Add **separate** `dep_experience_v1` value (`classic|signature`) with `classic` as the default. Never use `data-theme="signature"` because existing two-mode CSS/JavaScript assumes color mode.
- **Scope:** Signature initially changes only homepage presentation. Full-site experiences, a separate dark Signature variant, new AI services, Astro migration and account sync require separate review.
- Avoid rewriting existing eligibility logic, replacing the owner-approved neon/glass Classic identity, or disturbing owner-approved table scroll behavior.
- Keep current `?v=<Vacancy_ID>` and filter URL contracts, stable vacancy IDs, access to original official PDF, localStorage profile/watchlist keys, RSS/PWA behavior and visible unofficial-site disclosure.

## Team operating model
| Role | Lead | Accountabilities |
|---|---|---|
| Product Owner | User | Approve chosen design, scope changes, phase acceptance, any merge/release |
| Technical Lead | ChatGPT | Specify architecture, sequence, guardrails, review agent outputs, identify blockers |
| Lead UI/UX Engineering | Claude | Design system, frontend components, UX writing, accessibility-aware responsive design |
| Core Engineering and CI | Codex | Shared state/data integration, safe feature gating, regressions, functional automated tests |
| Visual Engineering & Browser QA | Google Antigravity | Browser-driven UI implementation refinement, visual inspection, responsive tests, accessibility/interaction verification |

**Important:** Assignments identify intended handoffs. They do **not** represent autonomous sessions already launched in external coding agents. Each agent needs access to the project/workspace and explicit instructions to execute its assigned items.

## Workflow and controls
1. **Planning:** one GitHub phase issue per P0–P6, with individually checkable numbered subtasks. Every item has a primary owner; another agent reviews the PR.
2. **Isolation:** one scoped feature branch per task/cluster (`feat/signature-pN-short-name`). Avoid editing the same application file in parallel; coordinate shared `app.js`, `index.html`, and global CSS changes explicitly.
3. **Evidence:** every PR includes changed files, feature parity checklist, screenshots for Classic Light / Classic Dark / Signature when relevant, test logs, accessibility/performance findings, and rollback strategy.
4. **Review chain:** implementation agent → cross-reviewing agent → Technical Lead → Product Owner approval → merge. No agent merges or deploys on its own.
5. **Release:** opt-in behind a feature gate; test on a preview. Retain immediate switch to Classic. Do not change default or enable broad rollout without a separate owner decision.
6. **Definition of Done:** task/subtasks checked, regression passing, no unapproved dependency, verified accessibility, official/source data correct, docs updated, reviewer evidence linked.
7. **Source protection:** no secrets/client exposure, no unsolicited RLS or Supabase migration, no new personal data collection. Protect NIC/static fallback and do not make AI compulsory.
8. **Cross-agent specialties:** Claude builds visual UI; Codex safeguards state and integration; Antigravity is empowered to refine UI interactions but must independently test browser behavior and record evidence.

## Phase dependency chain
`P0 → P1 → P2 → P3 → P4 → P5 → P6`. Phase sequencing is the default; overlapping preparation is acceptable only when no shared file or user-facing integration conflicts and the prior gate is not bypassed.

## Release-quality targets
- Target WCAG 2.2 AA; keyboard operable, robust focus, informative labels and reduced-motion support.
- Mobile first, test at 320, 375, 768, 1440 and 1920 px. No uncontrolled horizontal page overflow.
- Target p75 Web Vitals when measurable: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; compare against the measured Classic baseline.
- Exact vacancy/filter/result parity, reliable deadlines, official PDF/source provenance and full Classic visual non-regression.
- Verify failure modes with blocked Supabase, NIC/firewall conditions, interrupted fetches and static JSON fallback.

## GitHub tracking
- [P0 — Foundation, baseline and design approval](https://github.com/deputations/deputations.github.io/issues/22)
- [P1 — Experience engine and isolated theme selector](https://github.com/deputations/deputations.github.io/issues/23)
- [P2 — Visual design system and premium homepage](https://github.com/deputations/deputations.github.io/issues/24)
- [P3 — Unified search, advanced filters and AI discovery](https://github.com/deputations/deputations.github.io/issues/25)
- [P4 — Vacancy listings, details and trust](https://github.com/deputations/deputations.github.io/issues/26)
- [P5 — Personalisation and useful intelligence](https://github.com/deputations/deputations.github.io/issues/27)
- [P6 — Hardening, pilot and production decision](https://github.com/deputations/deputations.github.io/issues/28)

---

## P0 — Foundation, baseline and design approval
**Goal:** Prove current behavior and approve the future experience before any UI implementation.

### P0.1 Source-of-truth and architecture audit — Codex
- [ ] **P0.1.1** Inspect TECHNICAL.md, latest HANDOVER.md, CHANGELOG.md, REDESIGN.md and current open PRs.
- [ ] **P0.1.2** Map production index.html/app.js/style.css, shared widgets, Supabase data and static/NIC fallback.
- [ ] **P0.1.3** Document non-negotiable data, eligibility, vacancy-ID, URL, storage, PWA and disclaimer invariants.

### P0.2 Functional parity inventory — Claude
- [ ] **P0.2.1** Catalogue every homepage control, quick filter, KPI, view, AI action and source link.
- [ ] **P0.2.2** Trace watchlist, saved profile, shared URL, modal, WhatsApp/share and My Deputation journeys.
- [ ] **P0.2.3** Produce behavior-by-behavior matrix: Classic existing vs Signature required vs intentionally deferred.

### P0.3 Real-browser baseline and evidence — Antigravity
- [ ] **P0.3.1** Capture Classic light/dark at 320, 375, 768, 1440 and 1920 px with representative data.
- [ ] **P0.3.2** Test keyboard/touch flows, browser console, slow network, responsive overflow and reduced motion.
- [ ] **P0.3.3** Record defects separately from design changes; save screenshots/recordings and existing performance readings.

### P0.4 SIGNATURE creative directions — Claude
- [ ] **P0.4.1** Prepare three distinct concepts (premium civic intelligence, editorial precision, intelligent cockpit).
- [ ] **P0.4.2** Provide desktop and mobile high-fidelity layouts for the same realistic vacancy dataset.
- [ ] **P0.4.3** Define information hierarchy, accessible typography, color tokens, component primitives and motion guidelines.

### P0.5 Integration strategy and dependency risk — Codex
- [ ] **P0.5.1** Choose scoped presentation-only mode, not a rewrite or Astro migration.
- [ ] **P0.5.2** Specify theme/experience storage separation, adapter to canonical results and feature-switch/rollback mechanics.
- [ ] **P0.5.3** Identify touchpoints in app.js, shared widgets, existing URL state and active PRs; enumerate conflict risks.

### P0.6 Design review and phase sign-off — Antigravity
- [ ] **P0.6.1** Review each proposed design as a realistic responsive prototype and document usability issues.
- [ ] **P0.6.2** Run a task-based search/discovery walkthrough with visual and keyboard evidence.
- [ ] **P0.6.3** Submit a recommendation matrix for Technical Lead and explicit Product Owner approval.

**P0 acceptance gate:**
- [ ] Existing behavior and baseline evidence documented.
- [ ] Three visual concepts compared; one approved by Product Owner.
- [ ] Implementation boundaries and protected classic decisions signed off.

---

## P1 — Experience engine and isolated theme selector
**Goal:** Introduce an opt-in Signature presentation without changing the current two color modes.

### P1.1 Separate experience and color preferences — Codex
- [ ] **P1.1.1** Preserve existing deputation_theme_v1 values light/dark.
- [ ] **P1.1.2** Introduce dep_experience_v1 with classic/signature, default classic; do not overwrite existing values.
- [ ] **P1.1.3** Define a shared read/apply API and fault-tolerant localStorage fallback.

### P1.2 Before-paint mode bootstrap — Codex
- [ ] **P1.2.1** Set the independent data-experience attribute before first paint, with validated stored values.
- [ ] **P1.2.2** Prevent theme flashes and avoid any additional blocking network requests.
- [ ] **P1.2.3** Support explicit exit to Classic and safe behavior when JS/storage fails.

### P1.3 Build scoped Signature presentation boundary — Claude
- [ ] **P1.3.1** Create additive signature.css and signature.js entry points with all styles scoped to [data-experience=signature].
- [ ] **P1.3.2** Implement layout slots without mutating Classic markup behavior or overwriting shared classes globally.
- [ ] **P1.3.3** Keep data/action hooks mapped to existing app.js and current render state.

### P1.4 Accessible experience switcher — Claude
- [ ] **P1.4.1** Offer Classic Light, Classic Dark, and Signature with explicit selected/accessible labels.
- [ ] **P1.4.2** Support keyboard operation, focus return, screen-reader announcements and touch targets.
- [ ] **P1.4.3** Explain that Signature initially affects the homepage, not all site pages.

### P1.5 Browser validation of both existing modes — Antigravity
- [ ] **P1.5.1** Compare screenshots and interactions of Classic Light and Dark against P0 baseline.
- [ ] **P1.5.2** Verify reload, Back/Forward, new tab, denied storage, and screen-reader flow.
- [ ] **P1.5.3** Produce visual regression screenshots and reproduce any leak of Signature styles into Classic.

### P1.6 Rollback and integration gate — Codex
- [ ] **P1.6.1** Add documented reversible feature switch that returns users to Classic without deleting profile/watchlist.
- [ ] **P1.6.2** Create automated tests for selector persistence, data-state continuity and theme isolation.
- [ ] **P1.6.3** Restrict deployment until full Classic parity and owner approval.

**P1 acceptance gate:**
- [ ] Three experience choices work and persist independently.
- [ ] Default continues Classic; full rollback demonstrated.
- [ ] Existing Light/Dark visuals and behavior unchanged.

---

## P2 — Visual design system and premium homepage
**Goal:** Deliver a distinct search-first Signature homepage across desktop, tablet and mobile.

### P2.1 Build coherent design tokens and components — Claude
- [ ] **P2.1.1** Define semantic CSS tokens, typography, spacing, radii, states, focus rings and icons.
- [ ] **P2.1.2** Build reusable Signature buttons, form controls, chips, cards, tooltips and empty states.
- [ ] **P2.1.3** Ensure colors remain high contrast and do not rely only on hue for meaning.

### P2.2 Premium navigation and brand hierarchy — Claude
- [ ] **P2.2.1** Redesign brand header with discoverable primary navigation and accessible overflow.
- [ ] **P2.2.2** Keep links to India Map, Rules, FAQs, DeFeX, Report Vacancy, Contact and My Deputation.
- [ ] **P2.2.3** Ensure no deception about official government affiliation; retain disclaimer access.

### P2.3 Search-first hero and content rhythm — Claude
- [ ] **P2.3.1** Replace oversized introductory chrome with concise value proposition and immediately visible search.
- [ ] **P2.3.2** Add minimal supporting copy and contextual suggestions; avoid decorative blocking animations.
- [ ] **P2.3.3** Place useful results within practical first-screen reach on mobile and desktop.

### P2.4 KPI rail and results toolbar — Codex
- [ ] **P2.4.1** Reuse existing KPI calculations and click-to-filter behavior.
- [ ] **P2.4.2** Make summary tiles compact, meaningful and consistent with active result state.
- [ ] **P2.4.3** Preserve current count semantics, date handling and error/loading/empty states.

### P2.5 Responsive and motion polishing — Antigravity
- [ ] **P2.5.1** Inspect spacing and hierarchy at 320/375/768/1440/1920 pixels via browser.
- [ ] **P2.5.2** Refine hover/focus/tap states, micro-transitions and prefers-reduced-motion behavior.
- [ ] **P2.5.3** Capture side-by-side Classic/Signature evidence and check one-handed mobile usability.

### P2.6 Performance and visual approval gate — Antigravity
- [ ] **P2.6.1** Audit font requests, paint cost, no horizontal scroll, contrast and motion on low-end devices.
- [ ] **P2.6.2** Compare page weight and interaction readiness with P0 baseline.
- [ ] **P2.6.3** Present a desktop/mobile design review package for owner approval before advancing.

**P2 acceptance gate:**
- [ ] Signature design signed off at mobile and desktop widths.
- [ ] No style leakage, important links remain findable, and search remains prominent.
- [ ] No avoidable visual/performance regression.

---

## P3 — Unified search, advanced filters and AI discovery
**Goal:** Make finding relevant posts effortless while maintaining exact result correctness.

### P3.1 Unify visible search entry — Claude
- [ ] **P3.1.1** Present a single highly visible input for keyword searches and optional natural-language discovery.
- [ ] **P3.1.2** Provide predictive suggestions and explicit loading, no-results and correction messages.
- [ ] **P3.1.3** Retain ordinary typed search even when AI service is unavailable.

### P3.2 Implement essential filter experience — Claude
- [ ] **P3.2.1** Promote Your Pay Level, advertised Pay Level, experience and location into intuitive controls.
- [ ] **P3.2.2** Preserve distinctions between employee pay level and vacancy level.
- [ ] **P3.2.3** Offer compact active chips, clear/reset and accurate filter result counts.

### P3.3 Progressive advanced filters — Claude
- [ ] **P3.3.1** Place ministry, organisation, region, status and advanced options in an accessible panel.
- [ ] **P3.3.2** Retain multi-select semantics, keyboard traversal and selected-value persistence.
- [ ] **P3.3.3** Ensure desktop density and touch-friendly mobile bottom-sheet/expandable behavior.

### P3.4 Connect existing semantic AI — Codex
- [ ] **P3.4.1** Reuse existing Supabase/pgvector semantic search flow and its status/error handling.
- [ ] **P3.4.2** Show parsed constraints as editable chips; do not silently invent constraints.
- [ ] **P3.4.3** AI failures must return user to deterministic keyword/filter search without data loss.

### P3.5 Canonical URL and filter-state integration — Codex
- [ ] **P3.5.1** Reuse hydrateFiltersFromUrl and existing vacancy ?v= deep-link semantics.
- [ ] **P3.5.2** Ensure share/copy/permalink, history interactions and state restore do not regress.
- [ ] **P3.5.3** Avoid URL collisions between search params and the vacancy modal; test back and reload.

### P3.6 Independent browser and NIC testing — Antigravity
- [ ] **P3.6.1** Compare Classic and Signature outputs for a fixed filter/search fixture set.
- [ ] **P3.6.2** Run automated and manual keyboard/mobility tests for essential/advanced controls.
- [ ] **P3.6.3** Simulate slow/blocked Supabase, NIC proxy and static JSON fallback; verify basic search works.

**P3 acceptance gate:**
- [ ] Equal criteria yield identical vacancy matches and ordering in both experiences.
- [ ] Advanced filters, shares and URL restore work.
- [ ] Core discovery works without AI or Supabase availability.

---

## P4 — Vacancy listings, details and trust
**Goal:** Make vacancy browsing informative, credible and easy to act on.

### P4.1 Mobile-first opportunity cards — Claude
- [ ] **P4.1.1** Design cards with post, organisation, location, pay level, source and deadline prominent.
- [ ] **P4.1.2** Include clear bookmark, details, sharing and source-PDF actions.
- [ ] **P4.1.3** Prevent long organisation names or date labels from breaking layout.

### P4.2 Professional desktop table and view switch — Codex
- [ ] **P4.2.1** Reuse current result grouping, sorting, counts, pagination and compact/table view behavior.
- [ ] **P4.2.2** Preserve existing owner-approved scroll and pinned-column conventions unless separately approved.
- [ ] **P4.2.3** Remember user view preference without interfering with other saved profile fields.

### P4.3 Refined vacancy details interaction — Claude
- [ ] **P4.3.1** Build a readable details view/drawer with full eligibility, official PDF and helpful context.
- [ ] **P4.3.2** Retain modal deep linking, keyboard focus trap/return, Escape behavior and mobile usability.
- [ ] **P4.3.3** Keep action terminology consistent across list and details surfaces.

### P4.4 Verified information and deadline semantics — Codex
- [ ] **P4.4.1** Use Last_Date_To_Apply as the deadline source of truth; compute days remaining at runtime.
- [ ] **P4.4.2** Respect missing dates, expired posts and existing Open_Until_Filled semantics; never imply invented deadlines.
- [ ] **P4.4.3** Clearly distinguish source-backed, calculated and suggested/AI-derived information.

### P4.5 Bookmarks, cross-product paths and sharing — Codex
- [ ] **P4.5.1** Reuse deputations_watchlist_v1 and My Deputation existing storage and IDs.
- [ ] **P4.5.2** Verify links to Rules, source PDF, India Map, WhatsApp and copy-link behaviors.
- [ ] **P4.5.3** Ensure saved state stays intact when switching themes or refreshing.

### P4.6 Cross-device detail and visual QA — Antigravity
- [ ] **P4.6.1** Test mobile cards, desktop table, result counts, deadlines and modal keyboard behavior.
- [ ] **P4.6.2** Capture real-browser screenshots and regression artifacts for odd-long text and empty states.
- [ ] **P4.6.3** Check trust labels, source links and optional status badges for accuracy and accessibility.

**P4 acceptance gate:**
- [ ] Every result action and official document link works.
- [ ] Vacancy ID, sorting, deadlines, watchlist and modal behavior remain correct.
- [ ] Card and table usability approved across target widths.

---

## P5 — Personalisation and useful intelligence
**Goal:** Turn return visits into an explainable, helpful career-opportunity workspace.

### P5.1 Existing-profile onboarding — Claude
- [ ] **P5.1.1** Design an optional preference summary and an unobtrusive first-visit setup path.
- [ ] **P5.1.2** Ask only necessary pay level, experience and location preferences; skip is always available.
- [ ] **P5.1.3** Make it obvious how preferences can be changed or cleared.

### P5.2 Deterministic matching and eligibility explanation — Codex
- [ ] **P5.2.1** Reuse dep_profile_v1 and current eligibility rules; do not implement a competing rules engine.
- [ ] **P5.2.2** Explain match factors and label ambiguous/missing inputs as unverified or possible matches.
- [ ] **P5.2.3** Never assert statutory eligibility or qualification based solely on AI.

### P5.3 Personal opportunity dashboard — Claude
- [ ] **P5.3.1** Design sections for relevant vacancies, saved posts, recent opportunities and deadlines.
- [ ] **P5.3.2** Integrate saved searches and My Deputation destinations without duplicating the feature.
- [ ] **P5.3.3** Avoid noisy empty cards for users without saved preferences.

### P5.4 Opportunity Radar and reminders — Codex
- [ ] **P5.4.1** Reuse existing notification/push capabilities with permission-driven behavior.
- [ ] **P5.4.2** Prioritise changes, newly approved vacancies and deadlines without duplicate notifications.
- [ ] **P5.4.3** Provide understandable unsubscribe, snooze and stale-record behavior.

### P5.5 Optional side-by-side comparisons — Antigravity
- [ ] **P5.5.1** Prototype a compare-2-or-3-opportunities interaction using existing verified fields.
- [ ] **P5.5.2** Test clarity of side-by-side fields, narrow screens and keyboard navigation.
- [ ] **P5.5.3** Ship only if usability value is demonstrated and source-field completeness is adequate.

### P5.6 Privacy and return-visit quality assurance — Antigravity
- [ ] **P5.6.1** Test new user, partial saved profile, cleared storage and previously saved items.
- [ ] **P5.6.2** Verify local-only preferences remain local and no new sensitive data collection is introduced.
- [ ] **P5.6.3** Audit performance, accurate sourcing and non-AI fallback in personalised views.

**P5 acceptance gate:**
- [ ] Personalisation is opt-in, explainable and compatible with existing data.
- [ ] No fabricated eligibility, duplicates or disruptive new account requirement.
- [ ] Saved information and privacy protected across themes.

---

## P6 — Hardening, pilot and production decision
**Goal:** Launch only after independent evidence shows performance, access and behavioral parity.

### P6.1 Full regression and contract test suite — Codex
- [ ] **P6.1.1** Run all existing Playwright/Python/JS tests plus new Signature E2E and snapshot tests.
- [ ] **P6.1.2** Cover search, filters, AI, vacancy details, bookmarks, data fallback and theme switching.
- [ ] **P6.1.3** Report pre-existing failures separately; no unresolved P0/P1 Signature regressions.

### P6.2 Accessibility and usability certification — Antigravity
- [ ] **P6.2.1** Test keyboard-only, screen-reader semantics, focus, error announcements and escape routes.
- [ ] **P6.2.2** Audit WCAG 2.2 AA contrast, 320px layout, tap targets, reduced motion and zoom.
- [ ] **P6.2.3** Run task-based vacancy discovery and source-checking walkthroughs; attach recordings.

### P6.3 Real-device and network resilience — Antigravity
- [ ] **P6.3.1** Test Android/mobile and desktop browsers at listed widths; capture screenshots.
- [ ] **P6.3.2** Simulate 3G, blocked Supabase/NIC, static JSON fallback, low-end rendering and interrupted reload.
- [ ] **P6.3.3** Check PWA/service-worker update behavior and theme preference persistence.

### P6.4 Performance tuning and final architecture review — Codex
- [ ] **P6.4.1** Measure Core Web Vitals; target p75 LCP <=2.5s, INP <=200ms and CLS <=0.1 where field data exists.
- [ ] **P6.4.2** Compare bundle/network costs against baseline and remove animation/font regressions.
- [ ] **P6.4.3** Verify no leaked secrets, no unintended RLS changes, source links and accessibility safety.

### P6.5 Opt-in pilot and privacy-respecting measurement — Claude
- [ ] **P6.5.1** Present clear Signature preview/feedback/onboarding and simple return-to-Classic path.
- [ ] **P6.5.2** Prepare qualitative user tasks and privacy-respecting indicators: search completion, relevant clicks, saves, errors.
- [ ] **P6.5.3** Keep Signature default-off; do not add user tracking without separately approved privacy review.

### P6.6 Owner go/no-go, deployment and rollback — Codex
- [ ] **P6.6.1** Assemble QA reports, open risks, screenshots, dependency status and rollback checklist.
- [ ] **P6.6.2** Run kill-switch/restore-to-Classic rehearsal on an isolated preview.
- [ ] **P6.6.3** Request explicit Product Owner approval for merge, pilot, and any future default-on decision separately.

**P6 acceptance gate:**
- [ ] All defined cross-theme and functional tests pass or have accepted exceptions.
- [ ] No critical blockers; visual, accessibility, performance and NIC evidence reviewed.
- [ ] Owner explicitly approves each merge and any production rollout.

## Scope exclusions until specifically approved
- Do not replace existing Light/Dark theme or remove prior owner's brand visuals.
- Do not rebuild/deploy Astro, modify Supabase schema, or install a new framework by default.
- Do not introduce a new AI provider, billing, authentication, server-backed profile sync or eligibility claims.
- Do not merge a phase solely because checkboxes were marked; show verification evidence and obtain owner approval.

## Agent kickoff instruction template
> Read this plan and current repo's TECHNICAL.md, latest HANDOVER.md, CHANGELOG.md, REDESIGN.md, relevant phase issue, open PRs, and affected source. Implement only your assigned numbered subtasks on an isolated branch. Preserve Classic Light and Dark in full, reuse business logic, add tests, include screenshots/rollback notes, and request cross-review. Do not merge or deploy.

## Open design/architecture approvals
1. Select one of the three Phase 0 visual concepts.
2. Confirm homepage-only initial scope (recommended).
3. Review any task that intentionally changes table scrolling or existing theme conventions; require separate owner decision.
4. Confirm the owner can launch Claude, Codex and Google Antigravity against the same repository and provide review artifacts.
