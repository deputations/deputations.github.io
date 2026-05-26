"""Replace each <div class="mockup">...</div> block in the manual with a real screenshot."""
import re
from pathlib import Path

MANUAL = Path(__file__).resolve().parent.parent / "my-deputation-manual.html"
text = MANUAL.read_text(encoding="utf-8")

TABS = [
    ("overview",  "#overview",  "Overview dashboard — welcome strip and bento cards"),
    ("bookmarks", "#bookmarks", "Bookmarks grid — match %, tracker stage, deadlines"),
    ("searches",  "#searches",  "Saved searches with new-match badges and run/edit/delete"),
    ("tracker",   "#tracker",   "Tracker kanban — drag cards across proper-channel stages"),
    ("documents", "#documents", "Document checklist with status pills, dates, and notes"),
    ("profile",   "#profile",   "Profile form with export / import / reset controls"),
]

# Pattern matches a single <div class="mockup">...</div> containing the given hash anchor.
# Greedy on attributes, non-greedy on body, anchored by the unique hash in mockup-url.
for tab, hash_str, alt in TABS:
    pattern = re.compile(
        r'<div class="mockup">\s*'
        r'<div class="mockup-chrome">.*?'
        + re.escape(hash_str) + r'.*?</div>'
        r'\s*<div class="mockup-body">.*?</div>\s*</div>',
        re.DOTALL,
    )
    replacement = (
        f'<div class="mockup shot-mockup">\n'
        f'      <div class="mockup-chrome">'
        f'<div class="mockup-dot r"></div><div class="mockup-dot y"></div><div class="mockup-dot g"></div>'
        f'<div class="mockup-url">deputations.github.io/my-deputation.html{hash_str}</div>'
        f'</div>\n'
        f'      <div class="mockup-body"><img src="assets/manual/{tab}.png" alt="{alt}" loading="lazy"></div>\n'
        f'    </div>'
    )
    new_text, n = pattern.subn(replacement, text)
    if n != 1:
        raise SystemExit(f"FAILED: {tab} replaced {n} times (expected 1)")
    text = new_text
    print(f"swapped {tab}")

MANUAL.write_text(text, encoding="utf-8")
print("done")
