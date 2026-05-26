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
