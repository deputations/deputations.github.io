// ============================================================================
// Edge Function: semantic-search
// Visitor types a natural-language query ("finance posts in NE"); the function
// embeds it with Gemini and returns top-K matches from pgvector. Powers the
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
// Deployed with --no-verify-jwt (PUBLIC). RLS on the source tables applies
// regardless — search_vacancies() joins on vacancies.status in
// ('Active','approved') and the anon role can only see approved rows.
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

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY  = Deno.env.get("GEMINI_API_KEY")!;
const EMBED_MODEL     = Deno.env.get("GEMINI_EMBED_MODEL") ?? "gemini-embedding-001";
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

// ---- State flag helpers (service-role client bypasses RLS) ----
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// One read for both flags we need per request — `disabled_until` (free-tier
// valve) and `embed_task_type` (which vector space the stored corpus is in).
async function readState(): Promise<{ disabledUntil: string | null; embedTaskType: string | null }> {
  const { data } = await admin
    .from("semantic_search_state")
    .select("key, value")
    .in("key", ["disabled_until", "embed_task_type"]);
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

  return { disabledUntil, embedTaskType };
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
  try {
    const state = await readState();
    disabledUntil = state.disabledUntil;
    queryTaskType = state.embedTaskType;
  } catch (e) { console.warn("[semantic] state read failed:", e); }
  if (disabledUntil && Date.parse(disabledUntil) > Date.now()) {
    return json({
      ok: false, code: "disabled",
      message: "AI search temporarily disabled (free-tier limit). Try again after midnight UTC.",
      disabled_until: disabledUntil,
    }, 503);
  }

  // 2. LRU cache lookup (key = sha256(query+filters+k+taskType))
  // taskType is part of the key: the same query embedded in a different
  // vector space is a different result set, so a corpus rebuild must not be
  // served stale answers from a warm instance.
  let cacheKey: string | null = null;
  let cached: unknown = null;
  try {
    cacheKey = await sha256Hex(`${query}|${fMinistry ?? ""}|${fLevel ?? ""}|${k}|${queryTaskType ?? ""}`);
    cached = cacheGet(cacheKey);
  } catch { /* caching is best-effort */ }
  if (cached) return json(cached as any);

  // 3. Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query, queryTaskType);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "RATE_LIMITED") {
      const iso = tomorrowMidnightUtc();
      try { await setDisabledUntil(iso); } catch (werr) {
        console.warn("[semantic] state write failed:", werr);
      }
      return json({
        ok: false, code: "disabled",
        message: "AI search rate-limited — auto-disabled until tomorrow UTC.",
        disabled_until: iso,
      }, 503);
    }
    return json({ ok: false, code: "embed_failed", message: msg }, 502);
  }

  // 4. Top-K from pgvector via the RPC (joins on status in ('Active','approved')).
  // pgvector params must be passed as the PostgreSQL literal string "[0.1,0.2,...]"
  // — the JS array form is rejected by PostgREST.
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const { data: matches, error: rpcErr } = await admin.rpc("search_vacancies", {
    query_embedding: vectorLiteral,
    match_count: k,
    filter_ministry: fMinistry,
    filter_level: fLevel,
  });
  if (rpcErr) {
    return json({ ok: false, code: "search_failed", message: rpcErr.message }, 500);
  }
  const ids = (matches ?? []).map((m: any) => m.vacancy_id);
  if (ids.length === 0) {
    const empty = { ok: true, results: [], cached_until: Date.now() + 30_000 };
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

  const responseBody = { ok: true, results, cached_until: Date.now() + 60_000 };
  if (cacheKey) cacheSet(cacheKey, responseBody, 60_000);
  return json(responseBody);
});