// ============================================================================
// Edge Function: push-subscribe  (PUBLIC — deploy with --no-verify-jwt)
// Stores / updates / removes a browser Web Push subscription for vacancy alerts
// (WEBSITE-REVIEW P1-3). No accounts: keyed by the opaque push endpoint.
//   action:"subscribe"   -> upsert { subscription, payLevel, ministries }
//   action:"unsubscribe" -> delete by endpoint
// Service role writes, so the push_subscriptions table stays private (no anon RLS).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const action = String(body.action || "subscribe").toLowerCase();
  const sub = body.subscription || {};
  const endpoint = String(sub.endpoint || "").trim();
  if (!/^https:\/\//.test(endpoint)) return json({ ok: false, message: "Invalid subscription." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  if (action === "unsubscribe") {
    const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) return json({ ok: false, message: error.message }, 500);
    return json({ ok: true, success: true, unsubscribed: true });
  }

  // subscribe / update
  const keys = sub.keys || {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  if (!p256dh || !auth) return json({ ok: false, message: "Missing subscription keys." }, 400);

  const payLevelRaw = body.payLevel;
  const payLevel = Number.isFinite(+payLevelRaw) && +payLevelRaw > 0 ? Math.trunc(+payLevelRaw) : null;
  const ministries = Array.isArray(body.ministries)
    ? body.ministries.map((m: unknown) => String(m).slice(0, 200)).filter(Boolean).slice(0, 40)
    : [];

  const { error } = await admin.from("push_subscriptions").upsert({
    endpoint,
    p256dh,
    auth,
    pay_level: payLevel,
    ministries,
    ua: String(body.userAgent || req.headers.get("user-agent") || "").slice(0, 300),
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return json({ ok: false, message: error.message }, 500);
  return json({ ok: true, success: true, subscribed: true });
});
