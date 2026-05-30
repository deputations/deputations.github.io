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
window.SUPABASE_URL = "https://djaxutkmhazufsxeobal.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqYXh1dGttaGF6dWZzeGVvYmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjgzNTksImV4cCI6MjA5NTcwNDM1OX0.AHfWNpMS69KhxGX6Px1fS9dVddo9lUiXvc96hM5UTbU";
window.SUPABASE_READY = function () {
  return /^https:\/\/[a-z0-9]+\.supabase\.co/.test(window.SUPABASE_URL || "") &&
    (window.SUPABASE_ANON_KEY || "").length > 20 &&
    !/YOUR_/.test(window.SUPABASE_ANON_KEY || "");
};
