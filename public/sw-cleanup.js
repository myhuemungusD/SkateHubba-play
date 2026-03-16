// Unregister stale service workers left by previous setups.
// Extracted to an external file so the CSP can avoid 'unsafe-inline' for scripts.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    registrations.forEach(function (registration) {
      registration.unregister();
    });
  });
}
