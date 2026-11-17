// ============================================================================
// Edge Function: semantic-search
// Visitor types a natural-language query ("finance posts in NE"); the function
// embeds it with OpenAI, falling back to Gemini, and returns matches from pgvector. Powers the
// "✨ AI" toggle chip on the home page (PR 3 wires the UI; this function is
// the backend).
//
//   POST /functions/v1/semantic-search
//     { query: string, k?: number, filters?: { ministry?: string, level?: string } }
//   → { ok: true, results: [{ vacancy_id, post_name, organisation, ministry,
//                              level, last_date, score }] }
//
//   On 503 (free-tier overflow): { ok: false, code: "disabled",
//                                   message, disabled_until }
//
// Gateway JWT verification remains disabled, as on the previous deployment.
// The handler requires the server-only proxy token before any live work.
// Only the service role can execute search_vacancies(); browser roles cannot
// read the base vacancy table or invoke the search RPC directly.
//
// Free-tier safety:
//   1. Cheap pre-check: SELECT disabled_until from semantic_search_state —
//      if now() < disabled_until, short-circuit with 503 (no Gemini call).
//   2. On Gemini HTTP 429: write disabled_until = tomorrow 00:00 UTC, 503.
//      Next day's build_embeddings.py clears the flag after a successful run.
//   3. In-memory LRU (Map, capped at 200 entries) dedupes repeat queries.
//
// Free-tier budget: ~67 ACTIVE embeddings to search over; one Gemini call
// per query; default 100 req/min free-tier limit covers typical visitor
// traffic comfortably. The state flag is the safety valve for spikes.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProxyToken } from "../_shared/public-proxy.js";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY  = Deno.env.get("GEMINI_API_KEY")!;
const EMBED_MODEL     = Deno.env.get("GEMINI_EMBED_MODEL") ?? "gemini-embedding-001";
const OPENAI_API_KEY  = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL    = "text-embedding-3-small";
const EMBED_DIM       = 768;
const GAPI_BASE       = "https://generativelanguage.googleapis.com/v1beta/models";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ----- tiny in-memory LRU (per-function-instance; cold on cold start) -----
const LRU_MAX = 200;
const cache = new Map<string, { body: unknown; expires: number }>();
function cacheGet(key: string): unknown | null {
  const v = cache.get(key);
  if (!v) return null;
  if (v.expires < Date.now()) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, v);   // LRU bump
  return v.body;
}
function cacheSet(key: string, body: unknown, ttlMs = 60_000) {
  cache.set(key, { body, expires: Date.now() + ttlMs });
  if (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// sha-256 hex (Edge runtime has SubtleCrypto)
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Gemini embed query ----
// `taskType` is the asymmetric-retrieval hint: the corpus is embedded as
// RETRIEVAL_DOCUMENT by scripts/build_embeddings.py, so a query embedded as
// RETRIEVAL_QUERY lands in the space Gemini built for matching a short query
// against a long document. Vectors from different taskTypes are NOT
// comparable, so this is passed only when the stored corpus confirms it was
// built that way (see readState / embed_task_type below); against a
// legacy corpus we send no taskType, exactly as before.
async function embedQuery(text: string, taskType: string | null): Promise<number[]> {
  const url = `${GAPI_BASE}/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const body: Record<string, unknown> = {
    content: { parts: [{ text }] },
    outputDimensionality: EMBED_DIM,
  };
  if (taskType) body.taskType = taskType;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const emb = data?.embedding?.values;
  if (!Array.isArray(emb) || emb.length !== EMBED_DIM) {
    throw new Error(`bad embedding shape: dim=${emb?.length ?? 0}`);
  }
  return emb as number[];
}

async function embedOpenAI(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, input: text, dimensions: EMBED_DIM }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`OpenAI embedding request failed (${res.status})`);
  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBED_DIM || !vector.every(Number.isFinite)) {
    throw new Error("Invalid OpenAI embedding");
  }
  return vector;
}

// ---- State flag helpers (service-role client bypasses RLS) ----
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// One read for both flags we need per request — `disabled_until` (free-tier
// valve) and `embed_task_type` (which vector space the stored corpus is in).
async function readState(): Promise<{ disabledUntil: string | null; embedTaskType: string | null; openaiReady: boolean }> {
  const { data, error } = await admin
    .from("semantic_search_state")
    .select("key, value")
    .in("key", ["disabled_until", "embed_task_type", "openai_embedding_model"]);
  if (error) throw error;
  const byKey = new Map((data ?? []).map((r: any) => [r.key, r.value]));

  const rawDisabled = byKey.get("disabled_until");
  // value is text; interpret as ISO timestamp if present
  const t = rawDisabled ? Date.parse(rawDisabled) : NaN;
  const disabledUntil = Number.isNaN(t) ? null : rawDisabled;

  // Only pair RETRIEVAL_QUERY with a corpus the build script has confirmed is
  // RETRIEVAL_DOCUMENT. Any other value (unset, mid-migration, a future task
  // type this deploy doesn't know) falls back to the untyped call, which is
  // what the legacy corpus was embedded with.
  const rawTask = byKey.get("embed_task_type");
  const embedTaskType = rawTask === "RETRIEVAL_DOCUMENT" ? "RETRIEVAL_QUERY" : null;

  return { disabledUntil, embedTaskType, openaiReady: byKey.get("openai_embedding_model") === OPENAI_MODEL };
}

async function setDisabledUntil(iso: string): Promise<void> {
  await admin
    .from("semantic_search_state")
    .update({ value: iso })
    .eq("key", "disabled_until");
}

function tomorrowMidnightUtc(): string {
  const now = new Date();
  const t = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    0, 0, 0, 0));
  return t.toISOString();
}

// ---- Main handler ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")     return json({ ok: false, message: "POST only" }, 405);
  // Public clients go through the rate-limited proxy. Reject direct invocation
  // before any database or embedding call. Missing configuration fails closed.
  const proxySecret = Deno.env.get('PUBLIC_PROXY_SECRET') || '';
  if (proxySecret.length < 32) return json({ok:false, code:'unavailable', message:'Use keyword search.'}, 503);
  if (!await verifyProxyToken(req.headers.get('x-public-proxy-secret'), proxySecret)) {
    return json({ok:false, code:'proxy_required', message:'Use the website search.'}, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const query = String(body.query ?? "").trim();
  if (!query)              return json({ ok: false, message: "Query is required." }, 400);
  if (query.length > 500)  return json({ ok: false, message: "Query too long (max 500 chars)." }, 400);

  const k       = Math.min(Math.max(parseInt(String(body.k ?? "10"), 10) || 10, 1), 50);
  const filters = (body.filters && typeof body.filters === "object") ? body.filters : {};
  const fMinistry = typeof filters.ministry === "string" ? filters.ministry : null;
  const fLevel    = typeof filters.level    === "string" ? filters.level    : null;

  // 1. Free-tier guard + corpus vector space (one cheap DB read)
  let disabledUntil: string | null = null;
  let queryTaskType: string | null = null;
  let openaiReady = false;
  try {
    const state = await readState();
    disabledUntil = state.disabledUntil;
    queryTaskType = state.embedTaskType;
    openaiReady = !!OPENAI_API_KEY && state.openaiReady;
  } catch (e) { console.warn("[semantic] state read failed:", e); }

  // 2. LRU cache lookup (key = sha256(query+filters+k+taskType))
  // taskType is part of the key: the same query embedded in a different
  // vector space is a different result set, so a corpus rebuild must not be
  // served stale answers from a warm instance.
  let cacheKey: string | null = null;
  let cached: unknown = null;
  try {
    cacheKey = await sha256Hex(`${query}|${fMinistry ?? ""}|${fLevel ?? ""}|${k}|${queryTaskType ?? ""}|${openaiReady}`);
    cached = cacheGet(cacheKey);
  } catch { /* caching is best-effort */ }
  if (cached) return json(cached as any);

  // Use a provider's query embedding only with that provider's own index.
  // An unavailable OpenAI API or index falls through to the existing Gemini path.
  let matches: any[] | null = null;
  let provider: "openai" | "gemini" = "gemini";
  async function search(vector: number[], rpc: string): Promise<any[]> {
    const { data, error } = await admin.rpc(rpc, {
      query_embedding: `[${vector.join(",")}]`, match_count: k,
      filter_ministry: fMinistry, filter_level: fLevel,
    });
    if (error) throw error;
    return data ?? [];
  }
  if (openaiReady) {
    try {
      matches = await search(await embedOpenAI(query), "search_vacancies_openai");
      provider = "openai";
    } catch (e) {
      console.warn("[semantic] OpenAI unavailable; trying Gemini", (e as Error).message);
    }
  }
  if (matches === null) {
    if (disabledUntil && Date.parse(disabledUntil) > Date.now()) {
      return json({ ok: false, code: "disabled", message: "AI search temporarily unavailable. Use keyword search.", disabled_until: disabledUntil }, 503);
    }
    try {
      matches = await search(await embedQuery(query, queryTaskType), "search_vacancies");
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") {
        const iso = tomorrowMidnightUtc();
        try { await setDisabledUntil(iso); } catch { /* best effort */ }
        return json({ ok: false, code: "disabled", message: "AI search temporarily unavailable. Use keyword search.", disabled_until: iso }, 503);
      }
      console.warn("[semantic] Gemini backup unavailable");
      return json({ ok: false, code: "embed_failed", message: "AI search temporarily unavailable. Use keyword search." }, 502);
    }
  }
  const ids = (matches ?? []).map((m: any) => m.vacancy_id);
  if (ids.length === 0) {
    const empty = { ok: true, results: [], provider, cached_until: Date.now() + 30_000 };
    if (cacheKey) cacheSet(cacheKey, empty, 30_000);
    return json(empty);
  }

  // 5. Hydrate with public vacancy fields (anon-readable via RLS).
  // We use the admin client for consistency; RLS allows anon to read
  // approved rows so this matches what a future direct-from-anon path would
  // see. PostgREST's `.in(column, array)` does the URL escaping safely.
  const { data: rows, error: selErr } = await admin
    .from("vacancies")
    .select("vacancy_id, post_name, organisation, ministry, level, last_date_to_apply")
    .in("vacancy_id", ids);
  if (selErr) {
    return json({ ok: false, code: "hydrate_failed", message: selErr.message }, 500);
  }
  const byId = new Map((rows ?? []).map((r: any) => [r.vacancy_id, r]));
  const distById = new Map((matches ?? []).map((m: any) => [m.vacancy_id, m.distance]));

  const results = ids.map((id: string) => {
    const r = byId.get(id);
    const distance = distById.get(id) ?? 0;
    // Cosine distance is in [0, 2]; map to [0, 1] similarity. Values >1 are
    // essentially noise; clamp for display.
    const score = Math.max(0, Math.min(1, 1 - Number(distance)));
    return {
      vacancy_id:   id,
      post_name:    r?.post_name    ?? "",
      organisation: r?.organisation ?? "",
      ministry:     r?.ministry     ?? "",
      level:        r?.level        ?? "",
      last_date:    r?.last_date_to_apply ?? "",
      score:        Number(score.toFixed(3)),
    };
  });

  const responseBody = { ok: true, results, provider, cached_until: Date.now() + 60_000 };
  if (cacheKey) cacheSet(cacheKey, responseBody, 60_000);
  return json(responseBody);
});
