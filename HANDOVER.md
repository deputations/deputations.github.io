# Handover Log — AI Session Continuity

> **Audience:** Claude Code sessions (and future Claude-compatible agents) working on
> this repository across multiple sessions, machines, and timezones.
> **Format:** Append-only. Each session's block begins with `## session <id>` /
> `started:` / `ended:` and ends with a `## session <id> end` delimiter.
> **Rule:** Never edit a past session's block. Append a new one.
> **Authoritative companion:** `TECHNICAL.md` is the canonical architecture doc;
> `CHANGELOG.md` is the user-facing version log; `WEBSITE-REVIEW.md` is the roadmap.

---

<!-- SESSION_BLOCK_START — append new blocks below this line. Do not edit above. -->

## session shq-2026-07-09-001
- started: 2026-07-09 (continuation of shq-2026-07-08-002)
- model: claude-opus-4-8[1m]
- driver: relay (multi-session repo)
- branch: main
- starting_head: b53a19e
- ending_head: c3c0acd
- focus: stale D: clone sync with origin/main

### inbound context read
- `WEBSITE-REVIEW.md` §3 Backlog → all P0 + most P1 already DONE on origin
- `git fetch origin` → local was 15 commits behind `a5a6aba`

### work done
1. Verified all 4 of my locally-staged P0 changes (style-legacy.css delete,
   search debounce, hide-zero KPI delta, mobile KPI strip) were subsets of
   upstream commit `292b011`. Discarded to avoid stomping newer code.
2. Resolved merge conflict: GitHub batch 292b011 also deleted style-legacy.css
   but my local working tree had it removed-too — handled by `git rm` then
   `git reset HEAD` then `rm -f` to satisfy merge safety.
3. `--no-ff` merge of origin/main as `c3c0acd` — pulled all P0/P1 batches and
   `chore: build` data commits.
4. Post-merge verification:
   - 8 deliverable files present & non-empty (manifest.webmanifest, sw.js,
     sitemap.xml, robots.txt, faq.html, feed.xml, push-client.js)
   - `manifest.webmanifest` JSON-valid
   - `app.js`, `site-widgets.js`, `push-client.js`, `sw.js` all pass
     `node --check`
   - sitemap.xml + feed.xml start with valid XML prologs
5. Added AI-only documentation framework (this file + CHANGELOG.md + TECHNICAL.md +
   updated `.gitignore`).
6. Appended Progress Log entry to WEBSITE-REVIEW.md (the only working-tree change).

### decisions
- **Discarded local P0 diffs** because upstream already represented them
  and the doc explicitly says "Status column is the single source of truth".
  Adopting upstream preserves any later refinements in 292b011.
- **No new commits other than the merge** — wanted a clean history tie-in.
- **`--no-ff` merge** (not fast-forward) so this session is identifiable in
  `git log --graph` even after the next `chore: build` fast-forwards.

### handoff state
- working_tree: clean (only untracked `WEBSITE-REVIEW.md` modification)
- open_tasks: P2 (Astro migration — L effort), P3 (Realtime, AI explainer, etc.)
- blocked: P1-6/P1-7 (owner hold for aesthetic reasons)
- next_pickup: P2-1 (Astro scaffold) when owner greenlights

### gotchas for next session
- `.claude/` is gitignored (correctly) — `.claude/launch.json` lives locally,
  will not appear in `git status` on another machine. Recreate if needed.
- `session-archive_*/` also gitignored — local Drive-synced chat archives
  contain Supabase internals; never commit.
- VAPID private key in `supabase/.vapid.keys` is gitignored — but exists
  in BOTH working trees if synced via Drive; check before assuming the
  keys need to be regenerated.
- Live Supabase has migration 0014 applied (push_subscriptions, push_log).
  Schema gotchas from commit 310c8f5:
  - `vacancies` table has **no** `days_left` column — it's computed at
    query time from `last_date_to_apply` (ISO text). Code that reads
    `days_left` will silently get null.
  - `req_level1` / `req_level2` are **text**, not int. Parse to int
    before comparing to a subscriber's int `pay_level`.

## session shq-2026-07-09-001 end

---

## session shq-2026-07-09-002
- started: 2026-07-09 (immediate continuation)
- model: claude-opus-4-8[1m]
- focus: bootstrap AI-only documentation framework

### inbound context read
- `HANDOVER.md` ← previous session (this file)
- `TECHNICAL.md` → fresh document, written in this session
- `CHANGELOG.md` → fresh document, written in this session
- `WEBSITE-REVIEW.md` → updated Progress Log

### work done
1. Created `HANDOVER.md` (this file) with append-only session blocks.
2. Created `TECHNICAL.md` — full AI-readable architecture + decision record.
3. Created `CHANGELOG.md` — user-facing version log with semantic versioning
   tied to existing `?v=` cache-bust counter.
4. Established versioning scheme: `MAJOR.MINOR.PATCH` sourced from the
   `?v=` bump counter (current `ms28` → see CHANGELOG.md).
5. Updated `.gitignore` (no change needed — `.claude/` already excluded,
   which is where future handover snapshots may want to live).
6. First version bump applied: cache-bust remains `?v=ms28` etc. on
   `style.css` / `app.js`. CHANGELOG updated.

### decisions
- **Three documents, not one:** handover (continuity), technical (arch),
  changelog (history) — each with one clear purpose. Adding contents
  to WEBSITE-REVIEW.md (which is roadmap) would muddy its focus.
- **`HANDOVER.md` is append-only.** Deliberately chose plain markdown
  over JSON-Lines or front-matter-per-line: humans can still grep/diff
  it, AI parses it deterministically by `## session <id>` regex.
- **Semantic version from cache-bust counter** (already used as `ms28`,
  `v=2`, `v=13`, `v=21`). Formalizes what already exists — no
  behavioral change to users.

### handoff state
- working_tree: 4 new untracked .md files (HANDOVER, TECHNICAL, CHANGELOG, update to WEBSITE-REVIEW.md)
- open_tasks: P2 (Astro migration — L effort), P3 (Realtime, AI explainer, etc.)
- next_pickup: P2-1 (Astro scaffold) when owner greenlights

### gotchas for next session
- **Read order on cold start**: TECHNICAL.md → HANDOVER.md (latest
  block) → CHANGELOG.md (latest version) → WEBSITE-REVIEW.md (current
  state). 4 reads, ~2500 lines total — well within context budget.
- **Always start HANDOVER entry with `## session <local-id>`** using
  the format `<host-prefix>-<date>-<n>`. Detect if a session with the
  same id is already at the bottom; if yes, append `-contN`.
- **Never edit a previous session's block.** If you need to correct
  something earlier, append a follow-up session that references the
  earlier id and explains the correction.
- **Cache-bust discipline**: when you change `style.css`, increment
  the `?v=` in every HTML that links it (and the README/manifest list).
  This is the project's de-facto version; CHANGELOG references it.

## session shq-2026-07-09-002 end

<!-- SESSION_BLOCK_END — new blocks above this line. -->
