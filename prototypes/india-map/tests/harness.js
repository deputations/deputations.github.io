// tests/harness.js — Browser test harness for India Map prototype
// Provides test fixture loading, browser setup, and shared helpers.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8092;

// Test helpers
export const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`Assertion failed: ${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
    }
  },
  notEqual(actual, unexpected, msg) {
    if (actual === unexpected) {
      throw new Error(`Assertion failed: ${msg}\n  Did not expect: ${JSON.stringify(unexpected)}`);
    }
  },
  truthy(value, msg) {
    if (!value) throw new Error(`Assertion failed: ${msg}\n  Value was falsy: ${JSON.stringify(value)}`);
  },
  isAbove(actual, min, msg) {
    if (!(actual > min)) {
      throw new Error(`Assertion failed: ${msg}\n  Expected > ${min}, got ${actual}`);
    }
  },
  isBelow(actual, max, msg) {
    if (!(actual < max)) {
      throw new Error(`Assertion failed: ${msg}\n  Expected < ${max}, got ${actual}`);
    }
  },
  includes(array, item, msg) {
    if (!array.includes(item)) {
      throw new Error(`Assertion failed: ${msg}\n  Expected array to include ${JSON.stringify(item)}\n  Array: ${JSON.stringify(array)}`);
    }
  },
  notIncludes(array, item, msg) {
    if (array.includes(item)) {
      throw new Error(`Assertion failed: ${msg}\n  Expected array NOT to include ${JSON.stringify(item)}\n  Array: ${JSON.stringify(array)}`);
    }
  },
  matches(actual, regex, msg) {
    if (!regex.test(actual)) {
      throw new Error(`Assertion failed: ${msg}\n  ${JSON.stringify(actual)} did not match ${regex}`);
    }
  },
  isTrue(actual, msg) {
    if (actual !== true) throw new Error(`Assertion failed: ${msg}\n  Expected true, got ${JSON.stringify(actual)}`);
  },
  isFalse(actual, msg) {
    if (actual !== false) throw new Error(`Assertion failed: ${msg}\n  Expected false, got ${JSON.stringify(actual)}`);
  }
};

// Module-level singleton — shared across all test imports
let _sharedServer = null;
let _sharedBrowser = null;
export function startServer() {
  if (_sharedServer) return _sharedServer;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    const filePath = path.join(ROOT, url);
    if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', types[path.extname(filePath)] || 'text/plain');
      res.end(data);
    });
  });
  _sharedServer = new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
  return _sharedServer;
}

export async function stopServer() {
  if (_sharedServer) {
    const s = await _sharedServer;
    await new Promise(r => s.close(r));
    _sharedServer = null;
  }
}

// Launch browser (singleton — reuse across test files)
export async function startBrowser() {
  if (_sharedBrowser) return _sharedBrowser;
  const browser = await chromium.launch({ headless: true });
  _sharedBrowser = browser;
  return browser;
}

export async function stopBrowser() {
  if (_sharedBrowser) {
    await _sharedBrowser.close();
    _sharedBrowser = null;
  }
}

export async function newContext() {
  const browser = await startBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata'
  });
  // Disable external CDN requests
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
      return route.continue();
    }
    return route.abort();
  });
  const page = await context.newPage();
  return { browser: _sharedBrowser, context, page };
}

// Page query helpers
export const probe = {
  async summaryTitle(page) {
    return page.locator('#summary-title').innerText();
  },
  async summaryCount(page) {
    return page.locator('#summary-count').innerText();
  },
  async chips(page) {
    return page.locator('#filter-chips').innerText().catch(() => '');
  },
  async chipCount(page) {
    return page.locator('.ad-filter-chip').count();
  },
  async mapGroups(page) {
    return page.locator('#india-map > g').count();
  },
  async stateShapeCount(page) {
    return page.locator('#india-map path.ad-state[data-abbr]').count();
  },
  async districtShapeCount(page) {
    return page.locator('#india-map path.ad-state[data-district]').count();
  },
  async shapeIds(page) {
    return page.locator('#india-map path').evaluateAll(els => els.map(e => e.id));
  },
  async uniqueShapeIdCount(page) {
    const ids = await this.shapeIds(page);
    return new Set(ids).size;
  },
  async transforms(page) {
    return page.locator('#india-map > g').evaluateAll(els => els.map(e => e.getAttribute('transform')));
  },
  async activeExchange(page) {
    return page.locator('.exchange-btn.active').getAttribute('data-exchange').catch(() => null);
  },
  async exchangeBtn(page, exId) {
    return page.locator(`.exchange-btn[data-exchange="${exId}"]`).evaluate(el => ({
      active: el.classList.contains('active'),
      pressed: el.getAttribute('aria-pressed') === 'true'
    }));
  },
  async selectedFilter(page, key) {
    return page.locator(`#filter-${key}`).inputValue().catch(() => null);
  },
  async resultsHidden(page) {
    return page.locator('#results-panel').evaluate(el => el.hidden);
  },
  async resultsTitle(page) {
    return page.locator('#results-title').innerText();
  },
  async cardTitles(page) {
    return page.locator('.ad-result-card .ad-result-title').allInnerTexts();
  },
  async cardCount(page) {
    return page.locator('.ad-result-card').count();
  },
  async backBtnHidden(page) {
    return page.locator('#btn-back').evaluate(el => el.hidden);
  },
  async url(page) {
    return page.url();
  },
  async visibleStateCount(page) {
    return page.locator('#india-map g.ad-state[data-abbr]').count();
  },
  async selectedDistrictPath(page, distName) {
    return page.locator(`[data-district="${distName}"]`).evaluate(el => ({
      classes: el.classList.value,
      ariaLabel: el.getAttribute('aria-label')
    }));
  }
};

export async function runScenario(page, scenario) {
  // Reload page with ?scenario=empty
  await page.goto(`http://127.0.0.1:${PORT}/?scenario=${scenario}`);
  await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
}

export async function delay(ms) {
  await new Promise(r => setTimeout(r, ms));
}
