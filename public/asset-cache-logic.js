/* eslint-disable no-undef */
// Shared by asset-cache-sw.js and firebase-messaging-sw.js.
// Hashed /assets/ files are cache-first (the URL changes when the bytes do).
// Other same-origin images and fonts are stale-while-revalidate.
// Navigations and /api/ stay on the network so deploys are not stuck on an old shell.
var SH_ASSET_CACHE = "sh-assets-v1";

function shIsHashedAsset(pathname) {
  return pathname.indexOf("/assets/") === 0;
}

function shIsStaticFile(pathname) {
  return /\.(?:woff2|webp|png|svg|ico|jpg|jpeg)$/.test(pathname);
}

function shStore(cache, request, response) {
  if (response && response.ok && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.indexOf("sh-assets-") === 0 && key !== SH_ASSET_CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") return;
  if (url.pathname.indexOf("/api/") === 0) return;

  if (shIsHashedAsset(url.pathname)) {
    event.respondWith(
      caches.open(SH_ASSET_CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          return fetch(request).then(function (response) {
            return shStore(cache, request, response);
          });
        });
      }),
    );
    return;
  }

  if (shIsStaticFile(url.pathname)) {
    event.respondWith(
      caches.open(SH_ASSET_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var network = fetch(request)
            .then(function (response) {
              return shStore(cache, request, response);
            })
            .catch(function () {
              return cached;
            });
          return cached || network;
        });
      }),
    );
  }
});
