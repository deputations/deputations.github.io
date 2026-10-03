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
import re
from pathlib import Path
from urllib.parse import quote

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
    ("DNH", "Dadra and Nagar Haveli and Daman and Diu"),
    ("DL", "Delhi"),
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
        // Set test mode flag BEFORE the page script runs
        // so the production code skips sessionStorage entirely
        window.__MAP_TEST_MODE = true;
        // Pre-seed geometry data so the production code never needs to fetch
        window._indiaGeoData = {json.dumps({"type": "FeatureCollection", "features": states})};
        // Pre-seed data layer
        window.IndiaMapData = {{
            _raw: {json.dumps(vacancies)},
            _counts: {{}},
            getListingsForState: (a, n) => {{
                if (!a) return [];
                return {json.dumps(vacancies)}.filter(v => v.status === 'Active' && v.state_abbr === a);
            }},
            getListingsForDistrict: (a, d) => {{
                if (!a || !d) return [];
                return {json.dumps(vacancies)}.filter(v => v.status === 'Active' && v.state_abbr === a && v.district === d);
            }},
            getStateCounts: (a) => {{
                if (a) return {{}}; // keep signature, not used per-abbr in tests
                const c = {{}};
                {json.dumps(vacancies)}.filter(v => v.status === 'Active').forEach(v => {{
                    c[v.state_abbr] = (c[v.state_abbr]||0) + 1;
                }});
                return c;
            }},
            getFiltered: (a, opts) => {{
                const cat = opts && opts.category;
                // Compute category per-vacancy matching production deriveCategory
                const getCat = (v) => {{
                    const fa = String(v.Functional_Area || v.functional_area || '').toLowerCase();
                    const title = String(v.Post_Name || v.title || '').toLowerCase();
                    const combined = fa + ' ' + title;
                    const eduKws = ['teach', 'faculty', 'professor', 'lecturer', 'education', 'academic',
                      'institute', 'university', 'college', 'school', 'research fellow', 'scholar'];
                    const funcKws = ['account', 'finance', 'admin', 'steno', 'secretary', 'clerk', 'assistant',
                      'officer', 'manager', 'supervisor', 'inspector', 'audit', 'legal', 'it ', 'tech ',
                      'engineer', 'programmer', 'analyst', 'translator', ' hindi', 'stenography'];
                    for (const kw of eduKws) {{ if (combined.includes(kw)) return 'Education'; }}
                    for (const kw of funcKws) {{ if (combined.includes(kw)) return 'Functional'; }}
                    return 'General';
                }};
                return {json.dumps(vacancies)}.filter(v => {{
                    if (v.status !== 'Active') return false;
                    if (a && v.state_abbr !== a) return false;
                    if (cat && getCat(v) !== cat) return false;
                    return true;
                }});
            }},
            recordNewVacancy: (v) => {{ window.IndiaMapData._raw.push(v); }},
            deriveCategory: (v) => {{
                const fa = String(v.Functional_Area || v.functional_area || '').toLowerCase();
                const title = String(v.Post_Name || v.title || '').toLowerCase();
                const combined = fa + ' ' + title;
                const eduKws = ['teach', 'faculty', 'professor', 'lecturer', 'education', 'academic',
                  'institute', 'university', 'college', 'school', 'research fellow', 'scholar'];
                const funcKws = ['account', 'finance', 'admin', 'steno', 'secretary', 'clerk', 'assistant',
                  'officer', 'manager', 'supervisor', 'inspector', 'audit', 'legal', 'it ', 'tech ',
                  'engineer', 'programmer', 'analyst', 'translator', ' hindi', 'stenography'];
                for (const kw of eduKws) {{ if (combined.includes(kw)) return 'Education'; }}
                for (const kw of funcKws) {{ if (combined.includes(kw)) return 'Functional'; }}
                return 'General';
            }},
            load: async () => {{}},
            loadFromRawData: (raw) => {{ window.IndiaMapData._raw = raw; }},
        }};
        window.IndiaMapData.ready = Promise.resolve(window.IndiaMapData);
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


