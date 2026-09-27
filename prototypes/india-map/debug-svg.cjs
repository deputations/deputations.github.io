const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // Explore SVG properties
  const svgInfo = await page.evaluate(() => {
    const svg = document.getElementById('india-map') || document.getElementById('map-svg');
    if (!svg) return 'no svg found';

    const keys = Object.keys(svg).filter(k => k.toLowerCase().includes('view') || k.toLowerCase().includes('svg'));
    const props = {};

    // Try different ways to access viewBox
    props.id = svg.id;
    props.tagName = svg.tagName;

    // viewBox attribute
    props.viewBoxAttr = svg.getAttribute('viewBox');

    // viewBox as property
    try { props.viewBoxProp = svg.viewBox; } catch(e) { props.viewBoxPropErr = e.message; }
    try { props.viewBoxBase = svg.viewBox?.baseVal; } catch(e) { props.viewBoxBaseErr = e.message; }

    // viewBox via getAttribute
    const vbStr = svg.getAttribute('viewBox');
    if (vbStr) {
      const parts = vbStr.split(/\s+/).map(Number);
      props.parsedVB = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }

    return props;
  });
  console.log('SVG info:', JSON.stringify(svgInfo, null, 2));

  // Click Maharashtra
  await page.locator('[aria-label="Maharashtra: 13 deputations"]').click();
  await sleep(2500);

  const afterMH = await page.evaluate(() => {
    const svg = document.getElementById('india-map') || document.getElementById('map-svg');
    const vbStr = svg.getAttribute('viewBox');
    const parts = vbStr ? vbStr.split(/\s+/).map(Number) : null;
    return {
      viewBox: vbStr,
      parsed: parts ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] } : null
    };
  });
  console.log('After Maharashtra click:', JSON.stringify(afterMH));

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
