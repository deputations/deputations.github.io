#!/usr/bin/env python3
"""
build_og_images.py — generate per-vacancy OG image (1200x630 PNG)
using Pillow. One image per approved vacancy.

Output: ../og/<Vacancy_ID>.png (relative to repo root).
The Astro build mirrors this dir into astro/public/og/ so the
deployed site can serve them at /og/<id>.png.

Image layout:
  - dark background (#02040b) with brand gradient strip at top
  - "DEPUTATIONS" wordmark + a small "Live Vacancy" pill
  - post name (large, bold, 2-line truncation)
  - ministry + organisation (medium)
  - bottom row: level pill, location, closing date

The script uses Pillow's bundled default font for cross-platform
behaviour (no font file shipping). Drop a TTF in scripts/fonts/
to override.

Run by the daily data cron right after build_data.py.
"""

import json
import os
import re
import textwrap
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR  = REPO_ROOT / "data"
OUT_DIR   = REPO_ROOT / "og"
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 1200, 630
BG = (2, 4, 11)              # match site dark theme
ACCENT = (34, 211, 238)        # primary cyan
ACCENT2 = (167, 139, 250)      # purple
TXT_PRIMARY = (238, 246, 255)
TXT_MUTED = (148, 163, 184)
TXT_DIM = (100, 116, 139)
SURFACE = (15, 23, 42)
BORDER = (45, 55, 72)

