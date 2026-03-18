// Unregister stale service workers left by previous setups.
// Keeps the Firebase Cloud Messaging service worker alive for push notifications.
// Extracted to an external file so the CSP can avoid 'unsafe-inline' for scripts.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    registrations.forEach(function (registration) {
      // Keep the FCM service worker — it handles background push notifications
      if (registration.active && registration.active.scriptURL.includes("firebase-messaging-sw")) return;
      registration.unregister();
    });
  });
}
