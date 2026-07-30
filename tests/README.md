# Smoke tests (P3-4)

End-to-end smoke tests for the deputation site. Every test runs against a
real Chromium with the Supabase backend stubbed via `page.route()` — the
suite never depends on a live Supabase project.

## Run all tests

```bash
bash scripts/run_smoke.sh
```

The script creates `.venv-smoke`, installs `scripts/requirements.txt`,
installs Chromium, and runs pytest.

Or, once your venv is set up:

```bash
python -m pytest tests/ -v --tb=short
```

## Run a single page

```bash
python -m pytest tests/test_index.py -v
```

## Debug a failure

```bash
python -m pytest tests/test_index.py --headed --slowmo=200
```

## What's tested (v1)

| File | Page | Flows |
|------|------|-------|
| `test_index.py` | index.html | card render, search debounce, modal open, filter toggle |
| `test_defex.py` | defex.html | (PR 2) |
| `test_report_vacancy.py` | report-vacancy.html | (PR 2) |
| `test_contact.py` | contact.html | (PR 2) |
| `test_my_deputation.py` | my-deputation.html | (PR 2) |
| `test_faq.py` | faq.html | (PR 3) |
| `test_rules.py` | rules.html | (PR 3) |
| `test_admin_ingest_login.py` | admin-ingest.html | login card + magic-link POST (PR 3) |
| `test_redirects.py` | Rules/faq.html | redirect to /faq.html (PR 3) |

## Adding a test

1. Add a `tests/test_<page>.py` file with `def test_*(page, base_url)` functions.
2. Use `page.goto(f"{base_url}/<page>.html")` — `base_url` points at the local
   static server.
3. The four site-wide RPCs are stubbed automatically by the `page` fixture.
4. If your page POSTs to a Supabase Edge Function (e.g. form submit), register
   an additional `page.route("**/functions/v1/...", handler)` inside your test.

The static server runs on port **8780** — keep test fixtures away from that
port. (`verify_admin.py` uses 8771; `.claude/launch.json` uses 8123.)

## CI

`.github/workflows/smoke-tests.yml` runs on every PR, every push to main,
manual dispatch, and daily at 04:47 UTC. Failure artifacts (screenshots +
trace zips) are uploaded for 7 days.
