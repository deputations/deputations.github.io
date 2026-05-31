// ============================================================================
// Edge Function: submit  (PUBLIC — deploy with --no-verify-jwt)
// Backs the public site forms with Supabase instead of Apps Script + Sheet:
//   action:"vacancy"  -> a low-confidence DRAFT vacancy in the review queue
//   action:"feedback" -> a row in the feedback table
// Honeypot ("website" field) drops bots silently. Service role writes (so no
// public table permissions are exposed).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function storeToDrive(base64: string, filename: string): Promise<string> {
  if (!APPS_SCRIPT_URL) return "";
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drive_store", file_base64: base64, filename }),
    });
    if (!r.ok) return "";
    const d = await r.json();
    return d?.ok && d.url ? d.url : "";
  } catch { return ""; }
}

function minCode(ministry: string): string {
  const c = String(ministry || "").replace(/ministry of|department of|govt\.? of india|government of india/gi, "")
    .replace(/[^A-Za-z ]/g, " ").trim();
  const w = c.split(/\s+/).filter(Boolean);
  return w.map((x) => x[0].toUpperCase()).join("").slice(0, 5) || "DEP";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { try { body = JSON.parse(await req.text()); } catch { /* */ } }

  // honeypot — pretend success so bots stop
  if (body.website) return json({ ok: true, success: true, reportId: "RV-IGNORED" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const action = String(body.action || "vacancy").toLowerCase();

  // ---------- feedback ----------
  if (action === "feedback") {
    if (!String(body.message || "").trim()) return json({ ok: false, message: "Message is required." });
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return json({ ok: false, message: "Email looks invalid." });
    const { error } = await admin.from("feedback").insert({
      category: body.category || "", subject: body.subject || "", message: body.message || "",
      name: body.name || "", email: body.email || "", related_page: body.relatedPage || "",
      related_link: body.relatedLink || "", page_context: body.pageContext || "", user_agent: body.userAgent || "",
    });
    if (error) return json({ ok: false, message: error.message }, 500);
    return json({ ok: true, success: true, feedbackId: "FB-" + Date.now().toString(36).toUpperCase() });
  }

  // ---------- vacancy tip ----------
  const title = String(body.title || "").trim();
  const org = String(body.organization || "").trim();
  if (!title || !org) return json({ ok: false, message: "Title and organisation are required." });
  if (body.submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.submitterEmail)) {
    return json({ ok: false, message: "Submitter email looks invalid." });
  }

  let source_file_url = "";
  if (body.pdf && body.pdf.base64) {
    source_file_url = await storeToDrive(String(body.pdf.base64), String(body.pdf.filename || "tip.pdf"));
  }

  const ministry = String(body.ministry || "");
  const level = String(body.payLevel || "").replace(/\D/g, "");
  const minYears = String(body.minYears || "").replace(/\D/g, "");
  // Public tips are single-tier (the analogous grade); admin refines on review.
  const eligibility_tiers = level
    ? [{ level: parseInt(level, 10), min_years: minYears ? parseInt(minYears, 10) : 0 }]
    : [];
  const notes = [
    body.submitterName ? `Submitter: ${body.submitterName}` : "",
    body.submitterEmail ? `<${body.submitterEmail}>` : "",
    body.manualSourceDetails ? `Source: ${body.manualSourceDetails}` : "",
    body.seenAt ? `Seen at: ${body.seenAt}` : "",
    "[public tip — verify before approving]",
  ].filter(Boolean).join(" · ");

  const row = {
    vacancy_id: `TIP-${new Date().getFullYear()}-L${level || "X"}-${Date.now() % 100000}`,
    post_name: title, organisation: org, ministry, min_code: minCode(ministry),
    level, level_text: level ? `Level-${level}` : "",
    req_level1: level, min_years_experience: minYears,
    eligibility_tiers,
    location_city: String(body.location || ""),
    no_of_posts: String(body.numberOfPosts || ""),
    last_date_to_apply: String(body.deadline || ""),
    eligible_service: String(body.eligibility || ""),
    functional_area: String(body.description || ""),
    official_notification_link: String(body.sourceUrl || "") ||
      (/^https?:\/\//i.test(source_file_url) ? source_file_url : ""),
    source_file_url,
    source_type: "public_tip", source_category: "Public tip",
    status: "draft", confidence: "low", reviewer_notes: notes,
  };

  const { error } = await admin.from("vacancies").upsert([row], { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error) return json({ ok: false, message: error.message }, 500);
  return json({
    ok: true, success: true,
    reportId: `RV-${new Date().getFullYear()}-${(Date.now() % 1000000).toString().padStart(6, "0")}`,
  });
});
