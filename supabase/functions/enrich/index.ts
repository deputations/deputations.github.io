// ============================================================================
// Edge Function: enrich
// For a single draft vacancy, find its official notification PDF via Gemini +
// Google Search grounding, then extract the full details for THAT post and fill
// the draft's blank fields. Admin-triggered from the review queue.
//
//   POST /functions/v1/enrich   { "vacancy_id": "<uuid>" }
//   Authorization: Bearer <admin access token>
//
// Degrades gracefully: if no credible official PDF is found/fetchable, it leaves
// the draft as-is (optionally storing a page URL) and reports found=false.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

// Web-search providers, tried in order. Configure whichever you have:
//   supabase secrets set SERPER_API_KEY=...  BRAVE_API_KEY=...  GOOGLE_CSE_KEY=... GOOGLE_CSE_CX=...
const SERPER_KEY = Deno.env.get("SERPER_API_KEY") ?? "";
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY") ?? "";
const GCSE_KEY = Deno.env.get("GOOGLE_CSE_KEY") ?? "";
const GCSE_CX = Deno.env.get("GOOGLE_CSE_CX") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Many .gov.in/.nic.in servers reject requests without a browser-like UA.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function toBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function extractJson(text: string): any {
  try { return JSON.parse(text); } catch { /* try to find a JSON object/array */ }
  const obj = text.match(/\{[\s\S]*\}/); if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  const arr = text.match(/\[[\s\S]*\]/); if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  return null;
}

// ---- Real web search (returns URLs that actually exist) --------------------
type Hit = { url: string; title: string };
const isOfficial = (u: string) => /\.(gov|nic)\.in(\/|$|:)/i.test(u) || /\.gov(\/|$|:)/i.test(u);
const isPdf = (u: string) => /\.pdf(\?|#|$)/i.test(u);

async function serperSearch(q: string): Promise<Hit[]> {
  if (!SERPER_KEY) return [];
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST", headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 10 }),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.organic ?? []).map((o: any) => ({ url: o.link, title: o.title ?? "" }));
}
async function braveSearch(q: string): Promise<Hit[]> {
  if (!BRAVE_KEY) return [];
  const r = await fetch("https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(q),
    { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" } });
  if (!r.ok) return [];
  const d = await r.json();
  return ((d.web?.results) ?? []).map((o: any) => ({ url: o.url, title: o.title ?? "" }));
}
async function gcseSearch(q: string): Promise<Hit[]> {
  if (!GCSE_KEY || !GCSE_CX) return [];
  const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GCSE_KEY}&cx=${GCSE_CX}&q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.items ?? []).map((o: any) => ({ url: o.link, title: o.title ?? "" }));
}

function pickBest(hits: Hit[]) {
  const relevant = (h: Hit) => /deput|vacanc|circular|notif|advert|recruit/i.test(`${h.url} ${h.title}`);
  const offPdfs = hits.filter((h) => isPdf(h.url) && isOfficial(h.url));
  const offPdf = offPdfs.find(relevant) ?? offPdfs[0];
  if (offPdf) return { pdf_url: offPdf.url, page_url: "", quality: "official-pdf" };
  const anyPdf = hits.find((h) => isPdf(h.url) && relevant(h)) ?? hits.find((h) => isPdf(h.url));
  if (anyPdf) return { pdf_url: anyPdf.url, page_url: "", quality: "pdf" };
  const offPage = hits.find((h) => isOfficial(h.url));
  if (offPage) return { pdf_url: "", page_url: offPage.url, quality: "official-page" };
  return { pdf_url: "", page_url: hits[0]?.url ?? "", quality: "page" };
}

// ---- Primary finder: search-provider chain (Serper -> Brave -> Google CSE) --
async function findOfficialPdf(v: any) {
  const base = `${v.organisation || ""} ${v.post_name || ""} deputation notification`.replace(/\s+/g, " ").trim();
  const providers: Array<[string, (q: string) => Promise<Hit[]>]> = [
    ["serper", serperSearch], ["brave", braveSearch], ["googlecse", gcseSearch],
  ];
  for (const [name, fn] of providers) {
    try {
      let hits = await fn(`${base} filetype:pdf`);
      if (!hits.length) hits = await fn(base);
      if (hits.length) {
        const best = pickBest(hits);
        if (best.pdf_url || best.page_url) {
          return {
            pdf_url: best.pdf_url, page_url: best.page_url,
            confidence: best.quality.startsWith("official") ? "high" : "medium",
            note: `via ${name} (${best.quality})`,
          };
        }
      }
    } catch { /* try next provider */ }
  }
  // No usable search results. If no search keys are configured at all, fall back
  // to grounding (unreliable). Otherwise report not-found.
  if (!SERPER_KEY && !BRAVE_KEY && !(GCSE_KEY && GCSE_CX)) return await groundingFind(v);
  return { pdf_url: "", page_url: "", confidence: "low", note: "no official result from search providers" };
}

// ---- Fallback finder: Gemini Google-Search grounding (only when no search API
// keys are configured; unreliable — can hallucinate URLs) --------------------
async function groundingFind(v: any) {
  const prompt =
`Find the OFFICIAL detailed advertisement / vacancy notification for this Government of India DEPUTATION vacancy.

Post: "${v.post_name}"
Organisation: "${v.organisation || ""}"
${v.ministry ? `Ministry: "${v.ministry}"\n` : ""}${v.location_city ? `Location: "${v.location_city}"\n` : ""}
Search the web. Prefer a DIRECT link to the official PDF on the organisation's own
official website (domains like *.gov.in, *.nic.in, or the organisation's official site).
Do NOT return third-party job-aggregator links if an official source exists.

Respond with ONLY a JSON object, no prose:
{"pdf_url":"<direct .pdf url or empty>","page_url":"<official page url or empty>","confidence":"high|medium|low","note":"<short reason>"}`;

  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  for (const model of [GEMINI_MODEL, "gemini-2.5-flash-lite"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(" ") ?? "";
        return extractJson(text) ?? { pdf_url: "", page_url: "", confidence: "low", note: "no parseable result" };
      }
      if (res.status === 429) break; // quota — switch model
      if ([500, 503].includes(res.status)) { await sleep(1000 * (attempt + 1)); continue; }
      break;
    }
  }
  return { pdf_url: "", page_url: "", confidence: "low", note: "search failed" };
}

