/* eslint-disable no-undef */
// Firebase Cloud Messaging service worker for background push notifications.
// Must live at the root of the public directory so the browser registers it
// with the correct scope.
//
// ⚠️  Keep the CDN version below in sync with the `firebase` version in package.json.
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

// Firebase config is injected at build time by the Vite plugin (see vite.config.ts).
// During development the SW reads config from the query string appended by the
// registration call in src/services/fcm.ts.
//
// At build time the plugin copies this file into dist/ with real env-var values
// replacing the __PLACEHOLDER__* tokens below.  If a token is not replaced (e.g.
// local dev without the plugin), the SW falls back to parsing the URL search params
// set by the FCM SDK / manual registration.
var swUrl = new URL(self.location.href);

firebase.initializeApp({
  apiKey: swUrl.searchParams.get("apiKey") || "__PLACEHOLDER_API_KEY__",
  authDomain: swUrl.searchParams.get("authDomain") || "__PLACEHOLDER_AUTH_DOMAIN__",
  projectId: swUrl.searchParams.get("projectId") || "__PLACEHOLDER_PROJECT_ID__",
  storageBucket: swUrl.searchParams.get("storageBucket") || "__PLACEHOLDER_STORAGE_BUCKET__",
  messagingSenderId: swUrl.searchParams.get("messagingSenderId") || "__PLACEHOLDER_MESSAGING_SENDER_ID__",
  appId: swUrl.searchParams.get("appId") || "__PLACEHOLDER_APP_ID__",
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var notification = payload.notification || {};
  var title = notification.title || "SkateHubba";
  var options = {
    body: notification.body || "You have a new notification",
    icon: "/logoblack.png",
    badge: "/logoblack.png",
    data: payload.data || {},
    // Tag groups notifications by game so they replace rather than stack
    tag: payload.data && payload.data.gameId ? "game_" + payload.data.gameId : "skatehubba",
    // Renotify even if same tag so the user sees updated notifications
    renotify: true,
  };
  self.registration.showNotification(title, options);
});

// Handle notification click — open the app / focus existing tab.
// If the push payload includes a gameId, we navigate to /?game=<gameId>
// so the app can deep-link into the correct game.
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var data = event.notification.data || {};
  var gameId = data.gameId;
  var urlPath = gameId ? "/?game=" + gameId : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // If there's an existing tab, focus it and navigate
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && "focus" in client) {
          client.focus();
          if (gameId) {
            client.postMessage({ type: "OPEN_GAME", gameId: gameId });
          }
          return;
        }
      }
      // No existing tab — open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlPath);
      }
    })
  );
});
