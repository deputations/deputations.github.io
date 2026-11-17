#!/usr/bin/env python3
"""Build a separate OpenAI search index; leave the Gemini backup untouched."""
import hashlib
import json
import math
import os
import sys
import urllib.request

from build_embeddings import active_rows, read_vacancies, write_state

MODEL = "text-embedding-3-small"
DIMENSIONS = 768
READY_KEY = "openai_embedding_model"


def content_hash(text):
    return hashlib.sha256((MODEL + ":768\n" + text).encode("utf-8")).hexdigest()


def request_json(url, *, key, payload=None, extra_headers=None):
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    headers.update(extra_headers or {})
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


def existing_hashes(base, key):
    result, offset = {}, 0
    while True:
        url = (base + "/rest/v1/vacancy_openai_embeddings?"
               "select=vacancy_id,content_hash&order=vacancy_id&limit=500&offset=" + str(offset))
        rows = request_json(url, key=key)
        result.update({row["vacancy_id"]: row["content_hash"] for row in rows})
        if len(rows) < 500:
            return result
        offset += len(rows)


def embed_batch(texts, key):
    # OpenAI does not use Supabase's apikey header.
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=json.dumps({"model": MODEL, "input": texts, "dimensions": DIMENSIONS}).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=30) as response:
        rows = json.load(response)["data"]
    if len(rows) != len(texts) or sorted(row.get("index") for row in rows) != list(range(len(texts))):
        raise ValueError("Unexpected OpenAI embedding indexes")
    rows.sort(key=lambda row: row["index"])
    vectors = [row.get("embedding") for row in rows]
    if any(not isinstance(vector, list) or len(vector) != DIMENSIONS or
           any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
           for vector in vectors):
        raise ValueError("Unexpected OpenAI embedding dimensions or values")
    return vectors


def build(base, service_key, openai_key, items):
    # Never search a partially updated OpenAI index; Gemini remains available.
    write_state(base, service_key, READY_KEY, "")
    known = existing_hashes(base, service_key)
    changed = [(vid, text) for vid, text in items if known.get(vid) != content_hash(text)]
    for start in range(0, len(changed), 32):
        batch = changed[start:start + 32]
        vectors = embed_batch([text for _, text in batch], openai_key)
        payload = [{"vacancy_id": vid, "embedding": vector, "model": MODEL,
                    "content_hash": content_hash(text)}
                   for (vid, text), vector in zip(batch, vectors)]
        request_json(base + "/rest/v1/vacancy_openai_embeddings", key=service_key,
                     payload=payload,
                     extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
        print("[openai-embed] {}/{} updated".format(start + len(batch), len(changed)), flush=True)
    write_state(base, service_key, READY_KEY, MODEL)
    print("[openai-embed] {} updated; {} active".format(len(changed), len(items)))


def main():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if not all((base, service_key, openai_key)):
        print("[openai-embed] Required server credentials missing", file=sys.stderr)
        return 2
    items = list(active_rows(read_vacancies()))
    if not items:
        print("[openai-embed] No active vacancies; leaving the backup in use", file=sys.stderr)
        return 1
    try:
        build(base, service_key, openai_key, items)
    except Exception as exc:
        # No credentials or HTTP bodies are printed in logs.
        print("[openai-embed] Build failed ({}); Gemini remains active".format(type(exc).__name__), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