// ---- Step 2: extract THIS post's full details from the official PDF ----
const DETAIL_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string" }, req_level1: { type: "string" }, req_level2: { type: "string" },
    min_years_experience: { type: "string" }, min_years_experience2: { type: "string" },
    no_of_posts: { type: "string" }, deputation_period_years: { type: "string" },
    deputation_type: { type: "string" }, notification_date: { type: "string" },
    last_date_to_apply: { type: "string" }, essential_qualification: { type: "string" },
    eligible_service: { type: "string" }, mode_of_application: { type: "string" },
    organisation_type: { type: "string" }, functional_area: { type: "string" },
    application_form_link: { type: "string" }, source_website: { type: "string" },
    tags_keywords: { type: "string" }, matched: { type: "boolean" },
  },
};

async function extractDetail(pdfB64: string, v: any) {
  const prompt =
`This is an official Government of India notification PDF. Extract the FULL details for THIS specific post:
post "${v.post_name}" at "${v.organisation || ""}"${v.location_city ? ` (location ${v.location_city})` : ""}.
If several posts are listed, return ONLY the best-matching one and set matched=true; if you cannot find
this post in the document, set matched=false and leave fields empty.
Dates ISO yyyy-mm-dd; if "within N days of notification", compute from notification_date.
"level"/"req_level1" = pay matrix level NUMBER as string. Empty string for anything unknown.`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "application/pdf", data: pdfB64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: DETAIL_SCHEMA },
  };
  for (const model of [GEMINI_MODEL, "gemini-2.5-flash-lite"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (res.ok) {
        const data = await res.json();
        return extractJson(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") ?? {};
      }
      if (res.status === 429) break; // quota — switch model
      if ([500, 503].includes(res.status)) { await sleep(1000 * (attempt + 1)); continue; }
      break;
    }
  }
  return {};
}

