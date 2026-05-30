/* Shared frontend config for deputations.github.io
 * The Apps Script web app handles multiple actions:
 *   - GET  /                           -> list of community discrepancy reports
 *   - POST { action:"report",  ... }   -> submit a FAQ discrepancy
 *   - POST { action:"vote",    ... }   -> vote on a discrepancy
 *   - POST { action:"vacancy", ... }   -> submit a deputation vacancy (link/pdf/manual)
 *
 * If this file is missing or fails to load, the FAQ page falls back to its
 * hard-coded URL, and the Report Vacancy page disables submission and shows a
 * setup-needed notice. */
window.DEPUTATIONS_API =
  "https://script.google.com/macros/s/AKfycbyltPrnuwL3oS0HUiw1IH9X_WEaBH3kHA5F8cBDcHWsmyc7o_ySNDQ0C-Cza9-1ilfx/exec";

/* Supabase — public vacancies backend.
 * The anon key is SAFE to expose in the browser: Row Level Security limits the
 * anon role to reading only approved vacancies. Fill these in after creating
 * your Supabase project (see SETUP.md). While they remain the placeholder
 * values below, the dashboard falls back to data/vacancies.json. */
window.SUPABASE_URL = "https://YOUR-PROJECT-ref.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
window.SUPABASE_READY = function () {
  return /^https:\/\/[a-z0-9]+\.supabase\.co/.test(window.SUPABASE_URL || "") &&
    (window.SUPABASE_ANON_KEY || "").length > 20 &&
    !/YOUR_/.test(window.SUPABASE_ANON_KEY || "");
};
