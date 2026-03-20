/* eslint-disable no-undef */
// Firebase Cloud Messaging service worker for background push notifications.
// Must live at the root of the public directory so the browser registers it
// with the correct scope.
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

// Firebase config is read from the query string set by the FCM SDK when it
// registers this service worker. If unavailable, the SW still registers
// successfully but won't show background notifications.
firebase.initializeApp({
  apiKey: "PLACEHOLDER",
  projectId: "PLACEHOLDER",
  messagingSenderId: "PLACEHOLDER",
  appId: "PLACEHOLDER",
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
