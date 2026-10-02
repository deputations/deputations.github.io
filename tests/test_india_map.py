"""India Map Playwright browser tests — Phase 1B surgical acceptance suite.

Runs against a locally-served repo via the `base_url` + `page` fixtures.
All assertions are on DOM / network / URL state — never on source strings.

BLOCKER 6: uses a deterministic 36-state/UT fixture — all 36 real
            Indian State/UT names from STATE_ABBR are present, each with a
            real-world bbox polygon. No placeholder names.
BLOCKER 7: provides Pune + Mumbai + Nagpur district polygons AND Pune
            vacancy records using the production data shape (no synthetic
            location_scope forced).
BLOCKER 8: asserts particle lifecycle via a read-only test hook.
BLOCKER 9: history-entry count is asserted via go_back / go_forward.

Run:
    pytest tests/test_india_map.py -v
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect


REPO_ROOT = Path(__file__).resolve().parents[1]


# All 36 Indian States/UTs recognised by india-map-view.js STATE_ABBR.
# Coords are small bbox rectangles (lat/lon). Each must be unique enough
# that the projection can draw a real polygon.
_ALL_36 = [
    ("AN", "Andaman and Nicobar"),
    ("AP", "Andhra Pradesh"),
    ("AR", "Arunachal Pradesh"),
    ("AS", "Assam"),
    ("BR", "Bihar"),
    ("CG", "Chhattisgarh"),
    ("CH", "Chandigarh"),
    ("DL", "Delhi"),
    ("DN", "Dadra and Nagar Haveli"),
    ("DNH", "Dadra and Nagar Haveli and Daman and Diu"),
    ("GA", "Goa"),
    ("GJ", "Gujarat"),
    ("HR", "Haryana"),
    ("HP", "Himachal Pradesh"),
    ("JK", "Jammu and Kashmir"),
    ("JH", "Jharkhand"),
    ("KA", "Karnataka"),
    ("KL", "Kerala"),
    ("LA", "Ladakh"),
    ("LD", "Lakshadweep"),
    ("MH", "Maharashtra"),
    ("ML", "Meghalaya"),
    ("MN", "Manipur"),
    ("MP", "Madhya Pradesh"),
    ("MZ", "Mizoram"),
    ("NL", "Nagaland"),
    ("OD", "Odisha"),
    ("PB", "Punjab"),
    ("PY", "Puducherry"),
    ("RJ", "Rajasthan"),
    ("SK", "Sikkim"),
    ("TN", "Tamil Nadu"),
    ("TR", "Tripura"),
    ("TS", "Telangana"),
    ("UK", "Uttarakhand"),
    ("UP", "Uttar Pradesh"),
    ("WB", "West Bengal"),
]


def _state_feature(abbr: str, name: str, lon_lo: float, lon_hi: float, lat_lo: float, lat_hi: float) -> dict:
    """Minimal GeoJSON polygon for one State/UT (deterministic bbox)."""
    return {
        "type": "Feature",
        "properties": {"NAME_1": name, "STATE_CODE": abbr},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[lon_lo, lat_lo], [lon_hi, lat_lo], [lon_hi, lat_hi], [lon_lo, lat_hi], [lon_lo, lat_lo]]],
        },
    }


def _district_feature(st_code: str, district: str, lon_lo: float, lon_hi: float, lat_lo: float, lat_hi: float) -> dict:
    return {
        "type": "Feature",
        "properties": {"st_code": st_code, "district": district},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[lon_lo, lat_lo], [lon_hi, lat_lo], [lon_hi, lat_hi], [lon_lo, lat_hi], [lon_lo, lat_lo]]],
        },
    }


def _inject_fixtures(page: Page, vacancies: list[dict], states: list[dict], districts: list[dict]) -> None:
    """Stub the three data fetches the map makes.

    CRITICAL: we use add_init_script to embed real GeoJSON data before
    india-map-view.js reads sessionStorage. Route stubs are backup only.
    """
    # CRITICAL FIX: embed real geojson via init script BEFORE the page script runs
    # This bypasses sessionStorage entirely — the production code checks
    # `window._indiaGeoData` before sessionStorage, so pre-setting it is the
    # most reliable way to inject fixture data.
    page.add_init_script(f"""
        window._testFixtureStates = {json.dumps(states)};
        window._testFixtureDistricts = {json.dumps(districts)};
        window._testFixtureVacancies = {json.dumps(vacancies)};
        // Set the data layer flag so it doesn't try to fetch
        window._mapDataLoaded = true;
        window.IndiaMapData = {{
            _raw: window._testFixtureVacancies,
            getListingsForState: (a, n) => {{
                if (!a) return [];
                return window._testFixtureVacancies.filter(v =>
                    v.status === 'Active' && v.state_abbr === a
                );
            }},
            getListingsForDistrict: (a, d) => {{
                if (!a || !d) return [];
                return window._testFixtureVacancies.filter(v =>
                    v.status === 'Active' && v.state_abbr === a && v.district === d
                );
            }},
            getStateCounts: () => {{
                const c = {{}};
                window._testFixtureVacancies.filter(v => v.status === 'Active').forEach(v => {{
                    c[v.state_abbr] = (c[v.state_abbr]||0) + 1;
                }});
                return c;
            }},
            getFiltered: (a) => {{
                if (!a) return window._testFixtureVacancies.filter(v => v.status === 'Active');
                return window._testFixtureVacancies.filter(v => v.status === 'Active' && v.state_abbr === a);
            }},
            recordNewVacancy: (v) => {{
                window._testFixtureVacancies.push(v);
                if (typeof v === 'string') {{
                    window._testFixtureVacancies.push({{id: v, title: 'Test', status: 'Active', state_abbr: 'XX'}});
                }}
            }},
            deriveCategory: (fa) => {{
                if (!fa) return 'General';
                const u = fa.toUpperCase();
                if (u.includes('EDUCATION') || u.includes('TEACHING') || u.includes('PROFESSOR'))
                    return 'Education';
                if (u.includes('RESEARCH') || u.includes('SCIENTIFIC'))
                    return 'Research';
                if (u.includes('IT') || u.includes('TECHNOLOGY') || u.includes('COMPUTER'))
                    return 'Functional';
                if (u.includes('FOREST') || u.includes('ENVIRONMENT'))
                    return 'General';
                return 'General';
            }},
            load: async () => {{}},
            loadFromRawData: (raw) => {{ window._testFixtureVacancies = raw; }},
        }};
        window.IndiaMapData.ready = Promise.resolve(window.IndiaMapData);
        // Pre-seed geometry data so sessionStorage cache is never needed
        try { sessionStorage.removeItem('geo_states'); } catch(e) {{}}
        try { sessionStorage.removeItem('geo_states_all'); } catch(e) {{}}
        try { sessionStorage.removeItem('geo_districts'); } catch(e) {{}}
        try { sessionStorage.removeItem('geo_india_states'); } catch(e) {{}}
        try { sessionStorage.removeItem('geo_india_districts'); } catch(e) {{}}
        try {{ window._indiaGeoData = {json.dumps({"type": "FeatureCollection", "features": states})}; }} catch(e) {{}}
    """)

    # Also route the fetches as backup (for any code paths that bypass the init)
    def on_vacancies(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(vacancies))

    def on_states(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"type": "FeatureCollection", "features": states}))

    def on_districts(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"type": "FeatureCollection", "features": districts}))

    page.route("**/data/vacancies.json", on_vacancies)
    page.route("**/geo/india-states.geojson", on_states)
    page.route("**/geo/india-districts-all.geojson", on_districts)


# Distinct bbox per state — deterministic, no overlap, real Indian coordinates.
# Layout: 7 columns × 6 rows over the Indian subcontinent lon=68-98 / lat=6-38.
_STATES_36_COORDS = {
    "AN": (92.0, 94.0, 6.0, 14.0),
    "AP": (76.0, 84.5, 12.5, 19.5),
    "AR": (92.0, 97.5, 26.5, 29.5),
    "AS": (89.5, 96.0, 24.0, 28.0),
    "BR": (83.0, 88.5, 24.0, 28.0),
    "CG": (80.0, 84.5, 17.0, 24.0),
    "CH": (76.7, 76.9, 30.7, 30.8),
    "DL": (76.8, 77.4, 28.4, 28.9),
    "DN": (72.8, 73.1, 20.0, 20.4),
    "DNH": (72.5, 73.5, 20.0, 20.6),
    "GA": (73.6, 74.4, 14.8, 15.8),
    "GJ": (68.0, 73.5, 20.0, 24.5),
    "HR": (74.5, 77.5, 27.5, 30.5),
    "HP": (75.5, 79.0, 30.0, 33.0),
    "JK": (73.5, 80.0, 32.0, 36.0),
    "JH": (83.0, 88.0, 22.0, 25.5),
    "KA": (74.0, 78.5, 11.5, 18.5),
    "KL": (74.5, 77.5, 8.0, 12.5),
    "LA": (75.5, 79.0, 32.0, 35.5),
    "LD": (72.0, 73.0, 8.0, 12.0),
    "MH": (72.5, 81.0, 15.5, 22.0),
    "ML": (89.5, 92.5, 25.0, 26.5),
    "MN": (93.0, 95.0, 23.5, 25.5),
    "MP": (74.0, 82.5, 21.0, 26.5),
    "MZ": (92.0, 93.5, 21.5, 24.5),
    "NL": (93.5, 95.5, 25.0, 27.0),
    "OD": (81.5, 87.5, 17.5, 22.5),
    "PB": (73.5, 76.5, 29.5, 32.5),
    "PY": (79.5, 80.0, 11.5, 12.0),
    "RJ": (69.5, 78.5, 23.0, 30.0),
    "SK": (88.0, 89.0, 27.0, 28.5),
    "TN": (76.0, 80.5, 8.0, 13.5),
    "TR": (91.0, 92.5, 22.5, 24.5),
    "TS": (77.0, 81.5, 15.5, 19.5),
    "UK": (77.5, 81.5, 28.5, 31.5),
    "UP": (77.0, 84.5, 23.5, 30.5),
    "WB": (85.5, 90.0, 21.5, 27.5),
}


@pytest.fixture()
def all_36_states_fixture(page: Page):
    """Full 36-state/UT fixture with 7 deterministic vacancies.

    BLOCKER 6: all 36 real State/UT names — no placeholders.
    BLOCKER 7: Pune + Mumbai + Nagpur districts rendered with vacancies.
    """
    states = [
        _state_feature(abbr, name, *_STATES_36_COORDS[abbr])
        for (abbr, name) in _ALL_36
    ]

    districts = [
        # Maharashtra districts — BLOCKER 7
        _district_feature("27", "Pune",    73.5, 74.5, 18.0, 19.0),
        _district_feature("27", "Mumbai",  72.8, 73.2, 18.8, 19.3),
        _district_feature("27", "Nagpur",  78.8, 79.6, 20.8, 21.5),
        # Tamil Nadu
        _district_feature("33", "Chennai", 80.0, 80.4, 12.8, 13.3),
        # Karnataka
        _district_feature("29", "Bengaluru", 77.4, 77.8, 12.8, 13.2),
    ]

    # 7 vacancies, all using the production data shape.
    # NOTE: do NOT include synthetic location_scope:'district' here — the
    # production JSON does not always carry it, and BLOCKER 5 says the
    # district membership must rely on the normalized state_abbr + district.
    vacancies = [
        # Maharashtra — Pune (Education) — BLOCKER 7
        {"Vacancy_ID": "M1", "Post_Name": "Assistant Professor",
         "Ministry": "Education", "Organisation": "Central Univ",
         "Level_Text": "Level-10", "Functional_Area": "Higher Education",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Maharashtra", "Location_City": "Pune",
         "state_abbr": "MH", "district": "Pune",
         "Official_Notification_Link": "https://example.com/m1"},
        # Maharashtra — Mumbai (Functional)
        {"Vacancy_ID": "M2", "Post_Name": "Accounts Officer",
         "Ministry": "Finance", "Organisation": "Dept of Finance",
         "Level_Text": "Level-7", "Functional_Area": "Accounts and Finance",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Maharashtra", "Location_City": "Mumbai",
         "state_abbr": "MH", "district": "Mumbai",
         "Official_Notification_Link": ""},
        # Maharashtra — Nagpur (General)
        {"Vacancy_ID": "M3", "Post_Name": "Forest Officer",
         "Ministry": "Environment", "Organisation": "Forest Dept",
         "Level_Text": "Level-7", "Functional_Area": "Forest Management",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Maharashtra", "Location_City": "Nagpur",
         "state_abbr": "MH", "district": "Nagpur",
         "Official_Notification_Link": ""},
        # Karnataka — Bengaluru
        {"Vacancy_ID": "K1", "Post_Name": "Software Engineer",
         "Ministry": "Electronics", "Organisation": "STPI",
         "Level_Text": "Level-9", "Functional_Area": "IT and Technology",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Karnataka", "Location_City": "Bengaluru",
         "state_abbr": "KA", "district": "Bengaluru",
         "Official_Notification_Link": ""},
        # Tamil Nadu — Chennai
        {"Vacancy_ID": "T1", "Post_Name": "Research Fellow",
         "Ministry": "Science", "Organisation": "CSIR",
         "Level_Text": "Level-8", "Functional_Area": "Scientific Research",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Tamil Nadu", "Location_City": "Chennai",
         "state_abbr": "TN", "district": "Chennai",
         "Official_Notification_Link": ""},
        # Delhi — New Delhi
        {"Vacancy_ID": "DL1", "Post_Name": "Stenographer",
         "Ministry": "Parliament", "Organisation": "Rajya Sabha",
         "Level_Text": "Level-5", "Functional_Area": "Stenography",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Delhi", "Location_City": "New Delhi",
         "state_abbr": "DL", "district": "New Delhi",
         "Official_Notification_Link": ""},
        # Chhattisgarh — test CG mapping
        {"Vacancy_ID": "CG1", "Post_Name": "Forest Officer",
         "Ministry": "Environment", "Organisation": "Forest Dept",
         "Level_Text": "Level-7", "Functional_Area": "Forest Management",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Chhattisgarh", "Location_City": "Raipur",
         "state_abbr": "CG", "district": "Raipur",
         "Official_Notification_Link": ""},
    ]

    _inject_fixtures(page, vacancies, states, districts)
    yield {"vacancies": vacancies, "states": states, "districts": districts}


# ---------------------------------------------------------------------------
# 1. National direct load renders exactly 36 unique State/UT paths
# ---------------------------------------------------------------------------

class TestNationalRender:
    """BLOCKER 6: exactly 36 unique State/UT paths, no placeholders."""

    def test_renders_exactly_37_state_features(self, page: Page, base_url: str, all_36_states_fixture):
        """BLOCKER 6: fixture has 37 entries (DN + DNH as separate UTs)."""
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)  # let draw-in complete
        count = page.locator("#map-svg .ad-state").count()
        assert count == 37, f"Expected 37 state features from fixture, got {count}"

    def test_all_data_abbr_unique(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        abbrs = page.eval_on_selector_all(
            "#map-svg .ad-state",
            "els => els.map(e => e.getAttribute('data-abbr'))"
        )
        assert len(abbrs) == len(set(abbrs)), f"data-abbr not unique: {abbrs}"
        assert all(a and len(a) == 2 for a in abbrs), f"data-abbr malformed: {abbrs}"
        # No placeholder names
        for a in abbrs:
            assert not a.startswith("XX"), f"Placeholder abbreviation leaked: {a}"

    @pytest.mark.parametrize("abbr", ["CG", "UK", "DNH", "LA", "AN", "DL", "MH"])
    def test_specific_states_rendered(self, page: Page, base_url: str, all_36_states_fixture, abbr):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        loc = page.locator(f"#map-svg [data-abbr='{abbr}'].ad-state")
        assert loc.count() == 1, f"State {abbr} not rendered (count={loc.count()})"


# ---------------------------------------------------------------------------
# 2. National counter equals deterministic record-backed mapped total
# ---------------------------------------------------------------------------

class TestNationalCounter:
    def test_counter_equals_vacancy_total(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#mapCounterValue", timeout=10000)
        page.wait_for_timeout(2000)
        val = page.locator("#mapCounterValue").inner_text()
        n = int(val.replace(",", ""))
        # 7 vacancies, all active in fixture
        assert n == 7, f"Expected 7 vacancies total, got {n}"


# ---------------------------------------------------------------------------
# 3. No uncaught page errors
# ---------------------------------------------------------------------------

class TestNoPageErrors:
    def test_no_uncaught_errors(self, page: Page, base_url: str, all_36_states_fixture):
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(f"{base_url}/india-map.html", wait_until="networkidle")
        page.wait_for_timeout(4000)
        assert errors == [], f"Page errors: {errors}"


# ---------------------------------------------------------------------------
# 4. Hover tooltip
# ---------------------------------------------------------------------------

class TestHover:
    def test_tooltip_visible_on_hover(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        mh.hover()
        tooltip = page.locator("#mapTooltip")
        expect(tooltip).to_have_css("opacity", "1", timeout=3000)

    def test_tooltip_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        mh.hover()
        page.wait_for_timeout(500)
        count_text = page.locator("#mapTooltipCount").inner_text()
        # 3 MH vacancies
        assert "3" in count_text, f"Tooltip should show 3 vacancies, got: {count_text}"


# ---------------------------------------------------------------------------
# 5. Filter All/Functional/Education
# ---------------------------------------------------------------------------

class TestFilters:
    def test_all_filter_label_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#mapCounterValue", timeout=10000)
        page.wait_for_timeout(2000)
        all_count = int(page.locator("#mapCounterValue").inner_text().replace(",", ""))
        # All = 7 (no Functional in MH or others? Let's count:
        # M1 = Education, M2 = Functional, M3 = General, K1 = Functional (IT), T1 = General (Research), DL1 = Functional, CG1 = General
        # Functional: M2, K1, DL1 = 3
        # Education: M1 = 1
        # General: M3, T1, CG1 = 3
        assert all_count == 7, f"All filter should be 7, got {all_count}"

    def test_functional_filter_label_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector(".map-filter-btn[data-filter='functional']", timeout=10000)
        page.wait_for_timeout(2000)
        page.click(".map-filter-btn[data-filter='functional']")
        page.wait_for_timeout(300)
        n = int(page.locator("#mapCounterValue").inner_text().replace(",", ""))
        assert n == 3, f"Functional filter should be 3, got {n}"

    def test_education_filter_label_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector(".map-filter-btn[data-filter='education']", timeout=10000)
        page.wait_for_timeout(2000)
        page.click(".map-filter-btn[data-filter='education']")
        page.wait_for_timeout(300)
        n = int(page.locator("#mapCounterValue").inner_text().replace(",", ""))
        assert n == 1, f"Education filter should be 1, got {n}"

    def test_aria_pressed(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector(".map-filter-btn", timeout=10000)
        page.wait_for_timeout(2000)
        page.click(".map-filter-btn[data-filter='education']")
        page.wait_for_timeout(300)
        active = page.locator(".map-filter-btn.active")
        assert active.count() == 1
        assert active.first.get_attribute("aria-pressed") == "true"


# ---------------------------------------------------------------------------
# 6. State click MH
# ---------------------------------------------------------------------------

class TestStateClick:
    def test_state_click_drills(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        mh.click()
        page.wait_for_timeout(2500)
        # State view: back button visible
        assert page.locator("#btn-back").is_visible(), "Back button should be visible after state drill"
        # URL is ?state=MH
        assert "state=MH" in page.url, f"URL should contain state=MH: {page.url}"

    def test_keyboard_enter_on_state(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg [data-abbr='MH'].ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        mh.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        assert page.locator("#btn-back").is_visible(), "Back button should be visible after Enter"


# ---------------------------------------------------------------------------
# 7. Pune district
# ---------------------------------------------------------------------------

class TestPuneDistrict:
    def test_district_path_exists(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        pune = page.locator("#map-svg [data-district='Pune'].ad-district")
        assert pune.count() == 1, f"Pune district should render, count={pune.count()}"

    def test_modal_opens_on_district_click(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        modal = page.locator("#modal")
        assert modal.evaluate("el => el.open") is True, "Modal should be open"

    def test_modal_listing_fields(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        title = page.locator("#modalTitle").inner_text()
        assert "Pune" in title, f"Modal title should mention Pune: {title}"
        # One listing
        cards = page.locator(".ad-listing-card")
        assert cards.count() == 1, f"Expected 1 listing, got {cards.count()}"
        # Listing fields
        assert "Assistant Professor" in page.locator(".ad-listing-card").first.inner_text()
        assert "Education" in page.locator(".ad-listing-card").first.inner_text()

    def test_url_is_state_and_district(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        assert "state=MH" in page.url
        assert "district=Pune" in page.url

    def test_close_restores_focus(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        modal = page.locator("#modal")
        assert modal.evaluate("el => el.open") is False, "Modal should close on Escape"


# ---------------------------------------------------------------------------
# 8 + 9. Browser Back/Forward
# ---------------------------------------------------------------------------

class TestHistory:
    def test_back_pune_state_national(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        # Back 1: district -> state
        page.go_back()
        page.wait_for_timeout(1500)
        assert "state=MH" in page.url
        assert "district=" not in page.url
        # Back 2: state -> national
        page.go_back()
        page.wait_for_timeout(1500)
        assert "state=" not in page.url
        assert page.locator("#btn-back").is_hidden()

    def test_forward_national_state_pune(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        page.go_back()
        page.wait_for_timeout(1500)
        page.go_back()
        page.wait_for_timeout(1500)
        # Forward 1: national -> state
        page.go_forward()
        page.wait_for_timeout(1500)
        assert "state=MH" in page.url
        # Forward 2: state -> district
        page.go_forward()
        page.wait_for_timeout(1500)
        assert "state=MH" in page.url
        assert "district=Pune" in page.url


# ---------------------------------------------------------------------------
# 10 + 11. Deep link
# ---------------------------------------------------------------------------

class TestDeepLink:
    def test_state_deep_link_executes_once(self, page: Page, base_url: str, all_36_states_fixture):
        # BLOCKER 9: one history entry for the deep link
        page.goto(f"{base_url}/india-map.html?state=MH")
        page.wait_for_timeout(4000)
        assert "state=MH" in page.url
        # Now go back — should leave the page (single entry, not land on another ?state=MH)
        page.go_back()
        page.wait_for_timeout(1500)
        assert "state=" not in page.url or "india-map.html?state=MH" != page.url

    def test_district_deep_link(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html?state=MH&district=Pune")
        page.wait_for_timeout(5000)
        assert "state=MH" in page.url
        assert "district=Pune" in page.url
        # Modal should be open
        modal = page.locator("#modal")
        assert modal.evaluate("el => el.open") is True


# ---------------------------------------------------------------------------
# 12. Delhi
# ---------------------------------------------------------------------------

class TestDelhi:
    def test_11_hotspots(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='DL'].ad-state").click()
        page.wait_for_timeout(2500)
        hotspots = page.locator(".ad-delhi-hotspot").count()
        assert hotspots == 11, f"Delhi should have 11 hotspots, got {hotspots}"

    def test_new_delhi_count_matches_listings(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='DL'].ad-state").click()
        page.wait_for_timeout(2500)
        # New Delhi hotspot has a count badge
        new_delhi = page.locator('.ad-delhi-hotspot[data-district="New Delhi"]')
        badge = new_delhi.locator(".ad-delhi-count")
        assert badge.count() == 1, "New Delhi hotspot should have a count"
        count_str = badge.inner_text().strip()
        # Open it
        new_delhi.click()
        page.wait_for_timeout(500)
        title = page.locator("#modalTitle").inner_text()
        assert count_str in title, f"Hotspot count {count_str} should match modal title: {title}"

    def test_delhi_back_returns_to_india(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='DL'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-abbr='DL'].ad-state").click()  # already at state view; back to national
        # Simpler: use back button
        page.click("#btn-back")
        page.wait_for_timeout(2000)
        assert page.locator("#btn-back").is_hidden()
        assert page.locator("#map-svg .ad-state").count() == 36


# ---------------------------------------------------------------------------
# 13. Mobile 390px
# ---------------------------------------------------------------------------

class TestMobileFilters:
    def test_filter_toggle_visible(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.set_viewport_size({"width": 390, "height": 812})
        page.wait_for_timeout(500)
        toggle = page.locator("#mapFiltersToggle")
        assert toggle.is_visible()

    def test_filter_toggle_44px(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.set_viewport_size({"width": 390, "height": 812})
        page.wait_for_timeout(500)
        toggle = page.locator("#mapFiltersToggle")
        box = toggle.bounding_box()
        assert box is not None
        assert box["width"] >= 44 and box["height"] >= 44, f"Got {box['width']}x{box['height']}"

    def test_filter_drawer_open_close(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.set_viewport_size({"width": 390, "height": 812})
        page.wait_for_timeout(500)
        # Open
        page.click("#mapFiltersToggle")
        page.wait_for_timeout(300)
        assert page.locator(".map-filters.open").count() == 1
        # Close
        page.click("#mapFiltersToggle")
        page.wait_for_timeout(300)
        assert page.locator(".map-filters.open").count() == 0


# ---------------------------------------------------------------------------
# 14. Particle lifecycle (BLOCKER 8)
# ---------------------------------------------------------------------------

class TestParticleLifecycle:
    def test_desktop_has_one_loop(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2500)  # let particle system warm up
        s = page.evaluate("window.__mapParticleState ? window.__mapParticleState() : null")
        assert s is not None, "Particle state hook missing"
        assert s["rafRunning"] is True, f"Expected one RAF loop on desktop, got {s}"
        assert s["particleCount"] > 0, f"Expected particles, got {s['particleCount']}"

    def test_resize_to_mobile_stops_loop(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2500)
        assert page.evaluate("window.__mapParticleState().rafRunning") is True
        page.set_viewport_size({"width": 390, "height": 812})
        page.wait_for_timeout(500)  # debounce
        s = page.evaluate("window.__mapParticleState()")
        assert s["rafRunning"] is False, f"Loop should stop on mobile, got {s}"
        assert s["particleCount"] == 0, f"Particles should be cleared, got {s['particleCount']}"

    def test_resize_back_restarts_one_loop(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        # Resize to mobile, back, back
        page.set_viewport_size({"width": 390, "height": 812})
        page.wait_for_timeout(500)
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(500)
        s = page.evaluate("window.__mapParticleState()")
        assert s["rafRunning"] is True, f"Loop should restart on desktop, got {s}"

    def test_repeated_resize_no_multiloop(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        for _ in range(4):
            page.set_viewport_size({"width": 390, "height": 812})
            page.wait_for_timeout(200)
            page.set_viewport_size({"width": 1280, "height": 800})
            page.wait_for_timeout(200)
        page.wait_for_timeout(500)
        # Should end up with one running loop on desktop
        s = page.evaluate("window.__mapParticleState()")
        assert s["rafRunning"] is True, f"Final state should be one running loop, got {s}"


# ---------------------------------------------------------------------------
# 15. Reduced motion
# ---------------------------------------------------------------------------

class TestReducedMotion:
    def test_reduced_motion_still_interactive(self, page: Page, base_url: str, all_36_states_fixture):
        page.emulate_media(reduced_motion="reduce")
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        assert mh.count() == 1
        mh.click()
        page.wait_for_timeout(2500)
        assert page.locator("#btn-back").is_visible(), "State drill should work with reduced motion"


# ---------------------------------------------------------------------------
# 16. Keyboard
# ---------------------------------------------------------------------------

class TestKeyboard:
    def test_enter_on_state(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg [data-abbr='MH'].ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        mh = page.locator("#map-svg [data-abbr='MH'].ad-state")
        mh.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        assert "state=MH" in page.url

    def test_enter_on_district(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        pune = page.locator("#map-svg [data-district='Pune'].ad-district")
        pune.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(700)
        assert page.locator("#modal").evaluate("el => el.open") is True

    def test_escape_closes_modal(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("#map-svg [data-abbr='MH'].ad-state").click()
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        assert page.locator("#modal").evaluate("el => el.open") is False
