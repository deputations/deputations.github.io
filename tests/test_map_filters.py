"""The home page's filters on the India map.

A selection made on either page is saved for the browser tab
(shared/vacancy-filters.js), so it is still applied when the other page
opens, and the map's counts follow it. The panel sits on the left of the
India view, on the right under the state's name on a state view, and opens
as a sheet from a Filters button on a phone: a row of tabs with one filter
open at a time, the map framed above it.

Runs on a fixed set of six vacancies (data/vacancies.json is stubbed; the
real state and district outlines are used).

Run:
    pytest tests/test_map_filters.py -v
"""
from __future__ import annotations

import json
import re

import pytest
from playwright.sync_api import Page, expect


def _row(vid: str, post: str, ministry: str, level: str, city: str, state: str) -> dict:
    return {
        "Vacancy_ID": vid, "Post_Name": post, "Ministry": ministry, "Level_Text": level,
        "Organisation": f"{ministry} Office", "Organisation_Type": "Attached Office",
        "Location_City": city, "Location_State": state, "Status": "Active",
        "Last_Date_To_Apply": "2099-12-31", "Notification_Date": "2026-10-01",
    }


VACANCIES = [
    _row("F1", "Accounts Officer", "Finance", "Level-10", "Mumbai", "Maharashtra"),
    _row("F2", "Section Officer", "Finance", "Level-10", "Pune", "Maharashtra"),
    _row("F3", "Station Master", "Railways", "Level-11", "Nagpur", "Maharashtra"),
    _row("F4", "Accounts Officer", "Finance", "Level-10", "Bengaluru", "Karnataka"),
    _row("F5", "Assistant", "Finance", "Level-10", "Mysuru", "Karnataka"),
    _row("F6", "Stenographer", "Railways", "Level-8", "New Delhi", "Delhi"),
]


@pytest.fixture()
def vacancies(page: Page) -> Page:
    page.route("**/data/vacancies.json*", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(VACANCIES)))
    page.emulate_media(reduced_motion="reduce")
    return page


def _open_home(page: Page, base_url: str, query: str = "") -> None:
    page.goto(f"{base_url}/index.html{query}")
    expect(page.locator("#resultsCount")).to_contain_text("vacancies", timeout=15000)


def _open_map(page: Page, base_url: str, query: str = "") -> None:
    page.goto(f"{base_url}/india-map.html{query}")
    page.wait_for_selector("#map-svg .ad-state", timeout=20000)
    expect(page.locator("#mapFilterPanel")).to_be_attached()


def _counter(page: Page):
    return page.locator("#mapCounterValue")


def _pick(page: Page, control: str, option: str) -> None:
    page.locator(f"#{control} .ms-trigger").click()
    page.locator(f"#{control} .ms-opt", has_text=option).first.click()


def test_home_selection_is_applied_on_the_map(vacancies: Page, base_url: str):
    page = vacancies
    _open_home(page, base_url, "?level=Level-10")
    expect(page.locator("#resultsCount")).to_contain_text("of 4 vacancies")

    _open_map(page, base_url)
    expect(page.locator("#mfLevelMS .ms-trigger-label")).to_have_text("Level-10")
    expect(_counter(page)).to_have_text("4")
    expect(page.locator("#mapFilterPanel .mfp-badge, #mapFiltersBtn .mfp-badge").first).to_have_text("1")
    expect(page.locator("#mfClear")).to_be_visible()


def test_map_selection_is_applied_on_the_home_page(vacancies: Page, base_url: str):
    page = vacancies
    _open_map(page, base_url)
    expect(_counter(page)).to_have_text("6")

    _pick(page, "mfMinistrySS", "Railways")
    expect(_counter(page)).to_have_text("2")

    _open_home(page, base_url)
    expect(page.locator("#resultsCount")).to_contain_text("of 2 vacancies")
    expect(page.locator("#filterMinistrySS .ms-trigger-label")).to_contain_text("Railways")


def test_option_counts_and_clear_all(vacancies: Page, base_url: str):
    page = vacancies
    _open_map(page, base_url)
    _pick(page, "mfMinistrySS", "Finance")
    expect(_counter(page)).to_have_text("4")

    # Pay Level counts are faceted: every other filter applies
    page.locator("#mfLevelMS .ms-trigger").click()
    level10 = page.locator("#mfLevelMS .ms-opt", has_text="Level-10")
    expect(level10.locator(".ss-opt-count")).to_have_text("(4)")
    expect(page.locator("#mfLevelMS .ms-opt", has_text="Level-11")).to_have_count(0)
    page.keyboard.press("Escape")

    page.locator("#mfClear").click()
    expect(_counter(page)).to_have_text("6")
    expect(page.locator("#mfMinistrySS .ms-trigger-label")).to_have_text("All Ministries")
    expect(page.locator("#mfClear")).to_be_hidden()
    saved = page.evaluate("sessionStorage.getItem('dep_filters_v1')")
    assert saved == "status=Active", saved


