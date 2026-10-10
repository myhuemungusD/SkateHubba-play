// Picks the pre-JS shell for signed-out /, /auth, and /feed.
// The shell stays outside #root so React cannot drop it as the largest paint.
// External file: production CSP has no 'unsafe-inline'. Loaded with defer so
// it is not render-blocking; home is visible from CSS before this runs.
(function () {
  // Production HTML ships the app stylesheet as print and the entry module
  // as a meta tag. Both apply on the second frame, after the shell paints.
  var appCss = document.querySelectorAll("link[data-app-css]");
  var entry = document.querySelector('meta[name="app-entry"]');
  if (appCss.length > 0 || (entry && entry.content)) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var i = 0; i < appCss.length; i++) appCss[i].media = "all";
        if (entry && entry.content) {
          var script = document.createElement("script");
          script.type = "module";
          script.src = entry.content;
          script.crossOrigin = "anonymous";
          document.head.appendChild(script);
        }
      });
    });
  }

  var path = location.pathname;
  if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
  var shell = path === "/" ? "home" : path === "/auth" ? "auth" : path === "/feed" ? "feed" : "";
  var skip = shell === "";
  if (!skip) {
    try {
      if (localStorage.getItem("sh_auth_hint") === "1") skip = true;
    } catch (err) {
      skip = false;
    }
  }
  if (skip) {
    document.documentElement.setAttribute("data-lcp", "skip");
    return;
  }

  document.documentElement.setAttribute("data-lcp", shell);
  window.__skatehubbaLcpShell = shell;
})();
