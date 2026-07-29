# Astro scaffold — deputations.github.io

This directory contains the Astro source for the deputations site. It
currently builds **only the home page** (`index.html`). All other pages
(`defex.html`, `my-deputation.html`, etc.) still ship as static HTML on
the `main` branch until P2-2 ports them.

## Layout

```
astro/
├── package.json          # astro@latest
├── astro.config.mjs      # static output, base /
├── src/
│   ├── layouts/
│   │   └── Layout.astro  # <head>, theme bootstrap, skip-link, scroll-progress
│   ├── components/
│   │   ├── Navbar.astro        # top nav (auto-active via Astro.url.pathname)
│   │   ├── IconSprite.astro    # inline SVG <defs> (i-heart, i-moon, etc.)
│   │   └── Footer.astro        # disclaimer footer
│   └── pages/
│       └── index.astro   # home page — port of static index.html
└── public/               # populated at build time (see workflow)
```

## How the build works

1. `npm ci` (or `npm install` fallback) installs Astro
2. The workflow mirrors repo-root assets into `astro/public/`:
   - All CSS/JS files referenced from the Astro pages
   - `data/*.json` (cron dumps)
   - `assets/`, `vendor/` (Three.js etc.)
   - `manifest.webmanifest`, `feed.xml`, `sitemap.xml`, `robots.txt`
   - `sw.js` (service worker)
   - `CNAME` (GitHub Pages custom domain)
   - `.nojekyll` (disables GH Pages Jekyll processing)
3. `npm run build` emits `astro/dist/` with:
   - `dist/index.html` (Astro-built)
   - All the public/ assets copied through verbatim
4. `actions/deploy-pages@v4` publishes `astro/dist/` to GitHub Pages

The deploy target is **the `gh-pages` branch**, which GitHub Pages
serves when configured with that branch as the build source. Until
the owner flips Pages source from `main` to `gh-pages` (a one-click
change in Settings → Pages), the existing static site on `main` stays
live. The two pipelines do NOT interfere.

## Local development

```bash
cd astro
npm install
npm run dev
```

`http://localhost:4321` shows the dev build with hot reload. Mirror
the runtime assets into `astro/public/` before running dev:

```bash
mkdir -p astro/public
# copy the same assets the workflow mirrors (see .github/workflows/astro-build.yml)
cp ../{CSS,JS,etc.} astro/public/
```

## Cache-bust convention

`<script>` and `<link>` tags continue to use `?v=msNN` (style.css,
app.js) and `?v=NN` (site-widgets.js) suffixes matching the static
site. Bump them in `Layout.astro` and `index.astro` together when
the underlying file changes — same convention as the static site
(CHANGELOG.md §3).

## Adding a new page (P2-2)

For the next migration wave, copy `index.astro` to
`src/pages/defex.astro`, swap the body for the contents of
`defex.html` (preserving every ID and className that the page's JS
queries), and use the existing `Layout` / `Navbar` / `IconSprite`
components. The data cron, deploy workflow, and asset mirror all
just work.

## Why this exists

See `WEBSITE-REVIEW.md` §3 P2 (Astro migration) and TECHNICAL.md §2
(PWA / architecture). The Astro build is the foundation for:
- **P2-3** per-vacancy static pages with `JobPosting` JSON-LD (SEO)
- **P2-4** build-time OG images per vacancy (satori/resvg)
- **P2-5** auto-generated sitemap.xml with vacancy URLs
