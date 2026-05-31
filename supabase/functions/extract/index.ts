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
// Fallback providers (used when Gemini's free 20/day quota is exhausted).
const MISTRAL_KEY = Deno.env.get("MISTRAL_API_KEY") ?? "";
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "google/gemma-4-31b-it:free";

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
    source_page: { type: "string" },
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
"source_page" = the PDF page number where this advertisement appears, as a string.
Also capture, when present:
- ministry: the standard Government of India ministry, WITHOUT the "Ministry of" /
  "Department of" prefix (e.g. "Agriculture and Farmers Welfare", "Home Affairs",
  "Personnel, Public Grievances and Pensions").
- organisation_type: EXACTLY one of: "Ministry", "Department",
  "Attached and Subordinate Offices", "Constitutional Bodies", "Statutory Bodies",
  "Autonomous Bodies", "Central Public Sector Enterprises (CPSEs)".
- application_form_link: URL of the application form/proforma, if a link is given.
- source_website: the organisation's website URL, if mentioned.
- functional_area: a short summary of the job description / duties / nature of work
  (a sentence or two), if the ad describes them.
If you cannot determine a field, return an empty string "".
Set confidence to "high" only when the post, level, location and a date are all
clearly stated; otherwise "medium" or "low".

Output ONLY a JSON array (no prose, no markdown fences). Each object MUST use
EXACTLY these keys (empty string "" when unknown):
{"is_deputation","ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}
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

type Src = { pdfBase64?: string; text?: string };

function asArray(out: any): any[] {
  if (Array.isArray(out)) return out;
  if (out && Array.isArray(out.vacancies)) return out.vacancies;
  if (out && typeof out === "object") return (Object.values(out).find(Array.isArray) as any[]) ?? [];
  return [];
}

// ---- Gemini (native PDF, JSON schema). flash -> flash-lite, retry on overload ----
async function geminiCall(promptText: string, src: Src): Promise<any[]> {
  const parts: unknown[] = [{ text: promptText }];
  if (src.pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: src.pdfBase64 } });
  else if (src.text) parts.push({ text: src.text });
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  };
  const models = [GEMINI_MODEL, "gemini-2.5-flash-lite"].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = "gemini failed";
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (res.ok) return asArray(parseItems((await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]"));
      lastErr = `Gemini ${res.status} (${model})`;
      if (res.status === 429) break;                  // quota — next model / provider
      if (res.status === 503 || res.status === 500) { await sleep(1200 * (attempt + 1)); continue; }
      break;
    }
  }
  throw new Error(lastErr);
}