def test_state_counts_follow_the_filters(vacancies: Page, base_url: str):
    page = vacancies
    _open_home(page, base_url, "?ministry=Railways")
    _open_map(page, base_url, "?state=MH")
    title = page.locator("#mapStateTitle")
    expect(title).to_have_attribute("aria-label", re.compile(r"Maharashtra: 1 active vacancy"), timeout=15000)

    _pick(page, "mfMinistrySS", "Finance")
    expect(title).to_have_attribute("aria-label", re.compile(r"Maharashtra: 2 active vacancies"))
    expect(_counter(page)).to_have_text("4")


@pytest.mark.parametrize("size", [{"width": 1440, "height": 900}])
def test_panel_left_on_india_and_right_under_the_state_name(vacancies: Page, base_url: str, size: dict):
    page = vacancies
    page.set_viewport_size(size)
    _open_map(page, base_url)
    panel = page.locator("#mapFilterPanel")
    expect(panel).to_have_class(re.compile(r"\bis-left\b"))
    box = panel.bounding_box()
    assert box and box["x"] < 40, box
    # The map is framed beside the panel, not under it
    states = page.locator("#map-group").bounding_box()
    assert states and states["x"] >= box["x"] + box["width"], (states, box)

    _open_map(page, base_url, "?state=MH")
    expect(panel).to_have_class(re.compile(r"\bis-right\b"), timeout=15000)
    title = page.locator("#mapStateTitle")
    expect(title).to_be_visible(timeout=15000)
    box, name = panel.bounding_box(), title.locator(".mst-name").bounding_box()
    assert box["x"] + box["width"] > size["width"] - 40, box
    assert box["y"] >= name["y"] + name["height"], (box, name)
    expect(page.locator("#mapFiltersBtn")).to_be_hidden()


def test_several_levels_can_be_picked_in_one_go(vacancies: Page, base_url: str):
    """A pick redraws the list's counts; the list must stay open for the next."""
    page = vacancies
    _open_map(page, base_url)
    page.locator("#mfLevelMS .ms-trigger").click()
    page.locator("#mfLevelMS .ms-opt", has_text="Level-10").click()
    expect(page.locator("#mfLevelMS .ms-panel")).to_be_visible()
    page.locator("#mfLevelMS .ms-opt", has_text="Level-8").click()
    expect(_counter(page)).to_have_text("5")
    expect(page.locator("#mfLevelMS .ms-trigger-label")).to_have_text("2 levels")


def _visible_groups(page: Page) -> list[str]:
    return page.evaluate("""() => [...document.querySelectorAll('#mapFilterPanel .mfp-body .filter-group')]
        .filter(g => g.offsetParent !== null).map(g => g.dataset.group)""")


def _map_clear_of_sheet(page: Page) -> None:
    page.wait_for_function("""() => {
        const sheet = document.getElementById('mapFilterPanel').getBoundingClientRect();
        const map = document.getElementById('map-group').getBoundingClientRect();
        return map.height > 0 && map.bottom <= sheet.top + 1;
    }""", timeout=5000)


def test_phone_sheet_shows_one_filter_and_keeps_the_map_in_view(vacancies: Page, base_url: str):
    page = vacancies
    page.set_viewport_size({"width": 375, "height": 667})
    _open_map(page, base_url)
    panel = page.locator("#mapFilterPanel")
    expect(panel).to_have_class(re.compile(r"\bis-sheet\b"))
    expect(panel).to_be_hidden()
    page.locator("#mapFiltersBtn").click()
    expect(panel).to_be_visible()

    # Just the tabs at first; a tab opens its filter alone
    assert _visible_groups(page) == []
    page.locator('.mfp-tab[data-tab="ministry"]').click()
    assert _visible_groups(page) == ["ministry"]
    _map_clear_of_sheet(page)
    _pick(page, "mfMinistrySS", "Railways")
    expect(_counter(page)).to_have_text("2")
    expect(page.locator('.mfp-tab[data-tab="ministry"]')).to_have_class(re.compile(r"\bis-set\b"))

    # Another tab replaces it; the same tab again closes it
    page.locator('.mfp-tab[data-tab="me"]').click()
    assert _visible_groups(page) == ["me", "me"]
    page.locator('.mfp-tab[data-tab="me"]').click()
    assert _visible_groups(page) == []

    page.locator("#mfClose").click()
    expect(panel).to_be_hidden()
    expect(page.locator("#mapFiltersBtn .mfp-badge")).to_have_text("1")


def test_phone_state_view_keeps_the_state_above_the_sheet(vacancies: Page, base_url: str):
    page = vacancies
    page.set_viewport_size({"width": 375, "height": 667})
    _open_map(page, base_url, "?state=MH")
    expect(page.locator("#btn-back")).to_be_visible(timeout=15000)
    page.locator("#mapFiltersBtn").click()
    page.locator('.mfp-tab[data-tab="level"]').click()
    _map_clear_of_sheet(page)
