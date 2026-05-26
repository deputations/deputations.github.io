# Apps Script — vacancy submission backend

This folder holds the Google Apps Script that powers the **Report a Vacancy** page
on https://deputations.github.io/. It is **additive** — it sits next to the
existing FAQ "report a discrepancy" handler in the same Apps Script project and
shares the same `/exec` URL.

```
Frontend (GitHub Pages) ─POST JSON─▶ /exec (Apps Script)
                                       │
                                       ├─ action:"report"  → existing discrepancy logic (untouched)
                                       ├─ action:"vote"    → existing vote logic       (untouched)
                                       └─ action:"vacancy" → new handler in Vacancies.gs
                                                              │
                                                              ├─ append row to "Vacancies" tab
                                                              ├─ upload PDF to Drive folder
                                                              └─ email admin + (optional) submitter
```

## One-time setup

1. **Open the existing Apps Script project** that hosts the FAQ discrepancy API
   (the one whose `/exec` URL is in `config.js`).
2. **Create a new script file** in that project:
   *File → New → Script → name it `Vacancies`* and paste the contents of
   [`Vacancies.gs`](Vacancies.gs).
3. **Configure** the constants at the top of `Vacancies.gs`:

   ```js
   var VACANCY_CONFIG = {
     SHEET_ID:        '',                                // empty = active spreadsheet (recommended)
     VACANCIES_TAB:   'Vacancies',                       // auto-created on first POST
     DRIVE_FOLDER_ID: '1Nt7m5IyLHhsNIjjs5KrWObkexvFk6Bkb',// PDFs land here
     ADMIN_EMAIL:     'you@example.com',                 // notification recipient
     MAX_FILE_SIZE_MB: 10,
     RATE_LIMIT_PER_EMAIL:  5,
     RATE_LIMIT_WINDOW_MIN: 10
   };
   ```

4. **Wire the dispatcher.** In your existing `Code.gs`, find `doPost(e)` and add
   **one branch at the very top** so vacancy POSTs route to the new handler:

   ```js
   function doPost(e) {
     var __body;
     try { __body = JSON.parse(e.postData.contents || '{}'); } catch (err) {}
     if (__body && __body.action === 'vacancy') return handleVacancyPost_(__body);

     // ↓↓↓  your existing discrepancy / vote / report logic stays exactly as it is  ↓↓↓
     ...
   }
   ```

   No changes to your `action:"report"`, `action:"vote"`, or `GET /` logic.

5. **Redeploy.**
   *Deploy → Manage deployments → pencil icon on the active web-app deployment
   → Version: New version → Description: "add vacancy action" → Deploy*.
   The `/exec` URL stays the same, so nothing on the frontend needs to change.

6. **Test** with a simple link submission from the page. Verify:
   - a row appears in the `Vacancies` tab,
   - the admin email arrives,
   - the page shows a `RV-YYYY-NNNNNN` report ID.

## The `Vacancies` sheet/tab

Auto-created on first POST. Columns (in order):

| # | Column | Purpose |
|---|---|---|
| 1 | Report ID | `RV-2026-000001`, generated server-side |
| 2 | Submitted At | Apps Script timestamp |
| 3 | Status | Default `Under Review` |
| 4 | Source Type | `link` / `pdf` / `manual` |
| 5 | Vacancy Title | |
| 6 | Organization | |
| 7 | Department / Ministry | Free for reviewer to split out of column 6 |
| 8 | Location | |
| 9 | Last Date | |
| 10 | Number of Posts | |
| 11 | Pay Level | |
| 12 | Eligibility | Falls back to user's `description` if eligibility blank |
| 13 | Source URL | (link mode) |
| 14 | PDF Drive URL | (pdf mode) |
| 15 | Manual Source Details | (manual mode) |
| 16 | Submitter Name | |
| 17 | Submitter Email | |
| 18 | Reviewer Notes | empty — for moderator |
| 19 | Duplicate Flag | `URL`, `TITLE`, `DEADLINE`, or empty |
| 20 | Published URL | empty — set by reviewer when publishing |

Suggested statuses for column 3 (set manually by reviewer):
`New` · `Under Review` · `Verified` · `Duplicate` · `Rejected` · `Published`.

## Drive folder

PDF uploads are saved to the folder ID set in `DRIVE_FOLDER_ID`. The default
matches the folder you provided:
<https://drive.google.com/drive/folders/1Nt7m5IyLHhsNIjjs5KrWObkexvFk6Bkb>.

Each uploaded file is renamed `yyyyMMdd-HHmmss_<sanitized-original>.pdf` and is
shared with "anyone with the link" so the moderator can preview without granting
extra permissions.

## CORS / hosting note

The page is on GitHub Pages and the script is on `script.google.com` — different
origins. We avoid a CORS preflight by sending the body as `text/plain` and parsing
it server-side with `JSON.parse(e.postData.contents)`. Standard Apps Script web
app trick; nothing exotic.

## Anti-spam

- **Hidden honeypot field** `website` — if non-empty the script returns a fake
  success and does not write a row.
- **Per-email rate limit** — 5 submissions per 10 min by default (script
  property–backed). Tuneable in `VACANCY_CONFIG`.
- **PDF MIME + size validation** on both client and server.
- **Duplicate flagging** — checks new submissions against existing rows by
  source URL, by org+title, and by org+deadline. Row is still inserted; the
  flag goes into column 19 for moderators.

## Known limitations (v1)

- **One PDF per submission**, **≤ 10 MB**. Large institutional PDFs sometimes
  exceed this; instructions on the frontend tell the user to use link mode in
  that case.
- **Link metadata is not fetched** — phase two.
- **Submitter phone is not collected** by design (privacy).
- **No anonymous rate limit beyond the honeypot.** If you start seeing spam,
  add reCAPTCHA v3 / Cloudflare Turnstile as a phase-two enhancement.