// ---- Mistral: OCR the PDF to text (handles searchable AND scanned), then
// extract structured JSON from that text. (document_url chat was unreliable.) ----
async function mistralCall(promptText: string, src: Src): Promise<any[]> {
  if (!MISTRAL_KEY) throw new Error("no mistral key");
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${MISTRAL_KEY}` };
  let docText = src.text || "";
  if (src.pdfBase64) {
    const ocr = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST", headers: auth,
      body: JSON.stringify({ model: "mistral-ocr-latest", document: { type: "document_url", document_url: `data:application/pdf;base64,${src.pdfBase64}` } }),
    });
    if (!ocr.ok) throw new Error(`Mistral OCR ${ocr.status}: ${(await ocr.text()).slice(0, 160)}`);
    const od = await ocr.json();
    docText = (od.pages ?? []).map((p: any) => p.markdown ?? "").join("\n\n");
  }
  if (!docText.trim()) throw new Error("mistral: no text from source");
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST", headers: auth,
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [{ role: "user", content: promptText + "\nReturn ONLY a JSON array.\n\nDOCUMENT:\n" + docText.slice(0, 120_000) }],
      response_format: { type: "json_object" }, temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Mistral ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return asArray(parseItems((await res.json())?.choices?.[0]?.message?.content ?? "[]"));
}

// ---- OpenRouter (TEXT only on the free tier — PDFs require a paid balance,
// and Gemini/Mistral already cover PDFs natively). Good for HTML/URL sources. ----
async function openrouterCall(promptText: string, src: Src): Promise<any[]> {
  if (!OPENROUTER_KEY) throw new Error("no openrouter key");
  if (!src.text) throw new Error("openrouter: free tier is text-only (PDF needs balance)");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://deputations.github.io", "X-Title": "Deputations",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: promptText + "\nReturn ONLY a JSON array.\n\nWEB PAGE CONTENT:\n" + src.text }],
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return asArray(parseItems((await res.json())?.choices?.[0]?.message?.content ?? "[]"));
}

// Provider chain: Gemini -> Mistral -> OpenRouter. Each is tried when the prior
// fails (notably Gemini's 20/day quota). First success wins.
async function aiExtract(promptText: string, src: Src, used?: Set<string>): Promise<any[]> {
  const providers: Array<[string, (p: string, s: Src) => Promise<any[]>]> = [["gemini", geminiCall]];
  if (MISTRAL_KEY) providers.push(["mistral", mistralCall]);
  if (OPENROUTER_KEY) providers.push(["openrouter", openrouterCall]);
  let lastErr = "all providers failed";
  for (const [name, fn] of providers) {
    try { const out = await fn(promptText, src); used?.add(name); return out; }
    catch (e) { lastErr = `${name}: ${e}`; }
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

  // --- health check: ping each provider (uses ~1 request each). ---
  if (body.healthcheck) {
    // dailyCap=true → a 429 means a real daily quota (Gemini). Otherwise a 429 is
    // usually a transient shared-pool rate-limit, so retry once before reporting.
    const ping = async (fn: () => Promise<Response>, dailyCap: boolean) => {
      try {
        let r = await fn();
        if (!r.ok && r.status === 429 && !dailyCap) { await sleep(1500); r = await fn(); }
        if (r.ok) return "ok";
        if (r.status === 429) return dailyCap ? "quota exhausted (resets daily)" : "busy — rate-limited (transient)";
        return `error ${r.status}`;
      } catch (e) { return "error: " + String(e).slice(0, 60); }
    };
    const gemini = await ping(() => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }) }), true);
    const mistral = !MISTRAL_KEY ? "not configured" : await ping(() => fetch(
      "https://api.mistral.ai/v1/chat/completions",
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${MISTRAL_KEY}` }, body: JSON.stringify({ model: "mistral-small-latest", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }) }), false);
    const openrouter = !OPENROUTER_KEY ? "not configured" : await ping(() => fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` }, body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }) }), false);
    return json({ ok: true, gemini, mistral, openrouter });
  }

  // --- store-only mode: just save a PDF to storage (used by the paste flow so
  // the EN issue can be shown side-by-side in review). No Gemini call. ---
  if (body.store_only) {
    if (!body.file_base64) return json({ error: "file_base64 required" }, 400);
    const bytes = fromBase64(String(body.file_base64));
    const safe = String(body.filename || "source.pdf").replace(/[^a-z0-9._-]/gi, "_");
    const path = `${Date.now()}_${safe}`;
    const up = await admin.storage.from("sources").upload(path, bytes, { contentType: "application/pdf" });
    if (up.error) return json({ error: "upload failed: " + up.error.message }, 500);
    return json({ ok: true, path });
  }

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
    let htmlText = "";   // used only for the non-PDF (HTML) URL case

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
      if (ct.includes("pdf") || job.source_url.toLowerCase().endsWith(".pdf")) {
        pdfBytes = new Uint8Array(await r.arrayBuffer());
        // keep a copy so review can show the PDF side-by-side (the live URL may
        // block embedding or change later)
        try {
          let safe = (job.source_url.split("/").pop() || "source.pdf").split("?")[0]
            .replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
          if (!safe.toLowerCase().endsWith(".pdf")) safe += ".pdf";
          const path = `${Date.now()}_${safe}`;
          const up = await admin.storage.from("sources").upload(path, pdfBytes, { contentType: "application/pdf" });
          if (!up.error) {
            await admin.from("ingest_jobs").update({ source_file_url: path }).eq("id", job.id);
            job.source_file_url = path;
          }
        } catch { /* keep going even if storage copy fails */ }
      } else {
        const html = await r.text();
        htmlText = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200_000);
      }
    } else {
      throw new Error("Job has neither source_file_url nor source_url");
    }

    // Gather raw model items. Employment News (big, noisy) is split into page
    // chunks extracted in parallel for higher recall; everything else is one pass.
    const used = new Set<string>();
    let items: any[] = [];
    if (pdfBytes && job.source_type === "employment_news") {
      const chunks = await splitPdfToBase64(pdfBytes, 8);
      const perChunk = await Promise.all(
        chunks.map((b64) => aiExtract(prompt, { pdfBase64: b64 }, used).catch(() => [])),
      );
      items = perChunk.flat();
    } else if (pdfBytes) {
      items = await aiExtract(prompt, { pdfBase64: toBase64(pdfBytes) }, used);
    } else {
      items = await aiExtract(prompt, { text: htmlText }, used);
    }

    // de-duplicate (chunk boundaries / repeated ads) by post+org+location+level
    const seen = new Set<string>();
    const kept = items.filter((it) => {
      if (!it || !it.post_name) return false;
      // Only Employment News needs the deputation filter (it's a mixed newspaper).
      // Single notifications / circulars / URLs: keep every advertised post.
      if (job.source_type === "employment_news" && it.is_deputation === false) return false;
      const key = [it.post_name, it.organisation, it.location_city, it.level, it.notification_date]
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

    let inserted = 0;
    if (rows.length) {
      // ignoreDuplicates -> ON CONFLICT (dedup_key) DO NOTHING: any vacancy already
      // present (this batch's run-dedup, or a prior draft/approved row) is skipped.
      const { data: ins, error: insErr } = await admin.from("vacancies")
        .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw new Error(`insert failed: ${insErr.message}`);
      inserted = ins?.length ?? 0;
    }

    await admin.from("ingest_jobs")
      .update({ status: "done", rows_extracted: inserted, error: null })
      .eq("id", job.id);

    return json({
      ok: true, rows_extracted: inserted, duplicates_skipped: rows.length - inserted,
      candidates: items.length, ingest_job_id: job.id, providers: [...used],
    });
  } catch (err) {
    await admin.from("ingest_jobs")
      .update({ status: "error", error: String(err) }).eq("id", job.id);
    return json({ error: String(err) }, 500);
  }
});
