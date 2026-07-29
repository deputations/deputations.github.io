// astro/src/lib/vacancies.js — read vacancies at build time.
//
// Reads data/vacancies.json from astro/public/data/ (the mirror that
// the build-data cron + the GH Actions workflow populate). Returns
// the list of rows sorted by Notification_Date DESC.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export default async function readVacancies() {
  // At build time, the cwd is the astro/ directory. The file lives at
  // astro/public/data/vacancies.json — also reachable from process.cwd().
  const file = path.resolve(process.cwd(), 'public', 'data', 'vacancies.json');
  try {
    const txt = await readFile(file, 'utf-8');
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && r.Vacancy_ID);
  } catch (e) {
    // If the file doesn't exist yet (first build before cron runs),
    // return an empty list. getStaticPaths gets []; Astro emits no pages.
    return [];
  }
}