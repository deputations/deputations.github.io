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
const MISTRAL_MODEL = Deno.env.get("MISTRAL_MODEL") ?? "mistral-large-latest";
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "google/gemma-4-31b-it:free";
// Apps Script web app that stores PDFs in your Google Drive and returns a link.
const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";

// Store a PDF in Google Drive via the Apps Script proxy; returns a public view
// URL, or null on any failure (caller then falls back to Supabase storage).
async function storeToDrive(base64: string, filename: string): Promise<string | null> {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drive_store", file_base64: base64, filename }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.ok && d.url ? d.url : null;
  } catch { return null; }
}

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
    eligibility_tiers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string" },
          min_years: { type: "string" },
        },
      },
    },
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
    detailed_eligibility: { type: "string" },
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
"eligibility_tiers" is the list of feeder grades the post is open to. A deputation
post is usually open to officers from one OR MORE pay levels, each with its own
minimum service. Return one entry per feeder grade as {"level","min_years"} where
level is the Pay Matrix level NUMBER (string) and min_years is the required years
of regular service AT THAT LEVEL (string, "0" for an analogous-post / no-minimum
tier). Example — a Level-11 post worded "(i) analogous; OR (ii) Level-10 with 3
years; OR (iii) Level-8 with 5 years" becomes:
  [{"level":"11","min_years":"0"},{"level":"10","min_years":"3"},{"level":"8","min_years":"5"}]
