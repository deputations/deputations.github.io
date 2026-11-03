"""Default pay-level ordering, filter resets, and user-selected column sorts."""
from datetime import date, datetime, timezone

import pytest
from playwright.sync_api import expect

from tests.test_index import _row, _serve_fixture_rows


@pytest.fixture()
def sorted_page(page, base_url):
    page.emulate_media(reduced_motion="reduce")
    page.clock.set_fixed_time(datetime(2026, 10, 28, 10, tzinfo=timezone.utc))
    rows = []
    for i, level in enumerate(["2", "13A", "14", "13", "10", "9", "8", "6", "5", "4", "3", "1", "", None, "   "]):
        row = _row(f"SORT-{i:02}", i + 1, date(2026, 10, 28))
        row.update(Level_Text=f"Level-{level}" if level and level.strip() else level,
                   Post_Name=f"Test Post {i:02}", Ministry="Finance" if i % 2 == 0 else "Railways")
        rows.append(row)
    _serve_fixture_rows(page, rows)
    page.goto(f"{base_url}/index.html")
    expect(page.locator("tr.clickable-row")).to_have_count(10)
    return page


def _ids(page):
    return page.locator("tr.clickable-row").evaluate_all("els => els.map(e => e.dataset.openDetails)")


def _default(page):
    expect(page.locator('[data-sort="Level_Text"]')).to_have_class("sort-btn active")
    expect(page.locator('[data-sort="Level_Text"] .sort-indicator')).to_have_text("↓")


def _post_sort(page):
    page.locator('[data-sort="Post_Name"]').click()
    expect(page.locator('[data-sort="Post_Name"]')).to_have_class("sort-btn active")


def test_initial_pay_sort_keeps_empty_rows_last_across_pages(sorted_page):
    page = sorted_page
    _default(page)
    assert _ids(page) == [f"SORT-{i:02}" for i in [2, 1, 3, 4, 5, 6, 7, 8, 9, 10]]
    expect(page.locator("#resultsCount")).to_contain_text("of 15 vacancies")
    page.locator('[data-page="2"]').click()
    assert _ids(page) == ["SORT-00", "SORT-11", "SORT-12", "SORT-13", "SORT-14"]
    _default(page)


def test_manual_column_sort_survives_paging_and_bookmarking(sorted_page):
    page = sorted_page
    _post_sort(page)
    assert _ids(page) == [f"SORT-{i:02}" for i in range(10)]
    page.locator('[data-page="2"]').click()
    assert _ids(page) == ["SORT-10", "SORT-11", "SORT-12", "SORT-13", "SORT-14"]
    page.locator('[data-table-action="watchlist"]').first.click()
    expect(page.locator('[data-sort="Post_Name"]')).to_have_class("sort-btn active")
    assert _ids(page) == ["SORT-10", "SORT-11", "SORT-12", "SORT-13", "SORT-14"]


@pytest.mark.parametrize("key", ["Post_Name", "Level_Text", "Eligibility", "Ministry", "Org", "Location", "Days_Left", "Notification_Date"])
def test_every_table_column_can_still_be_sorted(sorted_page, key):
    page = sorted_page
    page.locator(f'[data-sort="{key}"]').click()
    expect(page.locator(f'[data-sort="{key}"]')).to_have_class("sort-btn active")
    expect(page.locator(f'[data-sort="{key}"] .sort-indicator')).to_have_text("↑")
    page.locator(f'[data-sort="{key}"]').click()
    expect(page.locator(f'[data-sort="{key}"] .sort-indicator')).to_have_text("↓")
    expect(page.locator("#resultsCount")).to_contain_text("of 15 vacancies")


def test_dropdown_and_chip_removal_restore_default_sort(sorted_page):
    page = sorted_page
    _post_sort(page)
    page.locator("#desktopFilterToggle").click()
    page.locator("#filterMinistrySS .ms-trigger").click()
    page.locator('#filterMinistrySS [data-value="Finance"]').click()
    _default(page)
    assert _ids(page) == [f"SORT-{i:02}" for i in [2, 4, 6, 8, 10, 0, 12, 14]]
    _post_sort(page)
    page.locator('[data-remove-filter="ministry"]').click()
    _default(page)
    assert _ids(page)[0] == "SORT-02"


def test_search_quick_filter_clear_and_kpi_restore_default_sort(sorted_page):
    page = sorted_page
    _post_sort(page)
    page.locator("#searchPost").fill("Test Post")
    _default(page)
    _post_sort(page)
    page.locator('[data-quick-filter="closing7"]').click()
    _default(page)
    assert _ids(page) == [f"SORT-{i:02}" for i in [2, 1, 3, 4, 5, 6, 0]]
    _post_sort(page)
    page.locator("#desktopFilterToggle").click()
    page.locator("#clearFiltersBtn").click()
    _default(page)
    _post_sort(page)
    page.locator('[data-kpi-filter="closingSoon"]').click()
    _default(page)


def test_url_filter_and_reload_start_with_pay_level_sort(sorted_page, base_url):
    page = sorted_page
    page.goto(f"{base_url}/index.html?ministry=Railways")
    _default(page)
    assert _ids(page) == [f"SORT-{i:02}" for i in [1, 3, 5, 7, 9, 11, 13]]
    _post_sort(page)
    page.reload()
    _default(page)
    assert _ids(page)[0] == "SORT-01"


def test_card_sort_remains_usable_and_resets_on_filter_change(sorted_page):
    page = sorted_page
    page.locator("#btnCardView").click()
    expect(page.locator("#cardSortSS .ms-trigger-label")).to_have_text("Highest level")
    page.locator("#cardSortSS .ms-trigger").click()
    page.locator('#cardSortSS [data-value="post"]').click()
    expect(page.locator("#cardSortSS .ms-trigger-label")).to_have_text("Post name A–Z")
    page.locator("#searchPost").fill("Test Post")
    expect(page.locator("#cardSortSS .ms-trigger-label")).to_have_text("Highest level")
    page.locator("#btnTableView").click()
    _default(page)


def test_blank_pay_levels_remain_in_filter_counts(sorted_page):
    page = sorted_page
    page.locator("#desktopFilterToggle").click()
    page.locator("#filterMinistrySS .ms-trigger").click()
    expect(page.locator('#filterMinistrySS [data-value="Finance"] .ss-opt-count')).to_have_text("(8)")
    expect(page.locator('#filterMinistrySS [data-value="Railways"] .ss-opt-count')).to_have_text("(7)")


def test_empty_pay_levels_stay_last_when_sorting_ascending(sorted_page):
    page = sorted_page
    page.locator('[data-sort="Level_Text"]').click()
    expect(page.locator('[data-sort="Level_Text"] .sort-indicator')).to_have_text("↑")
    assert _ids(page) == [f"SORT-{i:02}" for i in [11, 0, 10, 9, 8, 7, 6, 5, 4, 3]]
    page.locator('[data-page="2"]').click()
    assert _ids(page) == ["SORT-01", "SORT-02", "SORT-12", "SORT-13", "SORT-14"]
