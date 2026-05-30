// ============================================================================
// Edge Function: gc_sources
// Deletes source PDFs from the 'sources' bucket that are no longer needed for
// review — i.e. not referenced by ANY draft vacancy. Source PDFs are only used
// by the admin review viewer; once every row from a source is approved/rejected,
// the file is safe to remove. Also clears source_file_url on rows that pointed
// at a deleted file so the review UI shows no broken "source" button.
//
//   POST /functions/v1/gc_sources    (admin auth)  -> { deleted: N }
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
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await admin.auth.getUser(token);
  const email = userData?.user?.email ?? "";
  if (!email) return json({ error: "Not authenticated" }, 401);
  const { data: adminRow } = await admin.from("admins").select("email").ilike("email", email).maybeSingle();
  if (!adminRow) return json({ error: "Not authorised" }, 403);

  try {
    // paths still needed for review = source_file_url of any DRAFT row (storage paths only)
    const { data: drafts } = await admin.from("vacancies")
      .select("source_file_url").eq("status", "draft").not("source_file_url", "is", null);
    const keep = new Set(
      (drafts ?? []).map((r: any) => r.source_file_url).filter((u: string) => u && !/^https?:\/\//i.test(u)),
    );

    // list everything in the bucket
    const { data: objs } = await admin.storage.from("sources").list("", { limit: 1000 });
    const orphans = (objs ?? []).map((o: any) => o.name).filter((n: string) => n && !keep.has(n));

    if (orphans.length) {
      await admin.storage.from("sources").remove(orphans);
      // clear dead links so the review UI shows no broken source button
      for (const p of orphans) {
        await admin.from("vacancies").update({ source_file_url: "" }).eq("source_file_url", p);
      }
    }
    return json({ ok: true, deleted: orphans.length, kept: keep.size });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
