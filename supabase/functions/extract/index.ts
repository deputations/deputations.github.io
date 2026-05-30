// ============================================================================
// Edge Function: extract
// Pulls a source (PDF in Storage, or a URL), sends it to Gemini, and inserts
// the extracted deputation vacancies as DRAFT rows for admin review.
//
// Invoked by admin-ingest.js after an upload:
//   POST /functions/v1/extract   { "ingest_job_id": "<uuid>" }
//   Authorization: Bearer <admin's supabase access token>
//
// Secrets required (supabase secrets set ...):
//   GEMINI_API_KEY        — Google AI Studio key
//   GEMINI_MODEL          — optional, default 'gemini-2.5-flash'
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---- the structured shape we ask Gemini to return -------------------------
const VACANCY_ITEM = {
  type: "object",
  properties: {
    is_deputation: { type: "boolean" },
    ministry: { type: "string" },
    department: { type: "string" },
    organisation: { type: "string" },
    post_name: { type: "string" },
    level: { type: "string" },
    location_city: { type: "string" },
    location_state: { type: "string" },
    req_level1: { type: "string" },
    req_level2: { type: "string" },
    min_years_experience: { type: "string" },
    min_years_experience2: { type: "string" },
    no_of_posts: { type: "string" },
    deputation_period_years: { type: "string" },
    deputation_type: { type: "string" },
    notification_date: { type: "string" },
    last_date_to_apply: { type: "string" },
    official_notification_link: { type: "string" },
    essential_qualification: { type: "string" },
    eligible_service: { type: "string" },
    mode_of_application: { type: "string" },
    tags_keywords: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["post_name", "is_deputation", "confidence"],
};

const RESPONSE_SCHEMA = { type: "array", items: VACANCY_ITEM };

const BASE_RULES = `
Return ONE row per (post × location/bench × pay level). If an advertisement
lists a post available at several benches/cities or several levels, expand it
into multiple rows — never collapse them.
Dates MUST be ISO format yyyy-mm-dd. If only a closing date is given, fill
last_date_to_apply. If you cannot determine a field, return an empty string "".
"level" and "req_level1" are the Pay Matrix level NUMBER as a string (e.g. "12").
Set confidence to "high" only when the post, level, location and a date are all
clearly stated; otherwise "medium" or "low".
`;

const PROMPTS: Record<string, string> = {
  notification: `You are extracting Government of India DEPUTATION vacancies from a single
official notification/advertisement PDF. Extract EVERY advertised post.
Set is_deputation=true for posts open on deputation or deputation/absorption
basis (that is the norm for these notifications).
${BASE_RULES}`,

  employment_news: `You are extracting Government of India DEPUTATION vacancies from the weekly
"Employment News" newspaper PDF. It contains MANY unrelated advertisements.
INCLUDE a post ONLY if it is open on DEPUTATION or DEPUTATION/ABSORPTION basis
(also "deputation including short-term contract" / "deputation (ISTC)").
EXCLUDE direct recruitment, contract/tenure engagement, walk-in interviews,
apprenticeships, and absorption-only posts. Set is_deputation=false for any
row you are unsure about rather than guessing.
${BASE_RULES}`,

  url: `You are extracting Government of India DEPUTATION vacancies from the text of a
web page describing a recruitment/notification. Extract every advertised post
open on deputation or deputation/absorption basis.
${BASE_RULES}`,
};

// ---- helpers ---------------------------------------------------------------
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function minCodeFromMinistry(ministry: string): string {
  const cleaned = (ministry || "")
    .replace(/ministry of|department of|govt\.? of india|government of india/gi, "")
    .replace(/[^A-Za-z ]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const code = words.map((w) => w[0].toUpperCase()).join("").slice(0, 5);
  return code || "DEP";
}

async function callGemini(promptText: string, parts: unknown[]) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }, ...parts] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  try {
    return JSON.parse(text);
  } catch {
    // strip ```json fences if the model added them
    const m = text.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  }
}

