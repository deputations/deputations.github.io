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

---

<!-- APPEND_NEW_BLOCKS_BELOW -->

## session shq-2026-07-09-004
```
started: 2026-07-28
ended:   2026-07-28
model:   claude-opus-4-8[1m]
driver:  relay
branch:  main
starting_head: a156143
ending_head:   d16977d
focus:   switch canonical domain to alldeputations.com
```

### inbound context read
- session -003 above
- TECHNICAL.md §1 (identity) — listed only deputations.github.io
- HANDOVER schema block at top

### work done
1. created `CNAME` file at repo root containing `alldeputations.com`
   (GitHub Pages uses this to know the custom domain)
2. rewrote every user-facing URL across the repo:
   - HTML canonical + og:url + og:image + twitter:image in
     index.html, defex.html, upcoming-projects.html, Rules/faq.html
   - feed.xml: 16 URLs (channel link, atom:link self, every
     <link>/<guid> per item)
   - sitemap.xml: all 8 <loc>
   - my-deputation-manual.html: 8 fake browser-chrome URL captions
   - push-client.js: hint text (line 135)
   - Rules/faq.html: redirect stub paragraph
3. updated config.js header comment to name both URLs
4. updated TECHNICAL.md §1: added `url_canonical` +
   `url_repo` + `public_share` rows
5. merged origin/main (6 chore:build data refreshes) → `d16977d`
6. pushed everything

### decisions
- **app.js share/JSON-LD URL builders left alone** — already use
  `window.location.origin`; any visitor's current URL becomes the
  share origin automatically (lines 730, 761, 791)
- **site-widgets.js:574 left alone** — service-worker origin gate
  must match the actual host serving the SW
  (`deputations.github.io`), not the visitor's current URL
- **SETUP.md / WHATSAPP.md / apps-script/README.md / WEBSITE-REVIEW.md
  refs to deputations.github.io left alone** — these are
  operator/admin docs that correctly reference the GitHub Pages repo
  URL, not user-facing URLs
- **single commit `912380c` + merge `d16977d`** — keeps the DNS
  switch as one atomic change at the top of the visible history

### handoff state
- working_tree: clean
- open: P2 (Astro), P3 (Realtime, AI explainer)
- DNS state: alldeputations.com still resolves via Wix nameservers
  → visitors to alldeputations.com get Wix default page until
  DNS is moved off Wix (next owner action)
- next_pickup: P2-1 when owner greenlights

### gotchas for next session
- **DNS still needs to be moved off Wix to Cloudflare** with the
  four GitHub Pages A records + CNAME www. Until then,
  alldeputations.com shows Wix's default page. The repo is ready.
- if Wix strips the GitHub Pages A records (some Wix accounts
  override), the canonical URL will fail silently — verify with
  `dig alldeputations.com A` after DNS move; should show
  185.199.{108,109,110,111}.153
- Cloudflare proxy (orange cloud) on the apex MUST stay OFF
  (DNS-only) — proxied apex breaks GitHub Pages' Let's Encrypt cert
- if owner wants only alldeputations.com to work (not the
  deputations.github.io URL): not possible on GitHub Pages —
  the host serves both. Owner simply stops sharing the GitHub URL.

## session shq-2026-07-09-004 end

---

<!-- APPEND_NEW_BLOCKS_BELOW -->

## session shq-2026-07-09-005
```
started: 2026-07-29
ended:   2026-07-29
model:   claude-opus-4-8[1m]
driver:  relay
branch:  main
starting_head: 32661d0
ending_head:   5fd0fae
focus:   fix data-load failure on NIC networks
```

### inbound context read
- session -004 above (DNS switch to alldeputations.com)
- TECHNICAL.md §2.2, §2.4
- WEBSITE-REVIEW.md §3 P0/P1 (already DONE on origin)

### work done
1. diagnosed: NIC SSL-intercepting middlebox can't TLS-handshake with
   Supabase (TLS 1.3 + post-quantum + ECH); site-widgets heartbeat
   spammed 12+ ERR_SSL_PROTOCOL_ERROR per minute
2. confirmed root cause also includes a code bug: fetchVacancies()
   only fell back to JSON when SUPABASE_READY() was false — on NIC
   networks SUPABASE_READY() is true so the fallback never ran
3. rewrote fetchVacancies(): JSON primary, Supabase as enhancement
   with 4s timeout + try/catch. Merge by Vacancy_ID (Supabase wins)
4. site-widgets.js: rpc() gains a 3-strike circuit breaker that sets
   SB_OK=false and hides the visitor counter pill, stopping console
   spam from heartbeats
5. bumped cache-bust: app.js v=ms47→ms48, site-widgets.js v=21→v=22
   in all 8 HTML pages
6. pulled origin/main (1 chore:build), pushed as `5fd0fae`

### decisions
- **JSON primary, Supabase enhancement** (not the other way around):
  chosen because (a) JSON is same-origin over GitHub Pages TLS which
  NIC middleboxes handle fine, (b) Supabase is cross-origin and
  frequently TLS-blocked on hostile networks, (c) the daily cron
  already writes data/vacancies.json so the data is fresh enough
  for the audience's needs
- **4-second Supabase timeout** instead of failing fast: on a
  successful connection the merge happens within ~500ms; on a
  hostile network the timeout prevents the user seeing a delay
- **3-strike circuit breaker** for the visitor counter: after 3
  consecutive RPC failures, stop trying. Hides the counter pill
  entirely (it's a vanity metric, not core functionality)
- **did NOT change the daily cron schedule**: freshness is sufficient
  for a government audience reading vacancies once a day

### handoff state
- working_tree: clean
- open: P2 (Astro), P3 (Realtime, AI explainer)
- next_pickup: P2-1 when owner greenlights

### gotchas for next session
- **vacancies.days_left** still does not exist — JSON rows have
  the field set, but compute from last_date_to_apply at query time
  (defensive against Supabase returning differently-shaped rows
  in the future)
- **site-widgets.js heartbeat** now self-disables on hostile
  networks — but a session-level flag, not localStorage. Fresh
  page load = fresh circuit breaker. Acceptable; means NIC users
  see 3 errors per page load instead of 12/minute
- if owner wants the daily cron to run more often (e.g. hourly),
  change the cron in `.github/workflows/build-data.yml`
  `35 3 * * *` → `17 * * * *` (off-hour, off :00 to avoid
  thundering herd at minute boundaries)
- **still no manifest/web-app capability for NIC users** — they
  can install the site as a PWA, but push notifications will
  silently no-op (Supabase unreachable). UI already handles this
  via push-client.js's "live site only" check

## session shq-2026-07-09-005 end
