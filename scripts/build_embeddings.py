#!/usr/bin/env python3
"""
build_embeddings.py — bulk-embed ACTIVE vacancies with Gemini and UPSERT
into public.vacancy_embeddings on Supabase.

Run by the daily data cron right after build_og_images.py. Manual:
    python scripts/build_embeddings.py            # live upsert
    python scripts/build_embeddings.py --dry-run  # write data/vacancy_embeddings.json locally

Free-tier discipline:
  * ACTIVE-only filter — only Status='Active' rows get embedded.
  * Sequential single-request loop (no batch endpoint; batch is paid-only).
  * On HTTP 429 from Gemini, write disabled_until = tomorrow 00:00 UTC into
    public.semantic_search_state, exit non-zero, and let the cron continue.
  * Next day's successful build clears the flag.

Cost at typical scale: ~67 ACTIVE vacancies × ~500 tokens = ~33K tokens/day,
well under Gemini's 1500 req/day free limit.
"""

import argparse
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


def postgrest_upsert(supabase_url, service_key, vacancy_id, embedding, model):
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
    body = json.dumps({
        "vacancy_id": vacancy_id,
        "embedding":  embedding,
        "model":      model,
    }).encode("utf-8")
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
    """UPDATE one row in public.semantic_search_state (key=value)."""
    url = "{}/rest/v1/semantic_search_state?key=eq.{}".format(
        supabase_url.rstrip("/"), urllib.parse.quote(key, safe=""))
    body = json.dumps({"value": value}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={
            "Content-Type":  "application/json",
            "apikey":        service_key,
            "Authorization": "Bearer {}".format(service_key),
            "Prefer":        "return=minimal",
        })
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status not in (200, 204):
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
                postgrest_upsert(supabase_url, service_key, vid, embedding, EMBED_MODEL)
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
            embeds.append({"vacancy_id": vid, "model": EMBED_MODEL,
                           "embedding_dim": EMBED_DIM,
                           "text_chars": len(build_embed_text(row))})
        out.write_text(json.dumps(embeds, indent=0), encoding="utf-8")
        print("[embed] dry-run wrote {} ({} rows, dim={})"
              .format(out, len(embeds), EMBED_DIM))
        return

    # Build finished — clear the disable flag and record stats.
    try:
        write_state(supabase_url, service_key, "disabled_until",    "")
        write_state(supabase_url, service_key, "last_build_at",     now_iso())
        write_state(supabase_url, service_key, "last_build_count",  str(written))
        write_state(supabase_url, service_key, "last_build_status", "ok")
    except Exception as e:
        print("[embed] (state update failed at end: {})".format(e), file=sys.stderr)

    print("[embed] DONE: {} embedded, {} failed, {} total ACTIVE"
          .format(written, len(failed), total_active))
    if failed:
        for vid, err in failed[:10]:
            print("[embed]   fail: {} — {}".format(vid, err), file=sys.stderr)


if __name__ == "__main__":
    main()