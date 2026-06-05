# Auto-post new deputations to the WhatsApp Channel

Posts **one WhatsApp message per new deputation vacancy** to the channel
[0029Vb7VCoq2ZjCnZq0tfz3W](https://whatsapp.com/channel/0029Vb7VCoq2ZjCnZq0tfz3W)
as rows are approved and shown on the site.

## The one hard constraint

WhatsApp **Channels have no API.** The official WhatsApp Cloud API supports
chats/groups, not Channels. So a post can only be created by a **browser logged
into WhatsApp Web** — it **cannot** run in the cloud / GitHub Actions, and **your
PC must be on** with a logged-in session for a post to go out. "Automatic" here
means a local watcher that polls and posts on its own; you don't trigger each one.

## How it's built — "what" vs "how"

```
 live data (Supabase approved rows; fallback data/vacancies.json)
        │  filter: Approved + Active (deadline not past)
        ▼
 scripts/whatsapp_feed.py  →  pending = rows whose Vacancy_ID ∉ ledger,
        │                      each formatted into the WhatsApp message
        ▼
 data/whatsapp_posted.json   (ledger — the record of what's already been sent)
        ▲
        │  marked posted ONLY after a confirmed send
   ┌────┴──────────── posting engine ────────────────────┐
   │ A) whatsapp_watcher.py (Playwright) — auto, recommended │
   │ B) the post-whatsapp skill (Claude Chrome ext.)        │
   │ C) whatsapp_bridge.py + admin button — one-click manual │
   └────────────────────────────────────────────────────────┘
```

`whatsapp_feed.py` decides **what** to post and is browser-free. A posting
engine decides **how**. Both engines share the same core, so switching between
them needs no rework.

### `scripts/whatsapp_feed.py` (core)

```
python scripts/whatsapp_feed.py --list-pending   # JSON of new rows + messages (default)
python scripts/whatsapp_feed.py --seed           # mark ALL current IDs posted (run once)
python scripts/whatsapp_feed.py --mark-posted ID # after a confirmed send
python scripts/whatsapp_feed.py --list-pending --source json   # force offline source
```

- **Source:** `auto` (default) reads approved rows from Supabase (URL + anon key
  read from `config.js`), falling back to `data/vacancies.json` if Supabase is
  unreachable.
- **Active+Approved only.** Expired rows (deadline passed) are never posted.
- **Ledger** `data/whatsapp_posted.json` is local state (git-ignored; it rides
  along on Google Drive so it syncs across your machines). It was **seeded** at
  setup so the rows that already existed never blast the channel — only rows
  added *after* seeding go out.

## A) Standalone watcher — `scripts/whatsapp_watcher.py` (recommended)

Truly hands-off: approve a record → a post appears a few minutes later, no Claude
session needed. Drives a headed Chromium with a **persistent profile** so you log
in once.

### One-time setup

```
pip install -r scripts/requirements.txt
python -m playwright install chromium

# set your channel's display name (as it appears in WhatsApp), e.g.:
setx WA_CHANNEL_NAME "Deputations"        # Windows; reopen the shell after

python scripts/whatsapp_watcher.py --login    # scan the QR in the window once
python scripts/whatsapp_watcher.py --dry-run  # opens the channel, finds the
                                              # compose box, prints what it WOULD
                                              # send — sends nothing. Use this to
                                              # confirm the channel name/selectors.
```

If `--dry-run` can't open the channel, fix `WA_CHANNEL_NAME` (and/or
`WA_CHANNEL_URL`) — see **Config** below.

### Running

```
python scripts/whatsapp_watcher.py --once                  # post pending, exit
python scripts/whatsapp_watcher.py --watch --interval 300  # loop every 5 minutes
```

The ledger is written **only after** each send is confirmed on-screen, so killing
the watcher mid-run never double-posts — just rerun.

### Run it automatically (Windows Task Scheduler)

Run `--once` every 10 minutes while you're logged in:

```powershell
$py  = (Get-Command python).Source
$dir = "H:\My Drive\Deputation\github\Claude"
$act = New-ScheduledTaskAction -Execute $py `
        -Argument "scripts\whatsapp_watcher.py --once" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "Deputations WhatsApp poster" `
        -Action $act -Trigger $trg -Description "Posts new deputation rows to the WhatsApp channel"
```

Or keep one long-lived window open with `--watch`. Either way the machine must be
on and WhatsApp Web logged in.

### Config (environment variables)

| Var | Default | Purpose |
| --- | --- | --- |
| `WA_CHANNEL_NAME` | `Deputation Opportunities` | Channel display name, used to find/open it |
| `WA_CHANNEL_URL` | the invite link | Fallback way to open the channel |
| `WA_PROFILE_DIR` | `~/.deputations-wa/wa-profile` | Browser profile (kept off the Drive repo) |
| `WA_HEADLESS` | unset | `1` runs headless (not recommended — WhatsApp flags it) |