// fields we allow enrichment to FILL (only when the draft's value is empty)
const FILLABLE = [
  "level", "req_level1", "req_level2", "min_years_experience", "min_years_experience2",
  "no_of_posts", "deputation_period_years", "deputation_type", "notification_date",
  "last_date_to_apply", "essential_qualification", "eligible_service", "mode_of_application",
  "organisation_type", "functional_area", "application_form_link", "source_website", "tags_keywords",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await admin.auth.getUser(token);
  const email = userData?.user?.email ?? "";
  if (!email) return json({ error: "Not authenticated" }, 401);
  const { data: adminRow } = await admin.from("admins").select("email").ilike("email", email).maybeSingle();
  if (!adminRow) return json({ error: "Not authorised" }, 403);

  let vacancy_id = "";
  try { ({ vacancy_id } = await req.json()); } catch { /* */ }
  if (!vacancy_id) return json({ error: "vacancy_id required" }, 400);

  const { data: v, error } = await admin.from("vacancies").select("*").eq("id", vacancy_id).single();
  if (error || !v) return json({ error: "vacancy not found" }, 404);

  try {
    const found = await findOfficialPdf(v);
    const patch: Record<string, any> = {};
    let detailFilled: string[] = [];
    let pdfOk = false;
    let resolvedUrl = "";

    if (found.pdf_url) {
      try {
        const r = await fetch(found.pdf_url, { headers: BROWSER_HEADERS, redirect: "follow" });
        resolvedUrl = r.url || "";   // the real URL after following Google's redirect
        const ct = r.headers.get("content-type") ?? "";
        if (r.ok && (ct.includes("pdf") || resolvedUrl.toLowerCase().includes(".pdf"))) {
          const bytes = new Uint8Array(await r.arrayBuffer());
          const detail = await extractDetail(toBase64(bytes), v);
          pdfOk = true;
          if (detail && detail.matched !== false) {
            for (const f of FILLABLE) {
              const incoming = (detail[f] ?? "").toString().trim();
              const current = (v[f] ?? "").toString().trim();
              if (incoming && !current) { patch[f] = incoming; detailFilled.push(f); }
            }
            if (patch.level && !patch.level_text) patch.level_text = `Level-${String(patch.level).replace(/\D/g, "")}`;
          }
        }
      } catch { /* fetch/extract failed -> treat as link-only */ }
    }

    // official_notification_link = ONLY the real notification PDF we actually
    // fetched. A generic official page never becomes the official link — it goes
    // to source_website instead. (NEVER the opaque vertexaisearch redirect.)
    const isRedirect = (u: string) => !u || u.includes("vertexaisearch.cloud.google.com");
    const pdfLink = (pdfOk && resolvedUrl && !isRedirect(resolvedUrl)) ? resolvedUrl
      : (pdfOk && !isRedirect(found.pdf_url) ? found.pdf_url : "");
    if (pdfLink) patch.official_notification_link = pdfLink;
    if (found.page_url && !isRedirect(found.page_url) && !v.source_website && !patch.source_website) {
      patch.source_website = found.page_url;
    }

    const note = `[enrich ${new Date().toISOString().slice(0, 10)}] ` +
      (found.pdf_url ? `pdf=${found.pdf_url} ` : "no-pdf ") +
      (pdfOk ? `filled:${detailFilled.join(",") || "none"}` : "pdf-not-fetched") +
      (found.note ? ` (${found.note})` : "");
    patch.reviewer_notes = ((v.reviewer_notes || "") + "\n" + note).trim();

    await admin.from("vacancies").update(patch).eq("id", v.id);

    return json({
      ok: true,
      found: !!found.pdf_url,
      pdf_ok: pdfOk,
      pdf_url: found.pdf_url || "",
      page_url: found.page_url || "",
      confidence: found.confidence || "low",
      filled: detailFilled,
      note: found.note || "",
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
