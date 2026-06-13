"""Pre-render a thumbnail for each vacancy's Official_Notification_Link.

Part of the "automatic link preview on hover" feature. The homepage shows a
small floating thumbnail of the notification document when a visitor hovers the
"Notification" link. Rather than calling a screenshot API at runtime, we render
the thumbnails ONCE at build time (right after build_data.py) and commit them
as static WebP files, plus a manifest the front end looks up by Vacancy_ID.

- Notification links are mostly PDFs -> render page 1 with PyMuPDF (fast, no
  browser). The HTML minority -> screenshot the top viewport with Playwright.
- Dedupe by URL (sha1) so a link shared across sibling vacancies renders once.
- Incremental: an existing thumbnail for a URL is reused, so steady-state runs
  only render the handful of new links each week.
- Resilient: any single link that is blocked / times out / 404s / is an
  unsupported format is skipped silently; the vacancy just gets no preview.
- Prune: thumbnails no longer referenced by the current data are deleted so the
  repo doesn't accumulate images for long-expired vacancies.

Run after build_data.py:  python scripts/build_link_previews.py
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path

import requests
import urllib3
from PIL import Image

# Quiet the per-request InsecureRequestWarning (see verify=False in fetch()).
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DATA_DIR = Path("data")
VACANCIES = DATA_DIR / "vacancies.json"
MANIFEST = DATA_DIR / "link_previews.json"
PREVIEW_DIR = Path("assets/previews")
CONFIG_JS = Path("config.js")  # holds the public Supabase URL + anon key

THUMB_WIDTH = 480           # downscaled output width (px); height keeps aspect
MAX_THUMB_HEIGHT = 640      # crop very tall pages so cards stay reasonable
REQUEST_TIMEOUT = 15        # seconds, per link
PAGE_TIMEOUT_MS = 15000     # Playwright navigation timeout
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def url_key(url: str) -> str:
    return hashlib.sha1(url.strip().encode("utf-8")).hexdigest()[:16]


def out_path(url: str) -> Path:
    return PREVIEW_DIR / f"{url_key(url)}.webp"


def save_thumb(img: Image.Image, dest: Path) -> None:
    img = img.convert("RGB")
    w, h = img.size
    if w > THUMB_WIDTH:
        h = round(h * THUMB_WIDTH / w)
        img = img.resize((THUMB_WIDTH, h), Image.LANCZOS)
    if img.height > MAX_THUMB_HEIGHT:
        img = img.crop((0, 0, img.width, MAX_THUMB_HEIGHT))
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "WEBP", quality=80, method=4)


def fetch(url: str) -> requests.Response:
    # verify=False: many Indian government domains serve public PDFs over a
    # misconfigured / incomplete TLS chain. This is a build-time tool fetching
    # PUBLIC documents only to render a thumbnail — no auth, no secrets — so a
    # bad cert is not worth dropping the preview over.
    return requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
        timeout=REQUEST_TIMEOUT,
        allow_redirects=True,
        stream=True,
        verify=False,
    )


def looks_like_pdf(url: str, resp: requests.Response) -> bool:
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if "application/pdf" in ctype:
        return True
    if "text/html" in ctype:
        return False
    return resp.url.lower().split("?")[0].endswith(".pdf") or url.lower().split("?")[0].endswith(".pdf")


def render_pdf(content: bytes, dest: Path) -> bool:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=content, filetype="pdf")
    try:
        if doc.page_count == 0:
            return False
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x for crispness
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        save_thumb(img, dest)
        return True
    finally:
        doc.close()


def render_html(url: str, dest: Path, browser) -> bool:
    page = browser.new_page(viewport={"width": 1200, "height": 800})
    try:
        page.goto(url, timeout=PAGE_TIMEOUT_MS, wait_until="load")
        png = page.screenshot(clip={"x": 0, "y": 0, "width": 1200, "height": 800})
        img = Image.open(io.BytesIO(png))
        save_thumb(img, dest)
        return True
    finally:
        page.close()


def read_supabase_config() -> tuple[str, str]:
    """Supabase URL + anon key, from env (CI override) or config.js (committed,
    public — RLS limits the anon role to reading approved vacancies)."""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if url and key:
        return url, key
    if CONFIG_JS.exists():
        text = CONFIG_JS.read_text(encoding="utf-8")
        u = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text)
        k = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', text)
        if u and k and ".supabase.co" in u.group(1) and "YOUR_" not in k.group(1):
            return u.group(1).rstrip("/"), k.group(1)
    return "", ""


def _field(row: dict, *names: str) -> str:
    """First non-empty value across casings (Supabase columns are lowercase;
    the committed JSON / enriched rows use Title_Case)."""
    for n in names:
        val = row.get(n)
        if val:
            return str(val).strip()
    return ""


def rows_to_pairs(rows: list[dict]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for v in rows:
        vid = _field(v, "Vacancy_ID", "vacancy_id")
        url = _field(v, "Official_Notification_Link", "official_notification_link")
        if vid and url.startswith(("http://", "https://")):
            pairs.append((vid, url))
    return pairs


def load_pairs() -> list[tuple[str, str]]:
    """Prefer Supabase (the live source the site reads) so Vacancy_IDs match;
    fall back to the committed data/vacancies.json."""
    url, key = read_supabase_config()
    if url and key:
        try:
            resp = requests.get(
                f"{url}/rest/v1/vacancies",
                params={"status": "eq.approved", "select": "*"},
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            rows = resp.json()
            print(f"Source: Supabase ({len(rows)} approved rows).")
            return rows_to_pairs(rows)
        except Exception as exc:  # noqa: BLE001
            print(f"Supabase fetch failed ({exc}); falling back to {VACANCIES}.")

    if not VACANCIES.exists():
        print(f"!! No Supabase config and {VACANCIES} missing.", file=sys.stderr)
        sys.exit(1)
    print(f"Source: {VACANCIES} (fallback).")
    return rows_to_pairs(json.loads(VACANCIES.read_text(encoding="utf-8")))


def main() -> None:
    # (vacancy_id -> url) and the set of unique URLs to render
    pairs = load_pairs()

    unique_urls = sorted({url for _, url in pairs})
    print(f"{len(pairs)} notification links across {len(unique_urls)} unique URLs.")

    # Render unique URLs (skip cache hits). Lazily start Playwright only if an
    # HTML page actually needs it, so PDF-only runs don't pay the browser cost.
    rendered: set[str] = set()  # URLs that now have a thumbnail on disk
    browser = None
    playwright = None
    try:
        for url in unique_urls:
            dest = out_path(url)
            if dest.exists():
                rendered.add(url)
                continue
            try:
                resp = fetch(url)
                if resp.status_code >= 400:
                    print(f"  skip {resp.status_code}: {url}")
                    continue
                if looks_like_pdf(url, resp):
                    if render_pdf(resp.content, dest):
                        rendered.add(url)
                        print(f"  pdf  -> {dest.name}  ({url})")
                else:
                    if browser is None:
                        from playwright.sync_api import sync_playwright

                        playwright = sync_playwright().start()
                        browser = playwright.chromium.launch()
                    if render_html(resp.url, dest, browser):
                        rendered.add(url)
                        print(f"  html -> {dest.name}  ({url})")
            except Exception as exc:  # noqa: BLE001 - one bad link must not abort
                print(f"  fail: {url}  ({type(exc).__name__}: {exc})")
                if dest.exists():
                    dest.unlink(missing_ok=True)  # don't leave a partial file
    finally:
        if browser is not None:
            browser.close()
        if playwright is not None:
            playwright.stop()

    # Manifest: Vacancy_ID -> thumbnail path, only where the thumbnail exists.
    manifest: dict[str, str] = {}
    referenced: set[Path] = set()
    for vid, url in pairs:
        if url in rendered:
            dest = out_path(url)
            manifest[vid] = dest.as_posix()
            referenced.add(dest.resolve())

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Prune thumbnails no longer referenced by the current data.
    pruned = 0
    if PREVIEW_DIR.exists():
        for f in PREVIEW_DIR.glob("*.webp"):
            if f.resolve() not in referenced:
                f.unlink()
                pruned += 1

    print(
        f"Wrote {MANIFEST} with {len(manifest)} previews; "
        f"{len(rendered)} thumbnails on disk; pruned {pruned}."
    )


if __name__ == "__main__":
    main()
