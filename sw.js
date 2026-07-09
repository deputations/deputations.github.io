/* Deputations service worker (review P1-2).
 * Strategy — chosen to coexist with the site's manual ?v= cache-busting:
 *   - page navigations .... network-first, cached page fallback, then home shell
 *   - Supabase REST GETs .. network-first, cache fallback (offline last-fetched list)
 *   - same-origin assets +
 *     /data/*.json ........ stale-while-revalidate (new ?v= URL = new cache entry,
 *                           so deploys keep working exactly as before)
 * Nothing except GET is ever intercepted. Bump VERSION to invalidate all caches.
 */
"use strict";

var VERSION = "dep-sw-v1";
var RUNTIME = VERSION + "-runtime";
var DATA = VERSION + "-data";

var STATIC_RE = /\.(?:css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?)(?:$|\?)/i;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf(VERSION) !== 0; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* page navigations: freshest possible, degrade to cache, then the home shell */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (fresh) {
        var copy = fresh.clone();
        caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
        return fresh;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("/index.html");
        }).then(function (hit) {
          return hit || new Response("You are offline.", {
            status: 503, headers: { "Content-Type": "text/plain" }
          });
        });
      })
    );
    return;
  }

  /* live Supabase data: network-first so votes/counts stay fresh; cached copy
     only when the network is gone */
  if (/\.supabase\.co$/.test(url.hostname)) {
    event.respondWith(
      fetch(req).then(function (fresh) {
        if (fresh && fresh.ok) {
          var copy = fresh.clone();
          caches.open(DATA).then(function (c) { c.put(req, copy); });
        }
        return fresh;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response("", { status: 504 });
        });
      })
    );
    return;
  }

  /* same-origin static assets + data json: stale-while-revalidate */
  if (url.origin === self.location.origin &&
      (STATIC_RE.test(url.pathname + url.search) || url.pathname.indexOf("/data/") === 0)) {
    event.respondWith(
      caches.open(url.pathname.indexOf("/data/") === 0 ? DATA : RUNTIME).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var refresh = fetch(req).then(function (fresh) {
            if (fresh && fresh.ok) cache.put(req, fresh.clone());
            return fresh;
          }).catch(function () { return null; });
          return cached || refresh.then(function (fresh) {
            return fresh || new Response("", { status: 504 });
          });
        });
      })
    );
  }
});
