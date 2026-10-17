// Unregister stale service workers left by previous setups.
// Keeps the Firebase Cloud Messaging service worker alive for push notifications.
// Extracted to an external file so the CSP can avoid 'unsafe-inline' for scripts.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    registrations.forEach(function (registration) {
      var worker = registration.active || registration.waiting || registration.installing;
      var url = worker ? worker.scriptURL : "";
      // Keep push and the asset cache. An installing worker has no `active`
      // script yet — unregistering it would drop a registration that just started.
      if (url.indexOf("firebase-messaging-sw") !== -1 || url.indexOf("asset-cache-sw") !== -1) return;
      registration.unregister();
    });
  });
}
