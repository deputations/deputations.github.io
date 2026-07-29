// astro.config.mjs — deputations.github.io Astro build
//
// Static output, base path '/' (served from alldeputations.com apex,
// not a subpath). All cache-busting ?v= suffixes are preserved verbatim
// from the existing static site — Astro passes them through as-is in
// the script/style href it emits.

import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  base: '/',
  // astro/public/ holds every asset that gets copied verbatim into dist/
  // at build time. The workflow copies repo-root assets into astro/public/
  // before `npm run build` runs (see .github/workflows/astro-build.yml).
  publicDir: 'public',
  outDir: 'dist',
  // Emit /contact.html, /defex.html etc. directly so internal links match
  // the static site's URL shape. Otherwise Astro emits /contact/index.html
  // which 404s on the existing nav links.
  trailingSlash: 'never',
  build: {
    sourcemap: false,
    inlineStylesheets: 'auto',
  },
});