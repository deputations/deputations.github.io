/* Shared frontend config for alldeputations.com (canonical) /
 * deputations.github.io (GitHub Pages repo URL, still works but not shared).
 * The Apps Script web app handles multiple actions:
 *   - GET  /                           -> list of community discrepancy reports
 *   - POST { action:"report",  ... }   -> submit a FAQ discrepancy
 *   - POST { action:"vote",    ... }   -> vote on a discrepancy
 *   - POST { action:"vacancy", ... }   -> submit a deputation vacancy (link/pdf/manual)
 *
 * The Supabase `submit` Edge Function additionally handles:
 *   - POST { action:"feedback", ... }  -> contact-form feedback
 *   - POST { action:"flag", ... }      -> community-reported issue on a vacancy
 *   - POST { action:"endorse", flagId }-> +1 endorse an existing open flag
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

/* Web Push (vacancy alerts). The VAPID PUBLIC key is safe to expose — it only
 * identifies this server to the browser's push service; the matching PRIVATE
 * key lives only in the Supabase `push-notify` function's secrets. Push stays
 * disabled until this is a real key and the push-subscribe function is live. */
window.VAPID_PUBLIC_KEY = "BFwXP5B3Vt7GEck0voyf0cYBoibKwxJuwDk94AlHcBIwI0w2aUVr9u5G051v1KdN8st9Fqm2EPtxiTNHdTEiETI";
window.PUSH_READY = function () {
  return window.SUPABASE_READY() &&
    typeof window.VAPID_PUBLIC_KEY === "string" &&
    window.VAPID_PUBLIC_KEY.length > 80;
};