// ---- main ------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // --- authenticate caller and require admin ---
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await admin.auth.getUser(token);
  const email = userData?.user?.email ?? "";
  if (!email) return json({ error: "Not authenticated" }, 401);
  const { data: adminRow } = await admin
    .from("admins").select("email").ilike("email", email).maybeSingle();
  if (!adminRow) return json({ error: "Not authorised" }, 403);

  // --- load the job ---
  let ingest_job_id = "";
  try {
    ({ ingest_job_id } = await req.json());
  } catch { /* ignore */ }
  if (!ingest_job_id) return json({ error: "ingest_job_id required" }, 400);

  const { data: job, error: jobErr } = await admin
    .from("ingest_jobs").select("*").eq("id", ingest_job_id).single();
  if (jobErr || !job) return json({ error: "Job not found" }, 404);

  await admin.from("ingest_jobs").update({ status: "processing" }).eq("id", job.id);

  try {
    const prompt = PROMPTS[job.source_type] ?? PROMPTS.notification;
    let parts: unknown[] = [];

    if (job.source_file_url) {
      // PDF stored in the 'sources' bucket; source_file_url holds the object path
      const { data: blob, error: dlErr } = await admin.storage
        .from("sources").download(job.source_file_url);
      if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      parts = [{ inlineData: { mimeType: "application/pdf", data: toBase64(bytes) } }];
    } else if (job.source_url) {
      const r = await fetch(job.source_url);
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("pdf")) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        parts = [{ inlineData: { mimeType: "application/pdf", data: toBase64(bytes) } }];
      } else {
        const html = await r.text();
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200_000);
        parts = [{ text: `WEB PAGE CONTENT:\n${text}` }];
      }
    } else {
      throw new Error("Job has neither source_file_url nor source_url");
    }

    const items: any[] = await callGemini(prompt, parts);
    const kept = items.filter((it) => it && it.is_deputation !== false && it.post_name);

    const year = new Date().getFullYear();
    const rows = kept.map((it, i) => {
      const min_code = minCodeFromMinistry(it.ministry || "");
      const level = (it.level || it.req_level1 || "").toString().replace(/\D/g, "");
      const seq = String(i + 1).padStart(3, "0");
      return {
        vacancy_id: `${min_code}-${year}-L${level || "X"}-${seq}`,
        ministry: it.ministry || "",
        min_code,
        department: it.department || "",
        organisation: it.organisation || "",
        post_name: it.post_name || "",
        level: level,
        level_text: level ? `Level-${level}` : "",
        location_city: it.location_city || "",
        location_state: it.location_state || "",
        req_level1: (it.req_level1 || level || "").toString().replace(/\D/g, ""),
        req_level2: (it.req_level2 || "").toString().replace(/\D/g, ""),
        min_years_experience: it.min_years_experience || "",
        min_years_experience2: it.min_years_experience2 || "",
        no_of_posts: (it.no_of_posts || "").toString(),
        deputation_period_years: (it.deputation_period_years || "").toString(),
        deputation_type: it.deputation_type || "",
        notification_date: it.notification_date || "",
        last_date_to_apply: it.last_date_to_apply || "",
        official_notification_link: it.official_notification_link || job.source_url || "",
        essential_qualification: it.essential_qualification || "",
        eligible_service: it.eligible_service || "",
        mode_of_application: it.mode_of_application || "",
        tags_keywords: it.tags_keywords || "",
        status: "draft",
        confidence: it.confidence || "medium",
        source_type: job.source_type,
        source_category: job.source_label || "",
        source_file_url: job.source_file_url || job.source_url || "",
        ingest_job_id: job.id,
        raw_extraction: it,
      };
    });

    if (rows.length) {
      const { error: insErr } = await admin.from("vacancies").insert(rows);
      if (insErr) throw new Error(`insert failed: ${insErr.message}`);
    }

    await admin.from("ingest_jobs")
      .update({ status: "done", rows_extracted: rows.length, error: null })
      .eq("id", job.id);

    return json({ ok: true, rows_extracted: rows.length, candidates: items.length });
  } catch (err) {
    await admin.from("ingest_jobs")
      .update({ status: "error", error: String(err) }).eq("id", job.id);
    return json({ error: String(err) }, 500);
  }
});