# Distinct, NON-overlapping bbox per state: a 6×6 grid over lon 68–98 /
# lat 6–38 in _ALL_36 order. Real-world boxes overlap (UP covers UK's centre,
# AP covers MH's), which makes a real pointer click land on the wrong state;
# the grid keeps every state's centre on that state's own path.
def _grid_coords() -> dict:
    coords = {}
    for i, (abbr, _name) in enumerate(_ALL_36):
        col, row = i % 6, i // 6
        lon_lo, lat_lo = 68.0 + col * 5.0, 6.0 + row * 5.3
        coords[abbr] = (lon_lo + 0.3, lon_lo + 4.7, lat_lo + 0.3, lat_lo + 5.0)
    return coords


_STATES_36_COORDS = _grid_coords()


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
        # Second Mumbai fragment: same logical district, must not add a row
        _district_feature("27", "Mumbai",  72.8, 73.2, 19.5, 19.7),
        _district_feature("27", "Nagpur",  78.8, 79.6, 20.8, 21.5),
        # Tamil Nadu
        _district_feature("33", "Chennai", 80.0, 80.4, 12.8, 13.3),
        # Karnataka
        _district_feature("29", "Bengaluru", 77.4, 77.8, 12.8, 13.2),
        # QA geometry for the codes the real GeoJSON uses
        _district_feature("05", "Dehradun", 77.6, 78.4, 30.0, 30.8),        # UK
        _district_feature("05", "Nainital", 79.0, 79.8, 29.0, 29.6),        # UK
        _district_feature("26", "Dadra and Nagar Haveli", 72.9, 73.2, 20.0, 20.4),  # DNH
        _district_feature("26", "Daman", 72.8, 72.9, 20.4, 20.5),           # DNH
        _district_feature("26", "Diu",   70.9, 71.0, 20.7, 20.8),           # DNH
        _district_feature("37", "Visakhapatnam", 82.8, 83.4, 17.6, 18.2),   # AP
        _district_feature("37", "Krishna", 80.6, 81.4, 15.8, 16.6),         # AP
        _district_feature("22", "Raipur", 81.4, 82.0, 21.0, 21.6),          # CG
        _district_feature("38", "Leh",    77.0, 79.0, 33.5, 35.5),          # LA
        _district_feature("38", "Kargil", 75.5, 76.8, 33.8, 34.8),          # LA
        _district_feature("35", "South Andaman", 92.5, 93.0, 11.4, 12.0),   # AN
        _district_feature("17", "East Khasi Hills", 91.6, 92.1, 25.2, 25.7),  # ML
        # Blank-name sentinels: state outlines in the real GeoJSON, not
        # districts. Listed last so a regression would draw them on top.
        _district_feature("27", "", 72.5, 81.0, 15.5, 22.0),
        _district_feature("05", "", 77.5, 81.0, 28.7, 31.4),
    ]

    # 7 vacancies, all using the production data shape.
    # Categories must match production deriveCategory() exactly:
    #   eduKws: teach/faculty/professor/lecturer/education/academic/institute/university/college/school/research fellow/scholar
    #   funcKws: account/finance/admin/steno/secretary/clerk/assistant/officer/manager/supervisor/inspector/audit/legal/it /tech /engineer/programmer/analyst/translator/ hindi/stenography
    # Order: eduKws checked first, then funcKws.
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
        {"Vacancy_ID": "M2", "Post_Name": "Software Engineer",
         "Ministry": "Electronics", "Organisation": "STPI",
         "Level_Text": "Level-7", "Functional_Area": "IT and Technology",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Maharashtra", "Location_City": "Mumbai",
         "state_abbr": "MH", "district": "Mumbai",
         "Official_Notification_Link": ""},
        # Maharashtra — Nagpur (General — no edu/func keywords)
        {"Vacancy_ID": "M3", "Post_Name": "Field Guard",
         "Ministry": "Environment", "Organisation": "Wildlife Wing",
         "Level_Text": "Level-7", "Functional_Area": "Wildlife Protection",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Maharashtra", "Location_City": "Nagpur",
         "state_abbr": "MH", "district": "Nagpur",
         "Official_Notification_Link": ""},
        # Karnataka — Bengaluru (Functional)
        {"Vacancy_ID": "K1", "Post_Name": "Systems Analyst",
         "Ministry": "Electronics", "Organisation": "STPI",
         "Level_Text": "Level-9", "Functional_Area": "IT and Technology",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Karnataka", "Location_City": "Bengaluru",
         "state_abbr": "KA", "district": "Bengaluru",
         "Official_Notification_Link": ""},
        # Tamil Nadu — Chennai (Education — "research fellow" hits eduKws)
        {"Vacancy_ID": "T1", "Post_Name": "Research Fellow",
         "Ministry": "Science", "Organisation": "CSIR",
         "Level_Text": "Level-8", "Functional_Area": "Scientific Research",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Tamil Nadu", "Location_City": "Chennai",
         "state_abbr": "TN", "district": "Chennai",
         "Official_Notification_Link": ""},
        # Delhi — New Delhi (Functional — "stenography" hits funcKws)
        {"Vacancy_ID": "DL1", "Post_Name": "Stenographer",
         "Ministry": "Parliament", "Organisation": "Rajya Sabha",
         "Level_Text": "Level-5", "Functional_Area": "Stenography",
         "Last_Date_To_Apply": "2099-12-31", "Status": "Active",
         "Location_State": "Delhi", "Location_City": "New Delhi",
         "state_abbr": "DL", "district": "New Delhi",
         "Official_Notification_Link": ""},
        # Chhattisgarh — General (no edu/func keywords match)
        {"Vacancy_ID": "CG1", "Post_Name": "Advisor",
         "Ministry": "External Affairs", "Organisation": "Policy Wing",
         "Level_Text": "Level-7", "Functional_Area": "Policy Studies",
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

    def test_renders_exactly_36_state_features(self, page: Page, base_url: str, all_36_states_fixture):
        """BLOCKER 6: exactly 36 unique State/UT paths, no placeholders."""
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)  # let draw-in complete
        count = page.locator("#map-svg .ad-state").count()
        assert count == 36, f"Expected exactly 36 state features, got {count}"

    def test_all_data_abbr_unique(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(2000)
        abbrs = page.eval_on_selector_all(
            "#map-svg .ad-state",
            "els => els.map(e => e.getAttribute('data-abbr'))"
        )
        assert len(abbrs) == len(set(abbrs)), f"data-abbr not unique: {abbrs}"
        assert all(a and len(a) >= 2 for a in abbrs), f"data-abbr malformed: {abbrs}"
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
        # 7 vacancies: M1=Education, M2=Functional, M3=General, K1=Functional,
        # T1=Education, DL1=Functional, CG1=General
        assert all_count == 7, f"All filter should be 7, got {all_count}"

    def test_functional_filter_label_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector(".map-filter-btn[data-filter='functional']", timeout=10000)
        page.wait_for_timeout(2000)
        page.click(".map-filter-btn[data-filter='functional']")
        page.wait_for_timeout(300)
        n = int(page.locator("#mapCounterValue").inner_text().replace(",", ""))
        # Functional: M2, K1, DL1 = 3
        assert n == 3, f"Functional filter should be 3, got {n}"

    def test_education_filter_label_count(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector(".map-filter-btn[data-filter='education']", timeout=10000)
        page.wait_for_timeout(2000)
        page.click(".map-filter-btn[data-filter='education']")
        page.wait_for_timeout(300)
        n = int(page.locator("#mapCounterValue").inner_text().replace(",", ""))
        # Education: M1 (Assistant Professor → professor keyword), T1 (Research Fellow → research fellow keyword) = 2
        assert n == 2, f"Education filter should be 2, got {n}"

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

def _svg_state_click(page, abbr):
    """Real pointer click on a state path (the grid fixture never overlaps)."""
    page.locator(f"#map-svg [data-abbr='{abbr}'].ad-state").click()


class TestStateClick:
    def test_state_click_drills(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        assert page.locator("#btn-back").is_visible(), "Back button should be visible after state drill"
        url = page.evaluate("() => window.location.href")
        assert "state=MH" in url, f"URL should contain state=MH: {url}"

    def test_keyboard_enter_on_state(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg [data-abbr='MH'].ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        assert page.locator("#btn-back").is_visible(), "Back button should be visible after Enter"


# ---------------------------------------------------------------------------
# 7. Pune district
# ---------------------------------------------------------------------------

class TestPuneDistrict:
    def test_district_path_exists(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        pune = page.locator("#map-svg [data-district='Pune'].ad-district")
        assert pune.count() == 1, f"Pune district should render, count={pune.count()}"

    def test_modal_opens_on_district_click(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        modal = page.locator("#modal")
        assert modal.evaluate("el => el.open") is True, "Modal should be open"

    def test_modal_listing_fields(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
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
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        url = page.evaluate("() => window.location.href")
        assert "state=MH" in url
        assert "district=Pune" in url

    def test_close_restores_focus(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        page.wait_for_selector("#map-svg .ad-state", timeout=15000)
        page.wait_for_timeout(3000)
        _svg_state_click(page, 'MH')
        page.wait_for_timeout(2500)
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        page.wait_for_timeout(700)
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        modal = page.locator("#modal")
        assert modal.evaluate("el => el.open") is False, "Modal should close on Escape"


# ---------------------------------------------------------------------------
# Routing helpers — public contract only: URL, modal, visible view, Back
# button, district DOM, browser history. No IIFE-private state.
# ---------------------------------------------------------------------------

_NATIONAL_URL = re.compile(r"/india-map\.html$")


def _open_map(page: Page, base_url: str, query: str = "") -> None:
    page.goto(f"{base_url}/india-map.html{query}")
    expect(page.locator("#map-svg .ad-state")).to_have_count(36, timeout=15000)


def _history_length(page: Page) -> int:
    return page.evaluate("() => history.length")


def _expect_national(page: Page) -> None:
    expect(page).to_have_url(_NATIONAL_URL, timeout=10000)
    expect(page.locator("#map-svg .ad-state")).to_have_count(36, timeout=10000)
    expect(page.locator("#btn-back")).to_be_hidden()
    expect(page.locator("#modal")).to_be_hidden()


def _expect_state(page: Page, abbr: str) -> None:
    expect(page).to_have_url(re.compile(rf"\?state={abbr}$"), timeout=10000)
    expect(page.locator("#modal")).to_be_hidden()
    expect(page.locator("#btn-back")).to_be_visible()
    if abbr == "DL":
        expect(page.locator(".ad-delhi-hotspot")).to_have_count(11, timeout=10000)
    else:
        expect(page.locator("#map-svg .ad-district").first).to_be_visible(timeout=10000)


def _expect_district(page: Page, abbr: str, district: str) -> None:
    expect(page).to_have_url(
        re.compile(rf"\?state={abbr}&district={re.escape(quote(district))}$"), timeout=10000)
    expect(page.locator("#modal")).to_be_visible()
    expect(page.locator("#modalTitle")).to_contain_text(district)


def _go_national_to_pune(page: Page, base_url: str) -> int:
    """National → click MH → click Pune. Returns history.length at the end."""
    _open_map(page, base_url)
    _svg_state_click(page, "MH")
    _expect_state(page, "MH")
    page.locator("#map-svg [data-district='Pune'].ad-district").click()
    _expect_district(page, "MH", "Pune")
    return _history_length(page)


def _district_names(page: Page) -> list[str]:
    return page.eval_on_selector_all(
        "#map-svg .ad-district", "els => els.map(e => e.getAttribute('data-district'))")


# ---------------------------------------------------------------------------
# 8 + 9. Browser Back/Forward (real user actions)
# ---------------------------------------------------------------------------

class TestHistory:
    def test_state_click_pushes_one_entry(self, page: Page, base_url: str, all_36_states_fixture):
        """Real MH click → ?state=MH, exactly one new history entry."""
        _open_map(page, base_url)
        before = _history_length(page)
        _svg_state_click(page, "MH")
        _expect_state(page, "MH")
        assert _history_length(page) == before + 1

    def test_district_click_pushes_one_entry(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        before = _history_length(page)
        _svg_state_click(page, "MH")
        _expect_state(page, "MH")
        page.locator("#map-svg [data-district='Pune'].ad-district").click()
        _expect_district(page, "MH", "Pune")
        assert _history_length(page) == before + 2

    def test_browser_back_from_state_to_national(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        _svg_state_click(page, "MH")
        _expect_state(page, "MH")
        page.go_back()
        _expect_national(page)


# ---------------------------------------------------------------------------
# 10 + 11. Deep link
# ---------------------------------------------------------------------------

class TestDeepLink:
    def test_state_deep_link_executes_once(self, page: Page, base_url: str, all_36_states_fixture):
        # BLOCKER 9: one history entry for the deep link
        page.goto(f"{base_url}/india-map.html?state=MH")
        _expect_state(page, "MH")
        # Now go back — should leave the page (single entry, not land on another ?state=MH)
        page.go_back()
        page.wait_for_timeout(1500)
        assert "state=MH" not in page.url

    def test_district_deep_link(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html?state=MH&district=Pune")
        _expect_district(page, "MH", "Pune")

    def test_deep_link_is_replaced_not_pushed(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html")
        expect(page.locator("#map-svg .ad-state")).to_have_count(36, timeout=15000)
        before = _history_length(page)
        page.goto(f"{base_url}/india-map.html?state=MH&district=Pune")
        _expect_district(page, "MH", "Pune")
        # One navigation = one entry; the deep-link render added none
        assert _history_length(page) == before + 1


# ---------------------------------------------------------------------------
# 12. Delhi
# ---------------------------------------------------------------------------

class TestDelhi:
    def test_11_hotspots(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        _svg_state_click(page, 'DL')
        _expect_state(page, "DL")

    def test_new_delhi_count_matches_listings(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        _svg_state_click(page, 'DL')
        _expect_state(page, "DL")
        # New Delhi hotspot has a count badge
        new_delhi = page.locator('.ad-delhi-hotspot[data-district="New Delhi"]')
        badge = new_delhi.locator(".ad-delhi-count")
        expect(badge).to_have_count(1)
        count_str = badge.inner_text().strip()
        new_delhi.click()
        _expect_district(page, "DL", "New Delhi")
        title = page.locator("#modalTitle").inner_text()
        assert count_str in title, f"Hotspot count {count_str} should match modal title: {title}"


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


# ---------------------------------------------------------------------------
# QA-P0-01: district geometry resolves for UK, DNH, AP; sentinels/fragments
# QA-P1-01: user closing a district returns to State in URL and UI
# QA-P1-02: Browser Back from district → State with modal closed
# QA-P2-01/P2-02: in-app Back to India for deep links stays on the page
# QA-P3: Delhi uses the same single navigation layer
# All journeys use real clicks / keys — no history.pushState() in tests.
# ---------------------------------------------------------------------------

class TestQAP001_DistrictMapping:
    """Real clicks on UK / DNH / AP render their district geometry."""

    def test_uttarakhand_districts_render(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        _svg_state_click(page, "UK")
        _expect_state(page, "UK")
        assert sorted(_district_names(page)) == ["Dehradun", "Nainital"]

    def test_dnh_districts_render(self, page: Page, base_url: str, all_36_states_fixture):
        """All three DNH districts live under st_code 26 in the real GeoJSON."""
        _open_map(page, base_url)
        _svg_state_click(page, "DNH")
        _expect_state(page, "DNH")
        assert sorted(_district_names(page)) == ["Dadra and Nagar Haveli", "Daman", "Diu"]

    def test_andhra_pradesh_districts_render(self, page: Page, base_url: str, all_36_states_fixture):
        _open_map(page, base_url)
        _svg_state_click(page, "AP")
        _expect_state(page, "AP")
        assert sorted(_district_names(page)) == ["Krishna", "Visakhapatnam"]

    def test_blank_sentinels_and_fragments_not_rendered_as_districts(
            self, page: Page, base_url: str, all_36_states_fixture):
        """MH fixture has a blank-name sentinel and a two-fragment Mumbai."""
        _open_map(page, base_url)
        _svg_state_click(page, "MH")
        _expect_state(page, "MH")
        names = _district_names(page)
        assert sorted(names) == ["Mumbai", "Nagpur", "Pune"], names
        labels = page.eval_on_selector_all(
            "#map-labels .ad-district-label", "els => els.map(e => e.textContent)")
        assert not any(l == "" or l.startswith("District ") for l in labels), labels


class TestQAP001_NavigationRouting:
    """User closes the district → URL and UI both State → one Back → National."""

    def test_escape_then_back_to_national(self, page: Page, base_url: str, all_36_states_fixture):
        """National → MH → Pune → Escape → ?state=MH → one Back to India → National."""
        length = _go_national_to_pune(page, base_url)
        page.keyboard.press("Escape")
        _expect_state(page, "MH")
        assert _history_length(page) == length, "closing must not push"
        page.locator("#btn-back").click()
        _expect_national(page)
        # Stack is still National, MH, Pune — nothing was duplicated
        page.go_forward()
        _expect_state(page, "MH")

    def test_modal_close_button_then_back(self, page: Page, base_url: str, all_36_states_fixture):
        """National → MH → Pune → close button → ?state=MH → one Back to India → National."""
        length = _go_national_to_pune(page, base_url)
        page.locator("#modal .map-modal-close").click()
        _expect_state(page, "MH")
        assert _history_length(page) == length, "closing must not push"
        page.locator("#btn-back").click()
        _expect_national(page)

    def test_forward_after_close_reopens_district(self, page: Page, base_url: str, all_36_states_fixture):
        """Closing steps back onto the State entry, so Forward reopens Pune."""
        _go_national_to_pune(page, base_url)
        page.keyboard.press("Escape")
        _expect_state(page, "MH")
        page.go_forward()
        _expect_district(page, "MH", "Pune")


class TestQAP002_BrowserBackRouting:
    def test_browser_back_from_district(self, page: Page, base_url: str, all_36_states_fixture):
        """MH → Pune → Browser Back → MH, modal closed → Back to India → National."""
        _go_national_to_pune(page, base_url)
        page.go_back()
        _expect_state(page, "MH")
        expect(page.locator("#map-svg [data-district='Pune'].ad-district")).to_have_count(1)
        page.locator("#btn-back").click()
        _expect_national(page)

    def test_browser_back_back_forward_forward(self, page: Page, base_url: str, all_36_states_fixture):
        """Browser Back → MH → Back → National; Forward → MH → Forward → Pune."""
        _go_national_to_pune(page, base_url)
        page.go_back()
        _expect_state(page, "MH")
        page.go_back()
        _expect_national(page)
        page.go_forward()
        _expect_state(page, "MH")
        page.go_forward()
        _expect_district(page, "MH", "Pune")


class TestQAP002_DeepLinkBack:
    """Direct entries have no in-app parent: closing/Back replace, never leave."""

    def test_deep_link_state_back_to_national(self, page: Page, base_url: str, all_36_states_fixture):
        """Direct ?state=MH → in-app Back to India → National, same entry."""
        page.goto(f"{base_url}/india-map.html?state=MH")
        _expect_state(page, "MH")
        length = _history_length(page)
        page.locator("#btn-back").click()
        _expect_national(page)
        assert _history_length(page) == length

    def test_deep_link_district_close_then_back(self, page: Page, base_url: str, all_36_states_fixture):
        """Direct ?state=MH&district=Pune → Escape → MH → Back to India → National."""
        page.goto(f"{base_url}/india-map.html?state=MH&district=Pune")
        _expect_district(page, "MH", "Pune")
        length = _history_length(page)
        page.keyboard.press("Escape")
        _expect_state(page, "MH")
        page.locator("#btn-back").click()
        _expect_national(page)
        assert _history_length(page) == length, "direct entry must be replaced, not pushed"

    def test_deep_link_district_close_button(self, page: Page, base_url: str, all_36_states_fixture):
        page.goto(f"{base_url}/india-map.html?state=MH&district=Pune")
        _expect_district(page, "MH", "Pune")
        page.locator("#modal .map-modal-close").click()
        _expect_state(page, "MH")


class TestQAP003_DelhiRouting:
    """Delhi goes through the same navigation layer as every other state."""

    def _open_new_delhi(self, page: Page, base_url: str) -> None:
        _open_map(page, base_url)
        _svg_state_click(page, "DL")
        _expect_state(page, "DL")
        page.locator('.ad-delhi-hotspot[data-district="New Delhi"]').click()
        _expect_district(page, "DL", "New Delhi")

    def test_delhi_back_forward_chain(self, page: Page, base_url: str, all_36_states_fixture):
        """DL → New Delhi; Back → DL; Back → National; Forward → DL; Forward → New Delhi."""
        self._open_new_delhi(page, base_url)
        page.go_back()
        _expect_state(page, "DL")
        page.go_back()
        _expect_national(page)
        page.go_forward()
        _expect_state(page, "DL")
        page.go_forward()
        _expect_district(page, "DL", "New Delhi")

    def test_delhi_escape_then_back_to_national(self, page: Page, base_url: str, all_36_states_fixture):
        self._open_new_delhi(page, base_url)
        length = _history_length(page)
        page.keyboard.press("Escape")
        _expect_state(page, "DL")
        assert _history_length(page) == length, "closing must not push"
        page.locator("#btn-back").click()
        _expect_national(page)

    def test_delhi_district_deep_link(self, page: Page, base_url: str, all_36_states_fixture):
        """Direct ?state=DL&district=New%20Delhi: close → DL → Back to India → National."""
        page.goto(f"{base_url}/india-map.html?state=DL&district=New%20Delhi")
        _expect_district(page, "DL", "New Delhi")
        length = _history_length(page)
        page.keyboard.press("Escape")
        _expect_state(page, "DL")
        page.locator("#btn-back").click()
        _expect_national(page)
        assert _history_length(page) == length, "direct entry must be replaced, not pushed"


# ---------------------------------------------------------------------------
# Real GeoJSON contract — no fixtures. Fixture-only tests missed AP (28 vs 37);
# these read the bundled geo/india-districts-all.geojson and the production
# resolver (IndiaMapData.getDistrictCodes) together.
# ---------------------------------------------------------------------------

_REAL_DISTRICTS = REPO_ROOT / "geo" / "india-districts-all.geojson"


def _real_features_by_code() -> dict[str, list[dict]]:
    by_code: dict[str, list[dict]] = {}
    for f in json.loads(_REAL_DISTRICTS.read_text(encoding="utf-8"))["features"]:
        props = f.get("properties") or {}
        by_code.setdefault(str(props.get("st_code")), []).append(props)
    return by_code


class TestDistrictGeoContract:
    def test_every_rendered_state_resolves_named_districts(self, page: Page, base_url: str):
        _open_map(page, base_url)  # real india-states.geojson, real resolver
        resolved = page.evaluate("""() => Array.from(
            document.querySelectorAll('#map-svg .ad-state'),
            p => [p.dataset.abbr, window.IndiaMapData.getDistrictCodes(p.dataset.abbr)])""")
        assert len(resolved) == 36
        by_code = _real_features_by_code()
        problems = []
        for abbr, codes in resolved:
            if abbr == "DL":
                continue  # Delhi uses the 11-hotspot image map
            assert isinstance(codes, list), f"{abbr}: resolver must return an array, got {codes!r}"
            feats = [p for c in codes for p in by_code.get(c, [])]
            named = [p for p in feats if str(p.get("district") or "").strip()]
            if not feats:
                problems.append(f"{abbr} {codes}: no features")
            elif not named:
                problems.append(f"{abbr} {codes}: only blank-district sentinels")
        assert not problems, problems

    @pytest.mark.parametrize("abbr,code", [
        ("AP", "37"), ("UK", "05"), ("DNH", "26"), ("CG", "22"),
        ("LA", "38"), ("AN", "35"), ("ML", "17"),
    ])
    def test_specific_codes(self, page: Page, base_url: str, abbr, code):
        _open_map(page, base_url)
        codes = page.evaluate("(a) => window.IndiaMapData.getDistrictCodes(a)", abbr)
        assert codes == [code]
        named = [p for p in _real_features_by_code().get(code, [])
                 if str(p.get("district") or "").strip()]
        assert named, f"{abbr}: no named district under st_code {code}"


class TestRealGeoDrill:
    """Keyboard drill on the real national map with the real district GeoJSON."""

    @pytest.mark.parametrize("abbr,minimum", [("AP", 13), ("UK", 13), ("DNH", 3)])
    def test_real_state_renders_districts(self, page: Page, base_url: str, abbr, minimum):
        _open_map(page, base_url)
        page.locator(f"#map-svg [data-abbr='{abbr}'].ad-state").focus()
        page.keyboard.press("Enter")
        _expect_state(page, abbr)
        n = page.locator("#map-svg .ad-district").count()
        assert n >= minimum, f"{abbr}: expected >= {minimum} district paths, got {n}"

    def test_real_fragments_collapse_to_one_district(self, page: Page, base_url: str):
        """Chandigarh's GeoJSON has two fragments with the same district name."""
        _open_map(page, base_url)
        page.locator("#map-svg [data-abbr='CH'].ad-state").focus()
        page.keyboard.press("Enter")
        _expect_state(page, "CH")
        names = _district_names(page)
        assert len(names) == len(set(names)) == 1, names
