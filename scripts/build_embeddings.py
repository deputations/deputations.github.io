#!/usr/bin/env python3
"""
build_embeddings.py — bulk-embed ACTIVE vacancies with Gemini and UPSERT
into public.vacancy_embeddings on Supabase.

Run by the daily data cron right after build_og_images.py. Manual:
    python scripts/build_embeddings.py            # live upsert
    python scripts/build_embeddings.py --dry-run  # write data/vacancy_embeddings.json locally

Free-tier discipline:
  * INCREMENTAL — each row's embed text is hashed (with the model tag) into
    vacancy_embeddings.content_hash, and a row whose hash is unchanged is
    skipped. A normal day embeds nothing; only new or edited vacancies cost
    a request. This is what keeps the build inside the free tier as the
    corpus grows — re-embedding all of it daily hit the limit at ~96 rows.
  * ACTIVE-only filter — only Status='Active' rows get embedded.
  * Sequential single-request loop (no batch endpoint; batch is paid-only).
  * On HTTP 429 from Gemini, write disabled_until = tomorrow 00:00 UTC into
    public.semantic_search_state, exit non-zero, and let the cron continue.
  * Next day's successful build clears the flag.

Cost at typical scale: near zero on an unchanged day. A bulk approval of N
vacancies costs N requests once, not N every day thereafter.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR  = REPO_ROOT / "data"

EMBED_MODEL = os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-001")
EMBED_DIM   = 768   # truncation of the native 3072-dim output
GAPI_BASE   = "https://generativelanguage.googleapis.com/v1beta/models"

# Asymmetric retrieval: documents and queries are embedded with different
# taskType hints so Gemini places a 100-word vacancy record and a 5-word
# visitor query in a space built for matching one against the other. Without
# it both sides use the API default (symmetric similarity), which is tuned for
# comparing texts of similar length and shape — a short query against a long
# record then scores low and, worse, the gap between a right and a wrong
# answer stays narrow.
#
# The query side (RETRIEVAL_QUERY) lives in supabase/functions/semantic-search.
# The two MUST agree: vectors embedded under different taskTypes are not
# comparable. build writes the task type it used into
# semantic_search_state.embed_task_type on every successful run, and the Edge
# Function reads that key to decide which taskType to send — so a half-finished
# migration degrades to the old behaviour instead of returning nonsense.
EMBED_TASK_DOC = "RETRIEVAL_DOCUMENT"

# Stored in vacancy_embeddings.model so the vector space is identifiable from
# the table alone (the column previously held just the model name).
MODEL_TAG = "{}+{}".format(EMBED_MODEL, EMBED_TASK_DOC)

# Fields the keyword search filters against (mirrors build_data.build_search_text).
# Embedding the same text means keyword and semantic search agree on corpus.
EMBED_FIELDS = [
    "Post_Name",
    "Department",
    "Organisation",
    "Ministry",
    "Location_City",
    "Location_State",
    "Level_Text",
    "Req_Level1",
    "Req_Level2",
    "Essential_Qualification",
    "Functional_Area",
    "Keywords",
]


def read_vacancies():
    """Load data/vacancies.json (Title_Case shape produced by build_data.py)."""
    p = DATA_DIR / "vacancies.json"
    if not p.exists():
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print("[embed] FATAL: cannot read {}: {}".format(p, exc), file=sys.stderr)
        sys.exit(1)


def active_rows(rows):
    """Yield (vacancy_id, embed_text) for rows with Status='Active'.

    We don't trust string equality alone — trim + lower-case — because the
    sheet-derived Status sometimes ships with stray whitespace.
    """
    for r in rows:
        status = (r.get("Status") or "").strip().lower()
        if status != "active":
            continue
        vid = (r.get("Vacancy_ID") or "").strip()
        if not vid:
            continue
        parts = [str(r.get(f, "") or "") for f in EMBED_FIELDS]
        embed_text = " ".join(p.strip() for p in parts if p and p.strip())
        if not embed_text:
            print("[embed] skip {}: empty embed_text".format(vid))
            continue
        yield vid, embed_text


def build_embed_text(row):
    """Build the embed text from a single row — extracted for the dry-run path."""
    parts = [str(row.get(f, "") or "") for f in EMBED_FIELDS]
    return " ".join(p.strip() for p in parts if p and p.strip())


def call_gemini_embed(text, api_key, *, retries=2):
    """Embed one text via gemini-embedding-001.

    Returns the 768-dim vector (list[float]). Raises:
      RuntimeError("RATE_LIMITED") on 429 (caller writes disabled_until + exits).
      RuntimeError on other non-2xx responses.
      urllib.error.URLError on network failures (caller may retry).
    """
    # URL: https://generativelanguage.googleapis.com/v1beta/models/<model>:embedContent?key=<api_key>
    # The / between "models" and the model name, and the ":embedContent" action suffix
    # are BOTH required — Gemini returns 404 (empty body) if either is missing.
    url = "{}/{}:embedContent?key={}".format(
        GAPI_BASE, EMBED_MODEL, urllib.parse.quote(api_key, safe=""))
    body = json.dumps({
        "content": {"parts": [{"text": text}]},
        "outputDimensionality": EMBED_DIM,
        "taskType": EMBED_TASK_DOC,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/json"})

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            emb = payload.get("embedding", {}).get("values")
            if not emb or len(emb) != EMBED_DIM:
                raise RuntimeError("bad embedding shape: dim={}".format(len(emb) if emb else 0))
            return emb
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RuntimeError("RATE_LIMITED")
            if e.code in (500, 503) and attempt < retries:
                # transient — retry once
                continue
            body = e.read().decode("utf-8", errors="replace")[:200]
            raise RuntimeError("gemini {}: {}".format(e.code, body))
        except urllib.error.URLError as e:
            if attempt < retries:
                continue
            raise RuntimeError("network: {}".format(e))


def content_hash(embed_text):
    """Fingerprint the exact input we embed, model tag included.

    Folding MODEL_TAG into the hash means switching embedding model or task
    type invalidates every row automatically and forces a clean re-embed —
    otherwise the build would happily keep vectors from the old model and mix
    two incompatible vector spaces in one index, which produces similarity
    scores that look plausible and are meaningless.
    """
    return hashlib.sha256(
        (MODEL_TAG + "\n" + embed_text).encode("utf-8")
    ).hexdigest()


# Set to False when the probe below finds migration 0019 hasn't been applied.
# Writing content_hash to a table without that column makes PostgREST reject
# EVERY upsert with a 400, which would stop embeddings updating while the build
# still looked busy — the same silent-failure shape as the push-protection
# incident. So the column is treated as optional and the build degrades to its
# old full-rebuild behaviour instead.
HAS_HASH_COLUMN = True


def fetch_existing_hashes(supabase_url, service_key):
    """Return {vacancy_id: content_hash} for rows already embedded.

    A missing/NULL hash is returned as "" so it can never match a real hash —
    those rows get re-embedded once, which is exactly what we want right after
    migration 0019 adds the column.

    Doubles as the probe for whether that migration has run: PostgREST 400s on
    a select of an unknown column.

    On any failure this returns {} rather than raising. Not knowing what is
    already embedded should cost a redundant (correct) rebuild, never a skipped
    one — silently embedding nothing would leave search quietly stale.
    """
    global HAS_HASH_COLUMN
    url = ("{}/rest/v1/vacancy_embeddings?select=vacancy_id,content_hash"
           .format(supabase_url.rstrip("/")))
    req = urllib.request.Request(
        url, method="GET",
        headers={
            "apikey":        service_key,
            "Authorization": "Bearer {}".format(service_key),
        })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        if e.code == 400 and "content_hash" in detail:
            HAS_HASH_COLUMN = False
            print("[embed] vacancy_embeddings.content_hash missing — apply "
                  "supabase/migrations/0019_embedding_content_hash.sql to make "
                  "this build incremental. Falling back to a full rebuild.",
                  file=sys.stderr)
        else:
            print("[embed] could not read existing hashes ({}) — rebuilding all"
                  .format(detail or e), file=sys.stderr)
        return {}
    except Exception as exc:
        print("[embed] could not read existing hashes ({}) — rebuilding all"
              .format(exc), file=sys.stderr)
        return {}
    return {r.get("vacancy_id"): (r.get("content_hash") or "") for r in rows}


def postgrest_upsert(supabase_url, service_key, vacancy_id, embedding, model,
                     chash=None):
    """UPSERT one (vacancy_id, embedding, model) row via PostgREST.

    Uses POST + Prefer: resolution=merge-duplicates so that:
      - new rows are INSERTed
      - existing rows (PK conflict) are UPDATEd in place
    PATCH with a filter would only UPDATE matching rows (no insert), so the
    table would stay empty after the first run. POST without the Prefer
    header would 409 on PK conflict. POST + merge-duplicates is the
    canonical PostgREST upsert.
    """
    url = "{}/rest/v1/vacancy_embeddings".format(supabase_url.rstrip("/"))
    payload = {
        "vacancy_id": vacancy_id,
        "embedding":  embedding,
        "model":      model,
    }
    if chash is not None and HAS_HASH_COLUMN:
        payload["content_hash"] = chash
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type":  "application/json",
            "apikey":        service_key,
            "Authorization": "Bearer {}".format(service_key),
            "Prefer":        "resolution=merge-duplicates",
        })
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError("postgrest upsert returned {}".format(resp.status))


def write_state(supabase_url, service_key, key, value):
    """UPSERT one row in public.semantic_search_state (key=value).

    POST + resolution=merge-duplicates rather than PATCH: migration 0016 seeds
    four keys, and later keys (embed_task_type) have to be able to appear
    without another migration. PATCH would silently no-op on a missing key.
    """
    url = "{}/rest/v1/semantic_search_state".format(supabase_url.rstrip("/"))
    body = json.dumps({"key": key, "value": value}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type":  "application/json",
            "apikey":        service_key,
            "Authorization": "Bearer {}".format(service_key),
            "Prefer":        "resolution=merge-duplicates,return=minimal",
        })
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError("postgrest state update returned {}".format(resp.status))


def tomorrow_midnight_utc():
    """Return ISO string for next 00:00 UTC — the disable-until time."""
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.isoformat()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Write data/vacancy_embeddings.json locally; skip Supabase calls")
    ap.add_argument("--force", action="store_true",
                    help="Re-embed every ACTIVE row, ignoring content hashes "
                         "(use after changing EMBED_FIELDS or the model)")
    args = ap.parse_args()

    api_key       = os.environ.get("GEMINI_API_KEY", "")
    supabase_url  = os.environ.get("SUPABASE_URL", "")
    service_key   = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not args.dry_run:
        if not api_key:
            print("[embed] FATAL: GEMINI_API_KEY not set", file=sys.stderr)
            sys.exit(2)
        if not supabase_url or not service_key:
            print("[embed] FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set",
                  file=sys.stderr)
            sys.exit(2)

    rows = read_vacancies()
    items = list(active_rows(rows))
    total_active = len(items)
    print("[embed] {} ACTIVE vacancies (of {} total)".format(total_active, len(rows)))

    if total_active == 0:
        print("[embed] nothing to embed — exiting")
        if not args.dry_run:
            try:
                write_state(supabase_url, service_key, "last_build_at",     now_iso())
                write_state(supabase_url, service_key, "last_build_count",  "0")
                write_state(supabase_url, service_key, "last_build_status", "ok")
            except Exception as e:
                print("[embed] (state update failed: {})".format(e), file=sys.stderr)
        return

    # Incremental gate. The build used to re-embed every ACTIVE row daily,
    # which is what exhausted the free tier once the set passed ~90 rows. On a
    # normal day nothing has changed and this loop embeds nothing at all.
    skipped = 0
    if not args.dry_run and not args.force:
        known = fetch_existing_hashes(supabase_url, service_key)
        fresh = []
        for vid, embed_text in items:
            if known.get(vid) == content_hash(embed_text):
                skipped += 1
                continue
            fresh.append((vid, embed_text))
        items = fresh
        print("[embed] {} unchanged (skipped), {} to embed"
              .format(skipped, len(items)))
        if not items:
            print("[embed] nothing changed — corpus already up to date")
            try:
                write_state(supabase_url, service_key, "last_build_at",     now_iso())
                write_state(supabase_url, service_key, "last_build_count",  "0")
                write_state(supabase_url, service_key, "last_build_status", "ok")
                write_state(supabase_url, service_key, "disabled_until",    "")
            except Exception as e:
                print("[embed] (state update failed: {})".format(e), file=sys.stderr)
            return
    elif args.force:
        print("[embed] --force: re-embedding all {} rows".format(len(items)))

    written = 0
    failed  = []

    for vid, embed_text in items:
        try:
            embedding = call_gemini_embed(embed_text, api_key)
        except RuntimeError as e:
            if str(e) == "RATE_LIMITED":
                print("[embed] 429 from Gemini after {} embeddings — "
                      "free-tier limit hit; disabling until tomorrow"
                      .format(written), file=sys.stderr)
                if not args.dry_run:
                    try:
                        write_state(supabase_url, service_key,
                                    "disabled_until", tomorrow_midnight_utc())
                        write_state(supabase_url, service_key,
                                    "last_build_status", "rate_limited")
                    except Exception as werr:
                        print("[embed] (state write failed: {})".format(werr),
                              file=sys.stderr)
                sys.exit(3)
            failed.append((vid, str(e)))
            continue

        if args.dry_run:
            # accumulate to local file
            pass
        else:
            try:
                postgrest_upsert(supabase_url, service_key, vid, embedding,
                                 MODEL_TAG, chash=content_hash(embed_text))
            except Exception as e:
                failed.append((vid, "upsert: {}".format(e)))
                continue

        written += 1
        if written % 10 == 0:
            print("[embed] {}/{} embedded".format(written, total_active))

    if args.dry_run:
        out = DATA_DIR / "vacancy_embeddings.json"
        # Re-read and write a slim {id: vec} map (for inspection only — not used at runtime).
        embeds = []
        for vid, row in [(vid, next((r for r in rows if str(r.get("Vacancy_ID", "")).strip() == vid), {}))
                         for vid, _ in items]:
            embeds.append({"vacancy_id": vid, "model": MODEL_TAG,
                           "embedding_dim": EMBED_DIM,
                           "text_chars": len(build_embed_text(row))})
        out.write_text(json.dumps(embeds, indent=0), encoding="utf-8")
        print("[embed] dry-run wrote {} ({} rows, dim={})"
              .format(out, len(embeds), EMBED_DIM))
        return

    # Build finished — clear the disable flag and record stats. embed_task_type
    # is written LAST and only on a complete run: the Edge Function keys its
    # query-side taskType off it, so it must not claim the new vector space
    # until the whole corpus is actually in it.
    try:
        write_state(supabase_url, service_key, "disabled_until",    "")
        write_state(supabase_url, service_key, "last_build_at",     now_iso())
        write_state(supabase_url, service_key, "last_build_count",  str(written))
        write_state(supabase_url, service_key, "last_build_status", "ok")
        if not failed:
            write_state(supabase_url, service_key, "embed_task_type", EMBED_TASK_DOC)
    except Exception as e:
        print("[embed] (state update failed at end: {})".format(e), file=sys.stderr)

    print("[embed] DONE: {} embedded, {} failed, {} total ACTIVE"
          .format(written, len(failed), total_active))
    if failed:
        for vid, err in failed[:10]:
            print("[embed]   fail: {} — {}".format(vid, err), file=sys.stderr)


if __name__ == "__main__":
    main()