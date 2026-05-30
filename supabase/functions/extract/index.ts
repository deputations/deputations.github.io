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
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

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
    application_form_link: { type: "string" },
    source_website: { type: "string" },
    organisation_type: { type: "string" },
    functional_area: { type: "string" },
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
last_date_to_apply. If the ad says applications are due "within N days" / "N days
from the date of this notification/advertisement", COMPUTE last_date_to_apply by
adding N days to notification_date and return the computed ISO date.
"level" and "req_level1" are the Pay Matrix level NUMBER as a string (e.g. "12").
Also capture, when present:
- organisation_type: nature of the body (e.g. "Ministry/Department", "Attached Office",
  "Subordinate Office", "PSU/CPSE", "Autonomous Body", "Statutory Body",
  "Tribunal/Commission", "Bank/Financial Institution").
- application_form_link: URL of the application form/proforma, if a link is given.
- source_website: the organisation's website URL, if mentioned.
- functional_area: a short summary of the job description / duties / nature of work
  (a sentence or two), if the ad describes them.
If you cannot determine a field, return an empty string "".
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

function fromBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64; // strip data: prefix
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Split a PDF into page-range chunks (base64). Used for the big Employment News
// issue so each slice is small enough for the model to read carefully — higher
// recall than one giant pass. Small PDFs return a single chunk.
async function splitPdfToBase64(bytes: Uint8Array, pagesPerChunk: number): Promise<string[]> {
  let src;
  try {
    src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return [toBase64(bytes)]; // unparseable -> fall back to whole document
  }
  const total = src.getPageCount();
  if (total <= pagesPerChunk) return [toBase64(bytes)];
  const chunks: string[] = [];
  for (let start = 0; start < total; start += pagesPerChunk) {
    const doc = await PDFDocument.create();
    const idxs: number[] = [];
    for (let p = start; p < Math.min(start + pagesPerChunk, total); p++) idxs.push(p);
    const pages = await doc.copyPages(src, idxs);
    pages.forEach((pg) => doc.addPage(pg));
    chunks.push(toBase64(await doc.save()));
  }
  return chunks;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseItems(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/); // strip ```json fences etc.
    return m ? JSON.parse(m[0]) : [];
  }
}

async function callGemini(promptText: string, parts: unknown[]) {
  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }, ...parts] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  // Try the configured model first, then fall back to a different-capacity
  // model. Retry each on transient overload (503/429/500) with backoff so a
  // brief demand spike doesn't fail the whole ingest.
  // gemini-2.0-flash has 0 free quota on this tier; gemini-2.5-flash is capped at
  // ~20/day; gemini-2.5-flash-lite has plentiful free quota. So: try the quality
  // model, and on a quota error (429) drop straight to flash-lite.
  const models = [GEMINI_MODEL, "gemini-2.5-flash-lite"].filter(
    (m, i, a) => m && a.indexOf(m) === i,
  );
  let lastErr = "Gemini call failed";
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (res.ok) {
        const data = await res.json();
        return parseItems(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]");
      }
      lastErr = `Gemini ${res.status} (${model}): ${await res.text()}`;
      if (res.status === 429) break;                 // quota — switch model now
      if (res.status === 503 || res.status === 500) { // transient overload — retry
        await sleep(1200 * (attempt + 1));
        continue;
      }
      break; // non-transient — try the next model
    }
  }
  throw new Error(lastErr);
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

  // --- get or create the job ---
  // Two modes:
  //   legacy : { ingest_job_id }                      -> use an existing job row
  //   inline : { source_type, source_label, filename, file_base64 }  (browser sends the PDF)
  //          : { source_type, source_label, source_url }              (URL)
  // Inline mode does the storage upload here (service role) so the browser never
  // needs storage permissions.
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  let job: any;
  let inlineBytes: Uint8Array | null = null;

  if (body.ingest_job_id) {
    const { data, error } = await admin.from("ingest_jobs").select("*").eq("id", body.ingest_job_id).single();
    if (error || !data) return json({ error: "Job not found" }, 404);
    job = data;
  } else {
    const source_type = String(body.source_type || "notification");
    const { data, error } = await admin.from("ingest_jobs").insert({
      source_type,
      source_label: body.source_label || "",
      source_url: body.source_url || null,
      created_by: email,
      status: "processing",
    }).select().single();
    if (error || !data) return json({ error: `could not create job: ${error?.message}` }, 500);
    job = data;

    if (body.file_base64) {
      inlineBytes = fromBase64(String(body.file_base64));
      const safe = String(body.filename || "source.pdf").replace(/[^a-z0-9._-]/gi, "_");
      const path = `${Date.now()}_${safe}`;
      const upErr = (await admin.storage.from("sources").upload(path, inlineBytes, { contentType: "application/pdf" })).error;
      if (!upErr) {
        await admin.from("ingest_jobs").update({ source_file_url: path }).eq("id", job.id);
        job.source_file_url = path;
      }
    }
  }

  await admin.from("ingest_jobs").update({ status: "processing" }).eq("id", job.id);

  try {
    const prompt = PROMPTS[job.source_type] ?? PROMPTS.notification;
    let pdfBytes: Uint8Array | null = null;
    let parts: unknown[] = [];   // used only for the non-PDF (HTML) URL case

    if (inlineBytes) {
      pdfBytes = inlineBytes;
    } else if (job.source_file_url) {
      // PDF stored in the 'sources' bucket; source_file_url holds the object path
      const { data: blob, error: dlErr } = await admin.storage
        .from("sources").download(job.source_file_url);
      if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
      pdfBytes = new Uint8Array(await blob.arrayBuffer());
    } else if (job.source_url) {
      const r = await fetch(job.source_url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
        },
      });
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("pdf")) {
        pdfBytes = new Uint8Array(await r.arrayBuffer());
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

    // Gather raw model items. Employment News (big, noisy) is split into page
    // chunks extracted in parallel for higher recall; everything else is one pass.
    let items: any[] = [];
    if (pdfBytes && job.source_type === "employment_news") {
      const chunks = await splitPdfToBase64(pdfBytes, 8);
      const perChunk = await Promise.all(
        chunks.map((b64) => callGemini(prompt, [{ inlineData: { mimeType: "application/pdf", data: b64 } }])
          .catch(() => [])), // a failed chunk shouldn't sink the whole run
      );
      items = perChunk.flat();
    } else {
      if (pdfBytes) parts = [{ inlineData: { mimeType: "application/pdf", data: toBase64(pdfBytes) } }];
      items = await callGemini(prompt, parts);
    }

    // de-duplicate (chunk boundaries / repeated ads) by post+org+location+level
    const seen = new Set<string>();
    const kept = items.filter((it) => {
      if (!it || it.is_deputation === false || !it.post_name) return false;
      const key = [it.post_name, it.organisation, it.location_city, it.level]
        .map((x: unknown) => String(x ?? "").toLowerCase().trim()).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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
        application_form_link: it.application_form_link || "",
        source_website: it.source_website || "",
        organisation_type: it.organisation_type || "",
        functional_area: it.functional_area || "",
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

    return json({ ok: true, rows_extracted: rows.length, candidates: items.length, ingest_job_id: job.id });
  } catch (err) {
    await admin.from("ingest_jobs")
      .update({ status: "error", error: String(err) }).eq("id", job.id);
    return json({ error: String(err) }, 500);
  }
});
