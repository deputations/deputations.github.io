/* Shared frontend config for alldeputations.com (canonical) /
 * deputations.github.io (GitHub Pages repo URL, still works but not shared).
 *
 * The Supabase `submit` Edge Function is the single backend for all form
 * submissions and the visitor counter (RPC). Previously an Apps Script
 * fallback existed as a runtime "second line"; P3-5 retired it (2026-07-30).
 * If this file fails to load, every form shows an "endpoint not configured"
 * notice — failures surface immediately instead of being silently masked. */

/* Supabase — public vacancies backend.
 * The anon key is SAFE to expose in the browser: Row Level Security limits the
 * anon role to reading only approved vacancies. */
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