def load_font(size, weight="regular"):
    """Load a TTF if available, fall back to Pillow's default.

    Looks for scripts/fonts/Inter-{weight}.ttf; if missing, uses
    Pillow's bundled bitmap font (size 15 max with load_default)."""
    candidates = [
        REPO_ROOT / "scripts" / "fonts" / f"Inter-{weight}.ttf",
        REPO_ROOT / "scripts" / "fonts" / f"PlusJakartaSans-{weight}.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if weight == "bold" else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if weight == "bold" else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/seguisb.ttf" if weight == "bold" else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for c in candidates:
        if c.exists():
            try:
                return ImageFont.truetype(str(c), size)
            except Exception:
                continue
    return ImageFont.load_default()

# Cache fonts (loading is expensive)
FONT_BIG = load_font(60, "bold")
FONT_MID = load_font(34, "bold")
FONT_SM = load_font(22, "regular")
FONT_TINY = load_font(18, "regular")

def clean(s, maxlen=200):
    if s is None:
        return ""
    s = str(s).strip()
    s = re.sub(r"\s+", " ", s)
    if len(s) > maxlen:
        s = s[: maxlen - 1].rstrip() + "…"
    return s

def wrap_to_width(draw, text, font, max_px):
    """Wrap text to fit within max_px pixels. Uses textlength for measurement."""
    words = text.split()
    if not words:
        return [""]
    lines = []
    cur = words[0]
    for w in words[1:]:
        cand = cur + " " + w
        if draw.textlength(cand, font=font) <= max_px:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines

def grad_bar(img, w, h, c1, c2):
    """Draw a 4px gradient strip at the top of the image (brand accent)."""
    grad = Image.new("RGB", (w, 4), c1)
    d = ImageDraw.Draw(grad)
    for x in range(w):
        t = x / max(w - 1, 1)
        c = (
            int(c1[0] * (1 - t) + c2[0] * t),
            int(c1[1] * (1 - t) + c2[1] * t),
            int(c1[2] * (1 - t) + c2[2] * t),
        )
        d.line([(x, 0), (x, 4)], fill=c)
    img.paste(grad, (0, 0))

def draw_pill(draw, xy, text, font, fill, text_color):
    x, y, w, h = xy
    draw.rounded_rectangle(xy, radius=h // 2, fill=fill)
    tw = draw.textlength(text, font=font)
    draw.text((x + (w - tw) // 2, y + (h - font.size) // 2 - 2), text, font=font, fill=text_color)
    return (x + w, y + h)

def make_image(row, out_path):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    grad_bar(img, W, 4, ACCENT, ACCENT2)

    # Header: brand wordmark + Live Vacancy pill
    d.text((60, 50), "DEPUTATIONS", font=FONT_MID, fill=TXT_PRIMARY)
    pill_x = 60
    pill_y = 105
    pill_w, pill_h = 200, 32
    d.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h),
                        radius=pill_h // 2, fill=(34, 211, 238, 60), outline=ACCENT, width=1)
    d.text((pill_x + 16, pill_y + 7), "● LIVE VACANCY", font=FONT_TINY, fill=ACCENT)

    # Divider line
    d.line([(60, 165), (W - 60, 165)], fill=BORDER, width=1)

    # Post name — main hero text, 2-line wrap
    post = clean(row.get("Post_Name", "Vacancy"), 200)
    title_lines = wrap_to_width(d, post, FONT_BIG, W - 120)
    title_lines = title_lines[:2]
    if len(title_lines) == 2 and d.textlength(title_lines[1] + "…", font=FONT_BIG) > W - 120:
        # Avoid awkward half-word truncation
        title_lines[1] = title_lines[1].rstrip(",.;:") + "…"
    y = 200
    for line in title_lines:
        d.text((60, y), line, font=FONT_BIG, fill=TXT_PRIMARY)
        y += 70

    # Subtitle: ministry + organisation
    ministry = clean(row.get("Ministry", ""), 100)
    org = clean(row.get("Organisation") or row.get("Department") or "", 100)
    if org and org != ministry:
        subtitle = f"{org} · {ministry}" if ministry else org
    else:
        subtitle = ministry or org
    if subtitle:
        # wrap
        for line in wrap_to_width(d, subtitle, FONT_SM, W - 120)[:2]:
            d.text((60, y), line, font=FONT_SM, fill=TXT_MUTED)
            y += 30
    y += 14

    # Bottom strip: level, location, closing date pills
    pill_y = max(y + 30, H - 110)
    pill_x = 60
    pills = []
    level = clean(row.get("Level_Text", "") or row.get("Level", ""))
    if level:
        pills.append((level, ACCENT, (2, 25, 35)))
    loc = clean(row.get("location_label") or row.get("Location_City", ""))
    if loc:
        pills.append((f"📍 {loc}", TXT_PRIMARY, SURFACE))
    last_date = clean(row.get("Last_Date_To_Apply_Display") or
                      (str(row.get("Last_Date_To_Apply", ""))[:10]),
                      20)
    if last_date:
        # days_left
        days_left = row.get("Days_Left")
        if isinstance(days_left, (int, float)):
            if days_left < 0:
                closing_text = f"Closed {abs(int(days_left))}d ago · {last_date}"
                closing_color = (248, 113, 113)
            elif days_left == 0:
                closing_text = f"Closes today · {last_date}"
                closing_color = (251, 191, 36)
            else:
                closing_text = f"Closes in {int(days_left)}d · {last_date}"
                closing_color = (52, 211, 153)
        else:
            closing_text = f"Closes {last_date}"
            closing_color = TXT_MUTED
        pills.append((closing_text, closing_color, SURFACE))

    for text, fg, bg in pills:
        # size pill to text
        tw = int(d.textlength(text, font=FONT_SM)) + 32
        if pill_x + tw > W - 60:
            # wrap to next line
            pill_y += 50
            pill_x = 60
        d.rounded_rectangle((pill_x, pill_y, pill_x + tw, pill_y + 36),
                            radius=18, fill=bg, outline=BORDER, width=1)
        d.text((pill_x + 16, pill_y + 7), text, font=FONT_SM, fill=fg)
        pill_x += tw + 12

    # Tiny footer: site URL
    d.text((60, H - 36), "alldeputations.com", font=FONT_TINY, fill=TXT_DIM)

    img.save(out_path, "PNG", optimize=True)

def read_vacancies():
    p = DATA_DIR / "vacancies.json"
    if not p.exists():
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

def main():
    rows = read_vacancies()
    if not rows:
        print("No vacancies to render.")
        return
    # Track filename → Vacancy_ID to detect collisions. Two vacancies
    # in the data can share an id-cleaned filename (rare; happens if
    # Supabase admin re-imports an existing vacancy). When that
    # happens, the LATER write overwrites the earlier; we accept that
    # and emit a warning so the issue is visible.
    seen = {}
    n_written = 0
    n_skipped = 0
    for r in rows:
        vid = r.get("Vacancy_ID")
        if not vid:
            n_skipped += 1
            continue
        safe = re.sub(r"[^A-Za-z0-9_\-]", lambda m: "_" if m.group(0) != "-" else "-", str(vid))
        out = OUT_DIR / f"{safe}.png"
        if safe in seen and seen[safe] != vid:
            print("  ! collision: {} and {} both map to {}".format(seen[safe], vid, safe))
        seen[safe] = vid
        try:
            make_image(r, out)
            n_written += 1
        except Exception as e:
            print("  ! failed for {}: {}".format(vid, e))
            n_skipped += 1
    print("Wrote {} OG images to {} ({} skipped)".format(n_written, OUT_DIR, n_skipped))

if __name__ == "__main__":
    main()