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
    }).then(async function () {
      // Remove API entries written by the previous worker while preserving
      // public snapshots and cached pages needed for offline browsing.
      for (var name of [DATA, RUNTIME]) {
        var cache = await caches.open(name);
        for (var request of await cache.keys()) {
          var host = new URL(request.url).hostname;
          if (/\.supabase\.co$/.test(host) || host === 'api.alldeputations.com') await cache.delete(request);
        }
      }
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Snapshot manifest is network-first; immutable versioned shards are
     cache-first. Retain the existing cache namespace for offline continuity.
     Never cache authenticated Supabase/admin responses. */
  if (url.origin === self.location.origin &&
      (url.pathname === '/data/vacancies-manifest.json' || url.pathname.indexOf('/data/snapshots/') === 0)) {
    event.respondWith(caches.open(DATA).then(async function (cache) {
      var cached = await cache.match(req);
      if (cached && url.pathname.indexOf('/data/snapshots/') === 0) return cached;
      try {
        var fresh = await fetch(req);
        if (!fresh.ok) throw new Error('Snapshot unavailable');
        await cache.put(req, fresh.clone());
        return fresh;
      } catch (_) { return cached || new Response('', {status:503}); }
    }));
    return;
  }

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

  // Do not persist API responses, especially authenticated admin data.
  if (/\.supabase\.co$/.test(url.hostname) || url.hostname === 'api.alldeputations.com') return;

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

/* ===== Web Push vacancy alerts (review P1-3/P1-4) =====
 * push-notify sends { title, body, url, tag }. Show it; on click, focus an
 * existing tab or open the deep link (/?v=<id> opens the vacancy modal). */
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = data.title || "New deputation vacancy";
  var options = {
    body: data.body || "",
    tag: data.tag || "deputation-vacancy",
    icon: "/assets/brand/apple-touch-icon.png",
    badge: "/assets/brand/favicon.svg",
    data: { url: data.url || "/" },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ("focus" in c) { c.navigate(target); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
