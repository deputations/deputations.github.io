# Web Push vacancy alerts — deploy steps (P1-3 / P1-4)

Everything in the repo is ready. Push stays **dormant** until you do the 4 steps
below (client feature-detects and shows a "runs on the live site" hint until then).
No new running costs — web-push is free.

## What it does
An officer clicks the 🔔 in the header → **Enable alerts** → picks their pay level
(prefilled from their saved profile). From then on, when a new vacancy at that
level is approved, their phone shows *"<Post name> — Level-12 · Ministry of …"*
even with the site closed. No account, no email. Tapping it opens the vacancy.

- **Android / desktop Chrome & Edge:** works directly.
- **iPhone (16.4+):** works only after **Share → Add to Home Screen**, then open the app.

---

## Step 1 — Run the migration
Supabase Studio → **SQL Editor** → paste + run
[`supabase/migrations/0014_push_subscriptions.sql`](supabase/migrations/0014_push_subscriptions.sql).
Creates `push_subscriptions` + `push_log` (service-role only; invisible to the public key).

## Step 2 — Set the function secrets
The VAPID keypair is already generated. The **private** key is in the local,
git-ignored file `supabase/.vapid.keys` (never committed). The **public** key is
already wired into `config.js`.

Supabase Studio → **Edge Functions → Secrets** (or `supabase secrets set …`), add:

| Secret | Value |
|--------|-------|
| `VAPID_PUBLIC` | `BFwXP5B3Vt7GEck0voyf0cYBoibKwxJuwDk94AlHcBIwI0w2aUVr9u5G051v1KdN8st9Fqm2EPtxiTNHdTEiETI` |
| `VAPID_PRIVATE` | *(the `VAPID_PRIVATE=` line in `supabase/.vapid.keys`)* |
| `VAPID_SUBJECT` | `mailto:koibhiusekarlo@gmail.com` |
| `PUSH_CRON_KEY` | *(make a long random string, e.g. `openssl rand -hex 24`)* |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
After copying the private key, you can delete `supabase/.vapid.keys`.

## Step 3 — Deploy the two functions
```bash
supabase functions deploy push-subscribe --no-verify-jwt
supabase functions deploy push-notify   --no-verify-jwt
```
(`push-notify` is still protected — it refuses any request without the correct
`x-cron-key` header.)

## Step 4 — Add the GitHub Actions secret
Repo → **Settings → Secrets and variables → Actions** → new secret
`PUSH_CRON_KEY` = the **same** string you set in Step 2.

The workflow [`.github/workflows/push-notify.yml`](.github/workflows/push-notify.yml)
then fires daily at ~09:40 IST (just after the data build). Test it now via
**Actions → Send vacancy push alerts → Run workflow**.

---

## Verify end-to-end
1. Open the **live** site on your phone, tap 🔔 → Enable alerts → Allow.
2. Approve a new vacancy at your level in the admin console.
3. Run the workflow manually — you should get a notification within seconds.

## Notes / tuning (all in `supabase/functions/push-notify/index.ts`)
- `WINDOW_DAYS` (4) — how far back "new" reaches; the dedupe log makes overlap safe.
- `PER_SUB_CAP` (3) — max notifications to one device per run (anti-spam).
- Matching: pay level (`req_level1`/`req_level2`/`level_text`) + optional ministry
  narrowing. `pay_level = null` ("Any level") notifies for every new vacancy.
- Expired subscriptions (HTTP 404/410) are pruned automatically.
