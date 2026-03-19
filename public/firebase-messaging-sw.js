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

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var notification = payload.notification || {};
  var title = notification.title || "SkateHubba";
  var options = {
    body: notification.body || "You have a new notification",
    icon: "/logoblack.png",
    badge: "/logoblack.png",
    data: payload.data,
  };
  self.registration.showNotification(title, options);
});
