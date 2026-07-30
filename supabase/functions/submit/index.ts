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
    const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const { error } = await admin.from("feedback").insert({
      category: cap(body.category, 80), subject: cap(body.subject, 200), message: cap(body.message, 6000),
      name: cap(body.name, 120), email: cap(body.email, 160),
      page: cap(body.page, 200), page_label: cap(body.pageLabel, 200),
      related_page: cap(body.relatedPage, 400), related_link: cap(body.relatedLink, 600),
      page_context: cap(body.pageContext, 400), user_agent: cap(body.userAgent, 400),
    });
    if (error) return json({ ok: false, message: error.message }, 500);
    return json({ ok: true, success: true, feedbackId: "FB-" + Date.now().toString(36).toUpperCase() });
  }

  // ---------- community flag on a vacancy ----------
  if (action === "flag") {
    const vacancyId = String(body.vacancyId || "").trim();
    const issueType = String(body.issueType || "").trim();
    const VALID_ISSUES = ["broken_link","wrong_link","wrong_pay_level","wrong_deadline","closed_already","wrong_location","duplicate","other"];
    if (!vacancyId) return json({ ok: false, message: "Vacancy reference is required." });
    if (!VALID_ISSUES.includes(issueType)) return json({ ok: false, message: "Please choose what's wrong." });
    if (body.reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.reporterEmail)) {
      return json({ ok: false, message: "Email looks invalid." });
    }
    const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const { data, error } = await admin.from("vacancy_flags").insert({
      vacancy_id: vacancyId,
      field: cap(body.field, 60) || "whole",
      issue_type: issueType,
      note: cap(body.note, 600),
      suggested_value: cap(body.suggestedValue, 600),
      reporter_name: cap(body.reporterName, 120),
      reporter_email: cap(body.reporterEmail, 160),
    }).select("id").single();
    if (error) return json({ ok: false, message: error.message }, 500);
    return json({ ok: true, success: true, flagId: data?.id || null });
  }

  // ---------- endorse an existing open flag ----------
  if (action === "endorse") {
    const flagId = String(body.flagId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(flagId)) return json({ ok: false, message: "Invalid flag reference." });
    const { data, error } = await admin.rpc("endorse_flag", { flag_id: flagId });
    if (error) return json({ ok: false, message: error.message }, 500);
    if (data === null || data === undefined) return json({ ok: false, message: "That report is no longer open." });
    return json({ ok: true, success: true, endorsements: data });
  }

  // ---------- community discrepancy on an FAQ answer ----------
  if (action === "faq_report") {
    const qnum = String(body.qnum || "").trim().slice(0, 8);
    const report = String(body.report || "").trim();
    if (!qnum) return json({ ok: false, message: "Missing question reference." }, 400);
    if (report.length < 10) return json({ ok: false, message: "Please describe the discrepancy." }, 400);
    const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const { data, error } = await admin.from("faq_reports").insert({
      qnum,
      qtext: cap(body.qtext, 400),
      report: cap(report, 2000),
      name: cap(body.name, 80),
      user_agent: cap(body.userAgent, 400),
    }).select("id").single();
    if (error) return json({ ok: false, message: error.message }, 500);
    return json({ ok: true, success: true, reportId: data?.id });
  }

  // ---------- vote on an FAQ discrepancy ----------
  if (action === "faq_vote") {
    const id = String(body.id || "").trim();
    const voter = String(body.voter || "").trim();
    const side = String(body.vote || "").trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, message: "Invalid report reference." }, 400);
    if (side !== "agree" && side !== "disagree") return json({ ok: false, message: "Invalid vote." }, 400);
    const { data, error } = await admin.rpc("faq_vote", { p_id: id, p_voter: voter, p_side: side });
    if (error) return json({ ok: false, message: error.message }, 500);
    if (data === null) return json({ ok: false, message: "That report is no longer open." }, 400);
    return json({ ok: true, success: true, agree: data.agree, disagree: data.disagree });
  }

  // ---------- list open FAQ discrepancies (public SELECT, admin-bypass works
  // automatically because the service role bypasses RLS).
  if (action === "faq_list") {
    const { data, error } = await admin
      .from("faq_reports")
      .select("id, qnum, qtext, report, name, agree, disagree, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ ok: false, message: error.message }, 500);
    const reports = (data || []).map((r: any) => ({
      id: r.id,
      qnum: r.qnum,
      qtext: r.qtext || "",
      report: r.report || "",
      name: r.name || "",
      agree: Number(r.agree) || 0,
      disagree: Number(r.disagree) || 0,
      timestamp: r.created_at,
    }));
    return json({ ok: true, success: true, reports });
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
  // Pay level kept as a TOKEN ("12", "13A" — the exceptional grade between 13
  // and 14); A needs a word boundary so "13 and above" stays "13".
  const lvlMatch = String(body.payLevel || "").toUpperCase().match(/(\d+)([\s-]*A\b)?/);
  const level = lvlMatch ? lvlMatch[1] + (lvlMatch[2] ? "A" : "") : "";
  const minYears = String(body.minYears || "").replace(/\D/g, "");
  // Public tips are single-tier (the analogous grade); admin refines on review.
  const eligibility_tiers = level
    ? [{ level, min_years: minYears ? parseInt(minYears, 10) : 0 }]
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
