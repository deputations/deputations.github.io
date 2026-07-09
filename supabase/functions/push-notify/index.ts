// ============================================================================
// Edge Function: push-notify  (PROTECTED — deploy with --no-verify-jwt, but it
// requires a shared x-cron-key header so only the scheduled job can fire it)
// Diffs newly-approved vacancies and web-pushes matching subscribers
// (WEBSITE-REVIEW P1-4). Runs daily from .github/workflows/push-notify.yml.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-provided)
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
//   PUSH_CRON_KEY   (any long random string; also a GitHub Actions secret)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@deputations.github.io";
const CRON_KEY = Deno.env.get("PUSH_CRON_KEY") ?? "";
const SITE = "https://deputations.github.io";

const WINDOW_DAYS = 4;        // look back this far (dedupe makes overlap safe)
const PER_SUB_CAP = 3;        // never send more than this to one device per run
const TOTAL_CAP = 800;        // hard ceiling per run

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function levelInt(v: unknown): number | null {
  const m = String(v ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);
  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) return json({ ok: false, message: "Unauthorized" }, 401);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: false, message: "VAPID keys not configured" }, 500);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  // newly-approved, not-yet-expired vacancies in the window.
  // NOTE: the table has no days_left column (that's computed client-side from
  // last_date_to_apply, an ISO 'YYYY-MM-DD' text column) — filter on that instead.
  const today = new Date().toISOString().slice(0, 10);
  const { data: vacs, error: vErr } = await admin
    .from("vacancies")
    .select("vacancy_id, post_name, ministry, level_text, req_level1, req_level2, last_date_to_apply, created_at")
    .eq("status", "approved")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  if (vErr) return json({ ok: false, message: vErr.message }, 500);

  const vacancies = (vacs ?? []).filter((v: any) =>
    v.vacancy_id && (!v.last_date_to_apply || v.last_date_to_apply >= today)
  );
  if (!vacancies.length) return json({ ok: true, sent: 0, note: "no new vacancies in window" });

  const { data: subs, error: sErr } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, pay_level, ministries");
  if (sErr) return json({ ok: false, message: sErr.message }, 500);
  if (!subs || !subs.length) return json({ ok: true, sent: 0, note: "no subscribers" });

  // already-sent set for these vacancies
  const vids = vacancies.map((v: any) => v.vacancy_id);
  const { data: log } = await admin.from("push_log").select("endpoint, vacancy_id").in("vacancy_id", vids);
  const sentSet = new Set((log ?? []).map((r: any) => r.endpoint + "|" + r.vacancy_id));

  function matches(sub: any, v: any): boolean {
    const lvl = sub.pay_level;
    if (lvl != null) {
      // req_level1/req_level2 are stored as text — parse before comparing to the int pay_level
      const ok = levelInt(v.req_level1) === lvl || levelInt(v.req_level2) === lvl || levelInt(v.level_text) === lvl;
      if (!ok) return false;
    }
    const mins: string[] = sub.ministries || [];
    if (mins.length) {
      const mm = String(v.ministry || "").toLowerCase();
      if (!mins.some((m) => mm.includes(String(m).toLowerCase()))) return false;
    }
    return true;
  }

  const toLog: { endpoint: string; vacancy_id: string }[] = [];
  const deadEndpoints: string[] = [];
  let sent = 0;

  for (const sub of subs) {
    if (sent >= TOTAL_CAP) break;
    const subJson = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    const candidates = vacancies
      .filter((v: any) => !sentSet.has(sub.endpoint + "|" + v.vacancy_id) && matches(sub, v))
      .slice(0, PER_SUB_CAP);

    for (const v of candidates) {
      if (sent >= TOTAL_CAP) break;
      const bits = [v.level_text, v.ministry].filter(Boolean).join(" · ");
      const payload = JSON.stringify({
        title: String(v.post_name || "New deputation vacancy"),
        body: bits,
        url: SITE + "/?v=" + encodeURIComponent(v.vacancy_id),
        tag: "vac-" + v.vacancy_id,
      });
      try {
        await webpush.sendNotification(subJson as any, payload);
        toLog.push({ endpoint: sub.endpoint, vacancy_id: v.vacancy_id });
        sent++;
      } catch (e: any) {
        const code = e && (e.statusCode || e.status);
        if (code === 404 || code === 410) { deadEndpoints.push(sub.endpoint); break; }
        // other errors: skip this one, keep the subscription
      }
    }
  }

  if (toLog.length) await admin.from("push_log").upsert(toLog, { onConflict: "endpoint,vacancy_id" });
  if (deadEndpoints.length) await admin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);

  return json({ ok: true, subscribers: subs.length, vacancies: vacancies.length, sent, pruned: deadEndpoints.length });
});
