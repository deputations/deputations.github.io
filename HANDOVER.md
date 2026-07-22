# HANDOVER — session continuity log

```
schema:
  block_id:        ## session <local-id>
  block_delim:     ## session <local-id> end
  blocks:          append-only
  fields (inline, colon-prefixed):
    started:        ISO-8601 timestamp or date
    ended:          ISO-8601 timestamp or date
    model:          model id
    driver:         relay | solo | cron
    branch:         git branch
    starting_head:  git short SHA (read with: git rev-parse --short HEAD)
    ending_head:    git short SHA
    focus:          one-line summary
  sections (H2 within block):
    ### inbound context read
    ### work done
    ### decisions
    ### handoff state
    ### gotchas for next session
  constraints:
    - never edit a previous block; append a correcting one that references its block_id
    - block ids are unique; collision -> append "-contN"
    - reading this file: scan for last "## session " heading; that is current session
```

---

## session shq-2026-07-09-001
```
started: 2026-07-09
ended:   2026-07-09
model:   claude-opus-4-8[1m]
driver:  relay
branch:  main
starting_head: b53a19e
ending_head:   c3c0acd
focus:   sync D: clone with origin/main
```

### inbound context read
- `WEBSITE-REVIEW.md` §3 — P0 done, P1 mostly done on origin
- `git fetch origin` — local 15 commits behind `a5a6aba`

### work done
1. verified my 4 in-flight P0 diffs (style-legacy.css delete, search debounce,
   hide-zero KPI delta, mobile KPI strip) were subsets of upstream `292b011`
2. discarded local diffs to avoid stomping newer code
3. resolved merge conflict: `git rm style-legacy.css` → `git reset HEAD` →
   `rm -f style-legacy.css` (got merge past the deletion-already-staged trap)
4. `--no-ff` merge of origin/main → `c3c0acd`
5. verified post-merge: 8 deliverable files non-empty, manifest JSON valid,
   `node --check` clean for app.js / site-widgets.js / push-client.js / sw.js,
   sitemap + feed.xml valid XML prologs
6. created 4-doc framework (this file + TECHNICAL.md + CHANGELOG.md +
   WEBSITE-REVIEW Progress Log entry)

### decisions
- **discarded local P0**: upstream `292b011` already represents them; adopting
  upstream preserves later refinements
- **no extra commits** beyond the merge — clean tie-in
- **`--no-ff`** — keeps this session identifiable in `git log --graph` after
  next `chore: build` ff

### handoff state
- working_tree: clean except untracked `WEBSITE-REVIEW.md`
- open: P2 (Astro), P3 (Realtime, AI explainer)
- blocked: P1-6, P1-7 (owner hold, aesthetic)
- next_pickup: P2-1 when owner greenlights

### gotchas for next session
- `.claude/` gitignored — `.claude/launch.json` local-only
- `session-archive_*/` gitignored — Drive-synced; never commit
- `supabase/.vapid.keys` gitignored but may exist on multiple machines via
  Drive sync — do not regenerate
- Supabase prod has migration 0014 applied
- `vacancies.days_left` does not exist; compute from `last_date_to_apply`
- `req_level1` / `req_level2` are TEXT, not int; parse before comparing to
  subscriber's int `pay_level` (commit `310c8f5`)

## session shq-2026-07-09-001 end

---

## session shq-2026-07-09-002
```
started: 2026-07-09
ended:   2026-07-09
model:   claude-opus-4-8[1m]
driver:  solo
branch:  main
starting_head: c3c0acd
ending_head:   05aeec3
focus:   bootstrap AI-only doc framework
```

### inbound context read
- `WEBSITE-REVIEW.md` §3 — same state as session -001
- `HANDOVER.md` — block -001 above

### work done
1. created `HANDOVER.md` (this file)
2. created `TECHNICAL.md`
3. created `CHANGELOG.md`
4. `git add` of 3 new + modified WEBSITE-REVIEW.md → commit `05aeec3`
5. `git push origin main`

### decisions
- 3 docs + 1 existing roadmap: each has one audience and one purpose
- HANDOVER is plain markdown with regex-friendly delimiters (not JSONL;
  keeps `git diff` readable for humans debugging session drift)
- version scheme = existing `?v=` counter; no behaviour change
- `.gitignore` left unchanged (`.claude/` already excluded)

### handoff state
- working_tree: clean
- open: P2 (Astro), P3 (Realtime, AI explainer)
- next_pickup: P2-1 when owner greenlights

### gotchas for next session
- read order on cold start: TECHNICAL → HANDOVER (latest block) →
  CHANGELOG (latest version) → WEBSITE-REVIEW (current status)
- always start HANDOVER block with `## session <local-id>` using
  format `<host-prefix>-<date>-<n>`; collision → `-contN`
- never edit a previous session block; correction = new block referencing old id
- cache-bust discipline: edit style.css → bump `?v=msNN` in every HTML
  linking it (and mention in CHANGELOG); same for app.js / site-widgets.js
- 4 docs are AI-only by intent; not linked from any HTML; not in sitemap.xml
  (deliberate — humans should not land on them)
- original docs were human-readable; session -003 trimmed them for AI-only

## session shq-2026-07-09-002 end

---

<!-- APPEND_NEW_BLOCKS_BELOW -->

## session shq-2026-07-09-003
```
started: 2026-07-09
ended:   2026-07-09
model:   claude-opus-4-8[1m]
driver:  relay
branch:  main
starting_head: 05aeec3
ending_head:   <pending>
focus:   trim 4 docs to AI-only consumption (no human voice)
```

### inbound context read
- session -002 block above
- all 4 docs need voice stripping

### work done
1. rewrote HANDOVER.md (this file) — schema block at top, every field
   labelled, no narrative prose
2. rewrote TECHNICAL.md — pure facts, no "Useful"/"Critical"/"do NOT"
3. rewrote CHANGELOG.md — facts per bullet, no Added/Changed/Removed heading
4. left WEBSITE-REVIEW.md as-is for this session (its voice is intentional
   for the owner's own quarterly skim; AI extracts the §3 Status column)

### decisions
- TECHNICAL keeps all tables — they're the highest-density fact format for
  AI; prose gets dropped
- CHANGELOG drops Keep-a-Changelog `Added/Changed/Removed` headers; those
  are reader cues, AI extracts from the bullets themselves
- WEBSITE-REVIEW.md intentionally NOT trimmed — owner reads it
- renaming `block_id` schema field visible at top

### handoff state
- working_tree: this commit only
- open: P2 (Astro), P3
- next_pickup: P2-1

### gotchas for next session
- if reading WEBSITE-REVIEW.md, focus on §3 Backlog Status column;
  the §1/§2 evidence paragraphs are not parsed by any automation
- the docs framework is idempotent across machines — same 4 files at
  same paths in every clone

## session shq-2026-07-09-003 end