The WhatsApp-Web selectors live in the `WA` dict at the top of
`whatsapp_watcher.py`. WhatsApp's DOM changes occasionally; if posting breaks,
adjust the `compose_box` / `search_box` fallbacks there and re-run `--dry-run`.

## B) Claude Chrome-extension flow — the `post-whatsapp` skill

For bootstrapping (validate the first real post looks right) or a manual run
without the watcher. In a Claude Code session with the Chrome extension and your
channel open, say **"post the new deputations to WhatsApp"**. It runs
`--list-pending`, posts each via the extension, verifies, and `--mark-posted`s
each. See `.claude/skills/post-whatsapp/SKILL.md`.

## C) Admin "Send WhatsApp Update" button — `scripts/whatsapp_bridge.py`

A one-click button in the admin **Manage data** tab. Because a web page can't post
to a Channel, the button calls a small **local helper** that drives a logged-in
WhatsApp Web session and does the posting.

> **Important — the channel only shows on the owner/admin's established session.**
> A freshly-linked WhatsApp Web device (an isolated browser the helper launches on
> its own) does **not** show the channel at all. So the helper must attach to a
> **real browser already logged into a channel-admin session** — done via CDP.
> In practice: a WhatsApp **Business** account made an **admin** of the channel,
> kept logged in, is the dedicated posting session.

### Setup & run (CDP — the working path)
Easiest: double-click **`scripts/start-whatsapp-poster.cmd`** — it launches Edge
with the debug port + a dedicated profile and starts the bridge in CDP mode.

Manual equivalent:
```powershell
# 1) Launch Edge with a DEDICATED profile + debug port (a non-default --user-data-dir
#    is REQUIRED — modern Chrome/Edge block debugging on the default profile).
& "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe" `
    --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\edge-wa-business"
#    → in that window, log into web.whatsapp.com with the channel-ADMIN account and
#      confirm the channel shows (scan the QR once; the profile persists).
# 2) Start the bridge attached to it:
$env:WA_USE_CDP = "1"      # or WA_CDP_URL=http://127.0.0.1:9222
python scripts/whatsapp_bridge.py
```
Then in admin → **Manage data**, click **📣 Send WhatsApp Update**: it checks the
helper, shows how many vacancies are pending, asks you to confirm, posts them via
your real browser, and marks each in the ledger.

(Without `WA_USE_CDP`, the bridge falls back to launching its own isolated browser —
but that session won't show the channel, so CDP is the way.)

### How the button behaves
- **Helper not running** → toast tells you to start `whatsapp_bridge.py`.
- **Not logged in** → log into web.whatsapp.com in the CDP browser (the Edge
  window the launcher opened), with the channel-admin account.
- **Nothing new** → "Nothing new to post."
- **N pending** → confirm prompt, then posts and reports `Posted N`.

### Endpoints (localhost only)
`GET /health` → `{ok, logged_in}` · `GET /pending` → `{count, items}` ·
`POST /post` → `{posted, failed, count, requested}`.

### Config / security
- `WA_USE_CDP=1` (attach to your real browser via `WA_CDP_URL`, default
  `http://127.0.0.1:9222`) — the recommended/working mode.
- `WA_BRIDGE_PORT` (default 8787), `WA_BRIDGE_SOURCE` (default `auto`); reuses
  `WA_CHANNEL_NAME` / `WA_PROFILE_DIR` / `WA_HEADLESS`.
- Bound to `127.0.0.1` only. CORS is limited to the admin origins (the deployed
  `https://deputations.github.io` plus common local dev ports). To allow another
  origin (e.g. a custom local port serving the admin page), set
  `WA_BRIDGE_ORIGINS="http://localhost:1234"`.
- If you open the admin page from a different host/port, add it to
  `WA_BRIDGE_ORIGINS` or the button's calls will be blocked by the browser.

The button is a *manual on-demand* trigger; the `--watch` mode (section A) is the
fully-automatic alternative. They share the same feed + ledger, so they're safe to
mix (no double-posts).

## Reseeding / resetting

- Added the poster on a new machine, or want to suppress everything currently
  live and only post future rows: `python scripts/whatsapp_feed.py --seed`.
- To re-post a specific row, remove its ID from `data/whatsapp_posted.json` and
  run the watcher (or the skill) again.

## Troubleshooting

- **"Not logged in"** → `python scripts/whatsapp_watcher.py --login` and scan the QR.
- **Channel not found / no compose box** → wrong `WA_CHANNEL_NAME`, or your
  account can't post (you must be the channel admin). Verify with `--dry-run`.
- **Posted dozens at once** → the ledger wasn't seeded; run `--seed`, then post.
- **Message looks off** → the template is in `format_message()` in
  `scripts/whatsapp_feed.py`; it mirrors the site's `enrich.js` fields.
