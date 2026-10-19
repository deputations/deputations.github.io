"""Local-browser checks with every backend request denied or stubbed."""
import json
import pytest
from pathlib import Path
from tests.fixtures.constants import ANON_KEY

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'data/vacancies-manifest.json').read_text(encoding='utf-8'))
ARCHIVED_ID = next(iter(MANIFEST['index']))


@pytest.fixture(autouse=True)
def versioned_snapshots(page):
    page.route('**/data/vacancies-manifest.json', lambda route: route.continue_())


def ready(page, url):
    page.goto(url)
    page.wait_for_function("() => (document.getElementById('resultsCount')?.textContent || '').includes('vacancies')")
    # The existing animated renderer updates the counter before painting rows.
    page.wait_for_selector('#dataContainer [data-open-details]')


def test_normal_load_never_reads_vacancy_table_or_archive(page, base_url):
    calls = []
    page.on('request', lambda req: calls.append(req.url))
    ready(page, base_url + '/index.html')
    assert page.locator('tr.clickable-row').count() > 0
    assert not any('/rest/v1/vacancies' in url for url in calls)
    assert not any('/archive-' in url for url in calls)
    assert page.locator('#snapshot-status').count() == 0
    total_card = page.locator('[data-kpi-filter="all"]')
    assert total_card.locator('.kpi-title').inner_text() == 'TOTAL VACANCIES'
    assert total_card.locator('.kpi-value').get_attribute('data-count') == str(MANIFEST['record_count'])


def test_archived_deep_link_loads_only_its_shard(page, base_url):
    calls = []
    page.on('request', lambda req: calls.append(req.url))
    ready(page, base_url + '/index.html?v=' + ARCHIVED_ID)
    page.wait_for_selector('#modal[open]')
    shards = {url for url in calls if '/archive-' in url}
    assert len(shards) == 1
    assert not any('/rest/v1/vacancies' in url for url in calls)


def test_all_selection_loads_archive_and_preserves_active_filter(page, base_url):
    ready(page, base_url + '/index.html')
    page.locator('#desktopFilterToggle').click()
    page.locator('#filterStatusSS .ms-trigger').click()
    page.locator('#filterStatusSS [role=option][data-value=""]').click()
    page.wait_for_function('() => window.PublicVacancies.archiveLoaded()')
    assert page.locator('tr.clickable-row').count() > 0


def test_backend_402_does_not_break_static_browsing(page, base_url):
    page.route('**/*.supabase.co/**', lambda route: route.fulfill(status=402, body='restricted',
               headers={'Access-Control-Allow-Origin':'*'}))
    ready(page, base_url + '/index.html')
    page.locator('tr.clickable-row').first.click()
    page.wait_for_selector('#modal[open]')


def test_legacy_compatibility_when_manifest_missing(page, base_url):
    page.route('**/data/vacancies-manifest.json', lambda route: route.fulfill(status=404))
    ready(page, base_url + '/index.html')
    assert page.locator('tr.clickable-row').count() > 0
    assert 'last available' in page.locator('#snapshot-status').inner_text()


def test_saved_archived_record_survives_my_deputation(page, base_url):
    page.add_init_script('localStorage.setItem("deputationWatchlist", ' + json.dumps(json.dumps([ARCHIVED_ID])) + ')')
    page.goto(base_url + '/my-deputation.html')
    page.wait_for_function('() => window.PublicVacancies && window.PublicVacancies.metadata()')
    page.wait_for_function('(id) => JSON.parse(localStorage.deputationWatchlist).includes(id)', arg=ARCHIVED_ID)
    page.wait_for_timeout(300)
    assert json.loads(page.evaluate('localStorage.deputationWatchlist')) == [ARCHIVED_ID]


def test_failed_archive_keeps_current_listings_and_saved_identifiers(page, base_url):
    page.add_init_script('localStorage.setItem("deputationWatchlist", ' + json.dumps(json.dumps([ARCHIVED_ID])) + ')')
    page.route('**/data/snapshots/**/archive-*.json', lambda route: route.fulfill(status=503))
    ready(page, base_url + '/index.html?v=' + ARCHIVED_ID)
    assert page.locator('tr.clickable-row').count() > 0
    assert json.loads(page.evaluate('localStorage.deputationWatchlist')) == [ARCHIVED_ID]


def test_mobile_current_listings_and_modal(page, base_url):
    page.set_viewport_size({'width':390, 'height':844})
    ready(page, base_url + '/index.html')
    assert page.locator('#resultsCount').is_visible()


def test_cached_backend_config_is_refreshed_before_use(page, base_url):
    page.goto(base_url + '/admin-ingest.html')
    page.evaluate("async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; }")
    page.wait_for_function('() => !!navigator.serviceWorker.controller')
    # Reproduce a browser that still has a pre-migration key under an old URL.
    result = page.evaluate("""async () => {
        const url = '/config.js?v=before-migration';
        const cache = await caches.open('dep-sw-v1-runtime');
        await cache.put(url, new Response('window.SUPABASE_ANON_KEY = "obsolete-key";', {
            headers: {'Content-Type': 'application/javascript'}
        }));
        const response = await fetch(url);
        return {body: await response.text(), cached: await (await cache.match(url)).text()};
    }""")
    assert ANON_KEY in result['body']
    assert 'obsolete-key' not in result['body']
    assert result['cached'] == result['body']
    # The fresh copy must still support offline snapshot pages.
    page.context.set_offline(True)
    offline_body = page.evaluate("async () => (await fetch('/config.js?v=before-migration')).text()")
    assert offline_body == result['body']


def test_cached_snapshot_survives_full_network_outage(page, base_url):
    ready(page, base_url + '/index.html')
    page.evaluate("async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; }")
    page.wait_for_function('() => !!navigator.serviceWorker.controller')
    ready(page, base_url + '/index.html')
    page.context.set_offline(True)
    page.reload()
    page.wait_for_function("() => (document.getElementById('resultsCount')?.textContent || '').includes('vacancies')")
    page.wait_for_selector('tr.clickable-row')
    assert page.locator('tr.clickable-row').count() > 0
