import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(resolve(process.cwd(), "public/lcp-shell.js"), "utf8");

function runShell(pathname: string): void {
  window.history.pushState({}, "", pathname);
  window.eval(SOURCE);
}

describe("lcp shell", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = '<div class="lcp-shell lcp-shell-feed"></div>';
    document.documentElement.removeAttribute("data-lcp");
    delete window.__skatehubbaLcpShell;
    localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the home shell when the visitor is signed out", () => {
    runShell("/");
    expect(document.documentElement.getAttribute("data-lcp")).toBe("home");
    expect(window.__skatehubbaLcpShell).toBe("home");
    expect(document.querySelector(".lcp-shell-feed img")).toBeNull();
  });

  it("marks the auth shell for a trailing slash", () => {
    runShell("/auth/");
    expect(document.documentElement.getAttribute("data-lcp")).toBe("auth");
    expect(window.__skatehubbaLcpShell).toBe("auth");
  });

  it("marks the feed shell without injecting a poster", () => {
    runShell("/feed");
    expect(document.documentElement.getAttribute("data-lcp")).toBe("feed");
    expect(window.__skatehubbaLcpShell).toBe("feed");
    expect(document.querySelector("img")).toBeNull();
  });

  it("hides the shell for a signed-in hint", () => {
    localStorage.setItem("sh_auth_hint", "1");
    runShell("/");
    expect(document.documentElement.getAttribute("data-lcp")).toBe("skip");
    expect(window.__skatehubbaLcpShell).toBeUndefined();
  });

  it("hides the shell off the boot paths", () => {
    runShell("/lobby");
    expect(document.documentElement.getAttribute("data-lcp")).toBe("skip");
    expect(window.__skatehubbaLcpShell).toBeUndefined();
  });

  it("applies print app stylesheets after two frames", () => {
    const appCss = document.createElement("link");
    appCss.setAttribute("data-app-css", "");
    appCss.media = "print";
    document.head.appendChild(appCss);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const entry = document.createElement("meta");
    entry.name = "app-entry";
    entry.content = "/assets/index-abc.js";
    document.head.appendChild(entry);
    runShell("/");
    expect(appCss.media).toBe("print");
    expect(document.querySelector('script[src="/assets/index-abc.js"]')).toBeNull();
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(frames).toHaveLength(2);
    frames[1](0);
    expect(appCss.media).toBe("all");
    const loaded = document.querySelector('script[src="/assets/index-abc.js"]');
    expect(loaded?.getAttribute("type")).toBe("module");
    expect(loaded?.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("still paints the shell when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    runShell("/auth");
    expect(window.__skatehubbaLcpShell).toBe("auth");
  });
});
