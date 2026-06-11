"""Generate the brand raster assets (favicon.ico, apple-touch-icon, og-home).

Vector source of truth is assets/brand/favicon.svg — this script re-draws the
same mark with Pillow so we don't need an SVG rasteriser dependency.
Run:  python scripts/make_brand_assets.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "assets", "brand")
os.makedirs(BRAND, exist_ok=True)

CYAN = (34, 211, 238)
VIOLET = (167, 139, 250)
INK = (4, 17, 28)
BG = (2, 4, 11)


def diag_gradient(size: tuple[int, int], c1=CYAN, c2=VIOLET) -> Image.Image:
    """Top-left → bottom-right linear gradient."""
    w, h = size
    base = Image.new("RGB", (w + h, 1))
    for x in range(w + h):
        t = x / max(1, w + h - 1)
        base.putpixel((x, 0), tuple(int(a + (b - a) * t) for a, b in zip(c1, c2)))
    grad = base.resize((w + h, w + h))
    return grad.rotate(-45, expand=False).crop(((w + h - w) // 2, (w + h - h) // 2,
                                                (w + h + w) // 2, (w + h + h) // 2))


def draw_d_mask(size: int, scale: float = 1.0) -> Image.Image:
    """White-on-black mask of the brand 'D' (heavy glyph, optically centred)."""
    s = size
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    font = find_font(["seguibl.ttf", "segoeuib.ttf", "arialbd.ttf"], int(s * 0.66 * scale))
    bbox = d.textbbox((0, 0), "D", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - tw) / 2 - bbox[0], (s - th) / 2 - bbox[1]), "D", font=font, fill=255)
    return m


def rounded_tile(size: int, radius_ratio: float = 0.28) -> Image.Image:
    """Dark rounded-square tile with a gradient ring + gradient D."""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rad = int(s * radius_ratio)

    tile_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle([0, 0, s - 1, s - 1], rad, fill=255)
    img.paste(Image.new("RGB", (s, s), INK), (0, 0), tile_mask)

    grad = diag_gradient((s, s))

    ring = Image.new("L", (s, s), 0)
    rw = max(1, int(s * 0.05))
    ImageDraw.Draw(ring).rounded_rectangle([rw, rw, s - 1 - rw, s - 1 - rw], rad - rw // 2,
                                           outline=255, width=rw)
    img.paste(grad, (0, 0), ring)

    d_mask = draw_d_mask(s)
    img.paste(grad, (0, 0), d_mask)
    return img


def find_font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for n in names:
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", n)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_og() -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)

    # soft brand glows
    glow = Image.new("RGB", (W, H), BG)
    g = ImageDraw.Draw(glow)
    g.ellipse([-260, -260, 420, 420], fill=(10, 40, 52))
    g.ellipse([W - 420, H - 400, W + 260, H + 260], fill=(36, 27, 64))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.blend(img, glow, 0.85)

    draw = ImageDraw.Draw(img)

    tile = rounded_tile(148, 0.24)
    img.paste(tile, (86, 92), tile)

    f_name = find_font(["seguibl.ttf", "segoeuib.ttf", "arialbd.ttf"], 86)
    f_tag = find_font(["segoeuisb.ttf", "segoeui.ttf", "arial.ttf"], 36)
    f_sub = find_font(["segoeui.ttf", "arial.ttf"], 30)
    f_url = find_font(["segoeuib.ttf", "arialbd.ttf"], 32)

    draw.text((270, 110), "Deputations", font=f_name, fill=(243, 246, 252))

    # gradient underline
    grad = diag_gradient((520, 8))
    img.paste(grad, (274, 226))

    draw.text((88, 304), "Central Government Deputation Vacancies", font=f_tag, fill=(214, 226, 240))
    draw.text((88, 362), "Searchable live dashboard — filter by pay level, eligibility,", font=f_sub, fill=(154, 168, 192))
    draw.text((88, 404), "ministry, location and closing date.", font=f_sub, fill=(154, 168, 192))

    # url chip
    chip_w, chip_h, cx, cy = 420, 64, 88, 488
    chip = Image.new("RGBA", (chip_w, chip_h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    cd.rounded_rectangle([0, 0, chip_w - 1, chip_h - 1], 32, fill=(13, 20, 36, 255),
                         outline=(34, 211, 238, 160), width=2)
    img.paste(chip, (cx, cy), chip)
    draw.text((cx + 28, cy + 13), "deputations.github.io", font=f_url, fill=(34, 211, 238))

    img.save(os.path.join(BRAND, "og-home.png"), optimize=True)
    print("og-home.png", img.size)


def main() -> None:
    # favicon.ico (multi-size) at repo root
    sizes = [16, 32, 48]
    tiles = [rounded_tile(s * 4).resize((s, s), Image.LANCZOS) for s in sizes]
    tiles[-1].save(os.path.join(ROOT, "favicon.ico"),
                   sizes=[(s, s) for s in sizes],
                   append_images=tiles[:-1])
    print("favicon.ico", sizes)

    apple = rounded_tile(720, 0.24).resize((180, 180), Image.LANCZOS)
    base = Image.new("RGB", (180, 180), INK)  # iOS dislikes transparency
    base.paste(apple, (0, 0), apple)
    base.save(os.path.join(BRAND, "apple-touch-icon.png"), optimize=True)
    print("apple-touch-icon.png")

    make_og()


if __name__ == "__main__":
    main()