Always include the analogous tier (the post's own level, min_years "0") when the
ad says "holding analogous posts". Still ALSO fill req_level1/req_level2 and
min_years_experience/min_years_experience2 with the first two tiers for backward
compatibility. If only one grade is eligible, return a single-entry array.
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
- detailed_eligibility: COPY VERBATIM the complete eligibility / qualification
  conditions block exactly as printed in the source for THIS post (feeder grades &
  pay levels, essential and desirable qualifications, experience, and age limit).
  Do NOT paraphrase, summarise, translate, or reorder; preserve the original wording
  and clause numbering. One block per post row.
  When the source separates these conditions into LABELLED sections (e.g. "Eligibility
  / Essential Criteria", "Desirable Criteria", "Experience", "Age Limit",
  "Qualification"), preserve each label as its own subheading line wrapped in double
  asterisks — e.g. **Essential Criteria** — placed on its own line, immediately
  followed by that section's verbatim text, with a blank line between sections. Use
  the source's OWN label wording; do NOT invent headings. If the source is a single
  unlabelled paragraph, return it as-is without adding any heading. Return "" if the
  ad states no such conditions.
If you cannot determine a field, return an empty string "".
Set confidence to "high" only when the post, level, location and a date are all
clearly stated; otherwise "medium" or "low".

Output ONLY a JSON array (no prose, no markdown fences). Each object MUST use
EXACTLY these keys (empty string "" when unknown):
{"is_deputation","ministry","department","organisation","organisation_type","post_name","level","req_level1","req_level2","min_years_experience","min_years_experience2","eligibility_tiers","location_city","location_state","no_of_posts","deputation_period_years","deputation_type","notification_date","last_date_to_apply","official_notification_link","application_form_link","source_website","essential_qualification","detailed_eligibility","eligible_service","mode_of_application","functional_area","tags_keywords","source_page","confidence"}
`;

const PROMPTS: Record<string, string> = {
  notification: `You are extracting Government of India DEPUTATION vacancies from a single
official notification / vacancy circular PDF. Extract EVERY post named in the document.
If it is an EXTENSION, CORRIGENDUM, or REMINDER that references an earlier circular,
STILL extract the post(s) it names using whatever details are present (e.g. the
extended last date, the referenced notification date). Treat posts as deputation
(is_deputation=true) unless the document clearly says otherwise. Return [] only if no
post is named anywhere in the document.
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

// Normalise the model's eligibility_tiers into a clean [{level:int, min_years:int}]
// array. Falls back to the legacy req_level1/2 + min_years fields when the model
// didn't return tiers. One tier per level (lowest min_years wins), sorted desc.
function normalizeTiers(it: any): Array<{ level: number; min_years: number }> {
  const toInt = (v: unknown) => {
    const m = String(v ?? "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  };
  let raw: any[] = Array.isArray(it?.eligibility_tiers) ? it.eligibility_tiers : [];
  let tiers = raw
    .map((t) => ({ level: toInt(t?.level), min_years: toInt(t?.min_years) ?? 0 }))
    .filter((t) => t.level !== null) as Array<{ level: number; min_years: number }>;
  if (!tiers.length) {
    const l1 = toInt(it?.req_level1) ?? toInt(it?.level);
    if (l1 !== null) tiers.push({ level: l1, min_years: toInt(it?.min_years_experience) ?? 0 });
    const l2 = toInt(it?.req_level2);
    if (l2 !== null) tiers.push({ level: l2, min_years: toInt(it?.min_years_experience2) ?? 0 });
  }
  const byLevel = new Map<number, { level: number; min_years: number }>();
  for (const t of tiers) {
    const prev = byLevel.get(t.level);
    if (!prev || t.min_years < prev.min_years) byLevel.set(t.level, t);
  }
  return [...byLevel.values()].sort((a, b) => b.level - a.level);
}

// ---------------------------------------------------------------------------
// Smart duplicate-merge helpers.
// NOTE: keysOf/smartMerge are mirrored in admin-ingest.js — keep them in sync.
// Content columns that participate in the merge/diff (provenance + metadata
// columns are handled separately). detailed_eligibility rides in raw_extraction.
// ---------------------------------------------------------------------------
const CONTENT_FIELDS = [
  "ministry", "min_code", "department", "organisation", "organisation_type",
  "post_name", "level", "level_text", "location_city", "location_state",
  "req_level1", "req_level2", "min_years_experience", "min_years_experience2",
  "eligibility_tiers", "no_of_posts", "deputation_period_years", "deputation_type",
  "notification_date", "last_date_to_apply", "official_notification_link",
  "application_form_link", "source_website", "functional_area",
  "essential_qualification", "eligible_service", "mode_of_application", "tags_keywords",
];

const normPart = (s: unknown) =>
  String(s ?? "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
const normLevel = (s: unknown) => String(s ?? "").replace(/[^0-9]/g, "");

// Replicates the generated dedup_key (0002) and match_key (0006) exactly.
function keysOf(row: any): { dedupKey: string; matchKey: string } {
  const matchKey = `${normPart(row.organisation)}|${normPart(row.post_name)}|${normPart(row.location_city)}|${normLevel(row.level)}`;
  return { matchKey, dedupKey: `${matchKey}|${String(row.notification_date ?? "").toLowerCase()}` };
}

const isEmptyVal = (v: unknown) =>
  v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
const sameVal = (a: unknown, b: unknown) =>
  (Array.isArray(a) || Array.isArray(b))
    ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    : String(a ?? "").trim() === String(b ?? "").trim();

// Fill blanks + overwrite a field only when the candidate has a non-empty value
// that differs; never blanks out existing data. Returns the patch of changed
// fields (not the whole row) so generated columns are never written.
function smartMerge(existing: any, candidate: any): { patch: any; diff: any; changed: boolean } {
  const patch: any = {}; const diff: any = {};
  for (const f of CONTENT_FIELDS) {
    if (!isEmptyVal(candidate[f]) && !sameVal(candidate[f], existing[f])) {
      patch[f] = candidate[f]; diff[f] = { old: existing[f] ?? "", new: candidate[f] };
    }
  }
  // An official circular (notification) supersedes EN/tip as the row's provenance.
  if (candidate.source_type === "notification") {
    for (const f of ["source_type", "source_category", "source_file_url"]) {
      if (!isEmptyVal(candidate[f]) && !sameVal(candidate[f], existing[f])) {
        patch[f] = candidate[f]; diff[f] = { old: existing[f] ?? "", new: candidate[f] };
      }
    }
    if (candidate.raw_extraction) patch.raw_extraction = candidate.raw_extraction;
  }
  return { patch, diff, changed: Object.keys(diff).length > 0 };
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

function postNameOf(it: any): string {
  return String(it?.post_name ?? it?.post ?? it?.postName ?? it?.name ?? it?.Post ?? "").trim();
}

function asArray(out: any): any[] {
  if (Array.isArray(out)) return out;
  if (!out || typeof out !== "object") return [];
  // prefer a well-known key
  for (const k of ["vacancies", "posts", "rows", "items", "data", "results", "extracted"]) {
    if (Array.isArray(out[k])) return out[k];
  }
  // else the first array whose items look like vacancy objects
  const arrays = Object.values(out).filter(Array.isArray) as any[][];
  const withPost = arrays.find((a) => a.some((x) => x && typeof x === "object" && postNameOf(x)));
  return withPost ?? arrays[0] ?? [];
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
      model: MISTRAL_MODEL,
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
    let sfu = await storeToDrive(String(body.file_base64), String(body.filename || "source.pdf"));
    if (!sfu) {
      const bytes = fromBase64(String(body.file_base64));
      const safe = String(body.filename || "source.pdf").replace(/[^a-z0-9._-]/gi, "_");
      const path = `${Date.now()}_${safe}`;
      const up = await admin.storage.from("sources").upload(path, bytes, { contentType: "application/pdf" });
      if (up.error) return json({ error: "upload failed: " + up.error.message }, 500);
      sfu = path;
    }
    return json({ ok: true, path: sfu });
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
      const fname = String(body.filename || "source.pdf");
      let sfu = await storeToDrive(String(body.file_base64), fname); // Drive (5TB, public link)
      if (!sfu) {                                                    // fall back to Supabase storage
        const path = `${Date.now()}_${fname.replace(/[^a-z0-9._-]/gi, "_")}`;
        const upErr = (await admin.storage.from("sources").upload(path, inlineBytes, { contentType: "application/pdf" })).error;
        if (!upErr) sfu = path;
      }
      if (sfu) {
        await admin.from("ingest_jobs").update({ source_file_url: sfu }).eq("id", job.id);
        job.source_file_url = sfu;
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
        // keep a copy so review can show the PDF side-by-side and link to it
        try {
          let fname = (job.source_url.split("/").pop() || "source.pdf").split("?")[0]
            .replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
          if (!fname.toLowerCase().endsWith(".pdf")) fname += ".pdf";
          let sfu = await storeToDrive(toBase64(pdfBytes), fname);
          if (!sfu) {
            const path = `${Date.now()}_${fname}`;
            const up = await admin.storage.from("sources").upload(path, pdfBytes, { contentType: "application/pdf" });
            if (!up.error) sfu = path;
          }
          if (sfu) {
            await admin.from("ingest_jobs").update({ source_file_url: sfu }).eq("id", job.id);
            job.source_file_url = sfu;
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
      if (!it) return false;
      const pn = postNameOf(it);
      if (!pn) return false;
      it.post_name = pn; // normalise alternate keys (post / name / …) to post_name
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
        eligibility_tiers: normalizeTiers(it),
        no_of_posts: (it.no_of_posts || "").toString(),
        deputation_period_years: (it.deputation_period_years || "").toString(),
        deputation_type: it.deputation_type || "",
        notification_date: it.notification_date || "",
        last_date_to_apply: it.last_date_to_apply || "",
        official_notification_link: it.official_notification_link || job.source_url ||
          (/^https?:\/\//i.test(job.source_file_url || "") ? job.source_file_url : "") || "",
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

    // ---- Hybrid dedupe + smart merge -------------------------------------
    // Exact key match -> auto-merge (update draft in place, or queue an update
    // for an approved/live row). Loose match (same org|post|city|level, other
    // date) -> a possible-duplicate suggestion. No match -> insert as draft.
    const keyed = rows.map((r) => ({ r, ...keysOf(r) }));
    const matchKeys = [...new Set(keyed.map((k) => k.matchKey).filter(Boolean))];

    const selCols = ["id", "status", "dedup_key", "match_key", "source_type",
      "source_category", "source_file_url", ...CONTENT_FIELDS].join(",");
    const existing: any[] = [];
    for (let i = 0; i < matchKeys.length; i += 100) {
      const { data, error } = await admin.from("vacancies")
        .select(selCols).in("match_key", matchKeys.slice(i, i + 100));
      if (error) throw new Error(`match lookup failed: ${error.message}`);
      if (data) existing.push(...data);
    }
    const byDedup = new Map<string, any>();
    const byMatch = new Map<string, any[]>();
    for (const e of existing) {
      if (e.dedup_key) byDedup.set(e.dedup_key, e);
      if (e.match_key) (byMatch.get(e.match_key) ?? byMatch.set(e.match_key, []).get(e.match_key))!.push(e);
    }

    const toInsert: any[] = [];
    const draftPatches: Array<{ id: string; patch: any }> = [];
    const updateRows: any[] = [];
    let unchanged = 0;

    for (const { r, dedupKey, matchKey } of keyed) {
      const exact = byDedup.get(dedupKey);
      if (exact) {
        const { patch, diff, changed } = smartMerge(exact, r);
        if (!changed) { unchanged++; continue; }
        if (exact.status === "approved") {
          updateRows.push({
            target_id: exact.id, kind: "update", proposed: patch, diff,
            source_type: r.source_type, source_category: r.source_category,
            source_file_url: r.source_file_url, confidence: r.confidence, ingest_job_id: r.ingest_job_id,
          });
        } else {
          draftPatches.push({ id: exact.id, patch });
        }
        continue;
      }
      const loose = (byMatch.get(matchKey) ?? [])[0];
      if (loose) {
        const { diff } = smartMerge(loose, r);
        updateRows.push({
          target_id: loose.id, kind: "duplicate", proposed: r, diff,
          source_type: r.source_type, source_category: r.source_category,
          source_file_url: r.source_file_url, confidence: r.confidence, ingest_job_id: r.ingest_job_id,
        });
        continue;
      }
      toInsert.push(r);
    }

    let inserted = 0;
    if (toInsert.length) {
      const { data, error } = await admin.from("vacancies")
        .upsert(toInsert, { onConflict: "dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`insert failed: ${error.message}`);
      inserted = data?.length ?? 0;
    }
    let draftUpdated = 0;
    for (const { id, patch } of draftPatches) {
      const { error } = await admin.from("vacancies").update(patch).eq("id", id);
      if (error) throw new Error(`draft update failed: ${error.message}`);
      draftUpdated++;
    }
    let updatesQueued = 0, duplicatesFlagged = 0;
    if (updateRows.length) {
      const { error } = await admin.from("vacancy_updates").insert(updateRows);
      if (error) throw new Error(`updates insert failed: ${error.message}`);
      updatesQueued = updateRows.filter((u) => u.kind === "update").length;
      duplicatesFlagged = updateRows.filter((u) => u.kind === "duplicate").length;
    }

    await admin.from("ingest_jobs")
      .update({ status: "done", rows_extracted: inserted, error: null })
      .eq("id", job.id);

    return json({
      ok: true,
      rows_extracted: inserted,
      draft_updated: draftUpdated,
      updates_queued: updatesQueued,
      duplicates_flagged: duplicatesFlagged,
      unchanged,
      candidates: items.length,
      ingest_job_id: job.id,
      providers: [...used],
    });
  } catch (err) {
    await admin.from("ingest_jobs")
      .update({ status: "error", error: String(err) }).eq("id", job.id);
    return json({ error: String(err) }, 500);
  }
});
