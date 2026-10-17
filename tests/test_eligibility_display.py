"""The detail summary must show every feeder grade that the filter accepts."""
import re
from datetime import date
from tests.test_index import _row, _serve_fixture_rows


def test_three_tier_eligibility_matches_pay_level_filter_and_modal(page, base_url):
    row = _row('THREE-TIER-IAO', 100, date.today())
    row.update(Post_Name='Internal Audit Officer', Level='12', Level_Text='Level-12',
               Req_Level1='12', Req_Level2='11', Min_Years_Experience='0',
               Min_Years_Experience2='3',
               eligibility_tiers=[{'level': '12', 'min_years': '0'},
                                  {'level': '11', 'min_years': '3'},
                                  {'level': '10', 'min_years': '5'}])
    _serve_fixture_rows(page, [row])
    page.goto(f'{base_url}/index.html?myPayLevel=10')
    vacancy = page.locator('tr.clickable-row[data-open-details="THREE-TIER-IAO"]')
    vacancy.wait_for()
    expected = 'Level 12 (0 years) OR Level 11 (3 years) OR Level 10 (5 years)'
    assert vacancy.locator('.eligibility-col').inner_text().strip() == 'L12 / L11(3Y) / L10(5Y)'
    assert vacancy.locator('.eligibility-col').get_attribute('title') == expected
    vacancy.click()
    page.wait_for_selector('#modal[open]')
    eligibility = page.locator('#modal .modal-field').filter(
        has=page.locator('.modal-field-label', has_text=re.compile(r'^Eligibility$')))
    assert eligibility.locator('.modal-field-value').inner_text() == expected
