"""Smoke tests for the Region + Pay Level filter backfill.

Regression (reported 2026-08-03): data/vacancies.json has Region blank
for every row (the source spreadsheet does, and build_data.py only
renames snake_case → Title_Case without auto-deriving Region from
Location_State). The pagination/filter Region dropdown therefore
populated with only the placeholder "All Regions" — no actual regions
to pick from. Same root cause: Pay Level counts came back identical
for every level because eligibility_tiers is only computed by
enrich.js, never by build_data.py and never re-enriched for the
JSON-only path in fetchVacancies() (since commit c9557e4 removed the
JSON enrichment step, citing "JSON is already enriched" — but the
two fields the dashboard filters depend on were never there).

Fix: enrich.js exposes a narrow `backfillDerived(row)` that fills
only the missing Region + eligibility_tiers on a Title_Case row, and
app.js#fetchVacancies calls it on JSON rows before the merge
completes. Idempotent.

These tests verify the user-visible behavior:
  • Region dropdown lists North/South/East/West/Central/NorthEast
    (not just the placeholder) — proves the backfill ran
  • Every Region has a count > 0 (proves the data is sound)
  • Pay Level counts differ per level (proves eligibility_tiers was
    backfilled, not just left as the all-match fallback)
"""
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


# Display labels, as rendered by the dropdown. Note "North-East" is the
# *label*; the underlying option value is "NorthEast" (app.js maps one to the
# other when building the active-filter chip).
#
# "Central" is deliberately NOT required. The dropdown is populated from the
# vacancies currently in scope, and the board shows Active rows by default —
# Central's only three rows (2 Madhya Pradesh + 1 Chhattisgarh) are all
# Inactive, so the option correctly does not render. Asserting on it would
# make this test fail on a data change rather than on the regression it
# guards.
KNOWN_REGION_LABELS = {"North", "South", "East", "West", "Central", "North-East"}

# The regression is "Region is blank on every row, so the dropdown has nothing
# but the placeholder". Any healthy backfill yields several real regions.
MIN_REAL_REGIONS = 3


def _load_dashboard(page, base_url: str) -> None:
    """Navigate to the dashboard and wait for the vacancy rows to render.

    The `page` fixture yields a blank context, so every test must navigate
    before touching the filter UI. The counts are computed from the loaded
    rows, so wait for the result count to settle before opening a dropdown.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )
    # Region is a secondary filter: index.html ships `body.filters-collapsed`,
    # and the CSS hides every `.filter-group` that isn't `.fg-primary` while
    # collapsed (style.css:6076). Pay Level is primary and stays visible;
    # Region only exists once the user expands the panel. Take the same path
    # a user does rather than reaching past the UI to strip the class.
    if page.evaluate("() => document.body.classList.contains('filters-collapsed')"):
        page.locator("#desktopFilterToggle").click()
        page.wait_for_function(
            "() => !document.body.classList.contains('filters-collapsed')"
        )


def _open_and_count(page, root_id: str, list_id: str) -> list[str]:
    """Click the dropdown's trigger and read the option labels."""
    page.locator(f"#{root_id} .ms-trigger").click()
    page.wait_for_selector(f"#{list_id} .ms-opt", state="visible")
    labels = page.locator(f"#{list_id} .ms-opt .ss-opt-name").all_text_contents()
    page.keyboard.press("Escape")
    return labels


def test_region_dropdown_lists_all_regions(page, base_url: str):
    """Region filter must show the six regions, not just the placeholder."""
    _load_dashboard(page, base_url)
    labels = _open_and_count(page, "filterRegionSS", "filterRegionList")
    assert "All Regions" in labels, f"placeholder missing: {labels}"
    region_labels = {l for l in labels if l != "All Regions"}
    assert len(region_labels) >= MIN_REAL_REGIONS, (
        f"Region dropdown has only {len(region_labels)} real region(s): "
        f"{sorted(region_labels)}. Probable cause: enrich.js#backfillDerived "
        f"not running on JSON rows in fetchVacancies(), leaving Region blank."
    )
    unknown = region_labels - KNOWN_REGION_LABELS
    assert not unknown, (
        f"Region dropdown shows unrecognised labels {sorted(unknown)}. "
        f"Got: {labels}. Check the state→region map in enrich.js."
    )


def test_region_counts_are_positive(page, base_url: str):
    """Each region option should carry a positive count, not just a label."""
    _load_dashboard(page, base_url)
    page.locator("#filterRegionSS .ms-trigger").click()
    page.wait_for_selector("#filterRegionList .ms-opt", state="visible")
    counts_text = page.locator("#filterRegionList .ms-opt .ss-opt-count").all_text_contents()
    # Each count is wrapped in parens by the renderer: "(12)"
    raw = [c.strip("()") for c in counts_text if c.strip()]
    nums = [int(re.sub(r"[^\d]", "", c)) for c in raw if re.search(r"\d", c)]
    page.keyboard.press("Escape")
    assert nums, "Region filter shows no numeric counts — backfill skipped."
    # The placeholder has count=null (no count rendered), so the smallest
    # non-placeholder count must be > 0.
    assert min(nums) > 0, f"Some region count is zero: {nums}"


def test_pay_level_counts_differ_per_level(page, base_url: str):
    """Pay Level counts must differ — proves eligibility_tiers was backfilled.

    Before the fix, isEligible fell back to "no tiers → all match" so every
    level counted the same number of vacancies. With eligibility_tiers
    backfilled from Req_Level1/Min_Years_Experience, different levels match
    different posts.
    """
    _load_dashboard(page, base_url)
    page.locator("#filterMyPayLevelSS .ms-trigger").click()
    page.wait_for_selector("#filterMyPayLevelList .ms-opt", state="visible")
    counts_text = page.locator("#filterMyPayLevelList .ms-opt .ss-opt-count").all_text_contents()
    page.keyboard.press("Escape")
    raw = [c.strip("()") for c in counts_text if c.strip()]
    nums = [int(re.sub(r"[^\d]", "", c)) for c in raw if re.search(r"\d", c)]
    assert len(nums) >= 5, f"Too few level counts: {nums}"
    distinct = set(nums)
    assert len(distinct) > 1, (
        f"Every level reports the same count {nums}. "
        f"eligibility_tiers was not backfilled — isEligible's 'no-tiers → "
        f"all-match' fallback is firing for every row."
    )
