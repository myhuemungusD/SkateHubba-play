import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MAX_GAME_ID_LENGTH,
  captureGameLinkFromLocation,
  clearPendingGameLink,
  hasGameLinkParam,
  isValidGameId,
  peekPendingGameLink,
  readGameLinkParam,
  stashPendingGameLink,
  withoutGameLinkParam,
} from "../gameLink";

const KEY = "skate.pendingGameLink";

describe("isValidGameId", () => {
  it("accepts Firestore auto-ids and hand-made ids", () => {
    expect(isValidGameId("YqZNr8nWUabkLwpak0uU")).toBe(true);
    expect(isValidGameId("deeplink-target_game")).toBe(true);
    expect(isValidGameId("a".repeat(MAX_GAME_ID_LENGTH))).toBe(true);
  });

  it.each([
    ["non-string", 42],
    ["null", null],
    ["empty", ""],
    ["too long", "a".repeat(MAX_GAME_ID_LENGTH + 1)],
    ["path separator", "games/x"],
    ["dot segment", ".."],
    ["space", "a b"],
    ["reserved __id__", "__name__"],
  ])("rejects %s", (_label, value) => {
    expect(isValidGameId(value)).toBe(false);
  });
});

describe("URL helpers", () => {
  it("reads a valid ?game= and ignores an invalid one", () => {
    expect(readGameLinkParam("?game=g1")).toBe("g1");
    expect(readGameLinkParam("?game=..%2Fusers")).toBeNull();
    expect(readGameLinkParam("?x=1")).toBeNull();
  });

  it("detects the param even when its value is invalid", () => {
    expect(hasGameLinkParam("?game=")).toBe(true);
    expect(hasGameLinkParam("?x=1")).toBe(false);
  });

  it("strips only the game param", () => {
    expect(withoutGameLinkParam("?game=g1")).toBe("");
    expect(withoutGameLinkParam("?utm_source=push&game=g1")).toBe("?utm_source=push");
  });
});

describe("pending game link", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearPendingGameLink();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stashes, peeks and clears through sessionStorage", () => {
    expect(peekPendingGameLink()).toBeNull();
    stashPendingGameLink("g1");
    expect(sessionStorage.getItem(KEY)).toBe("g1");
    expect(peekPendingGameLink()).toBe("g1");
    clearPendingGameLink();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(peekPendingGameLink()).toBeNull();
  });

  it("re-validates what it reads back from storage", () => {
    sessionStorage.setItem(KEY, "../users/u2");
    expect(peekPendingGameLink()).toBeNull();
  });

  it("falls back to memory when sessionStorage throws (private-mode Safari)", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    stashPendingGameLink("g2");
    expect(peekPendingGameLink()).toBe("g2");
    clearPendingGameLink();
    expect(peekPendingGameLink()).toBeNull();
  });
});

describe("captureGameLinkFromLocation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearPendingGameLink();
  });

  function fakeWindow(href: string) {
    const url = new URL(href);
    const replaceState = vi.fn();
    return {
      win: {
        location: { pathname: url.pathname, search: url.search, hash: url.hash },
        history: { state: { idx: 0 }, replaceState },
      } as unknown as Pick<Window, "location" | "history">,
      replaceState,
    };
  }

  it("parks the id and strips the param, keeping the rest of the URL and history state", () => {
    const { win, replaceState } = fakeWindow("https://skatehubba.com/?utm_source=push&game=g1#top");
    captureGameLinkFromLocation(win);
    expect(peekPendingGameLink()).toBe("g1");
    expect(replaceState).toHaveBeenCalledWith({ idx: 0 }, "", "/?utm_source=push#top");
  });

  it("strips an invalid id without parking it", () => {
    const { win, replaceState } = fakeWindow("https://skatehubba.com/?game=..%2Fx");
    captureGameLinkFromLocation(win);
    expect(peekPendingGameLink()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith({ idx: 0 }, "", "/");
  });

  it("leaves a URL without the param alone", () => {
    const { win, replaceState } = fakeWindow("https://skatehubba.com/lobby?x=1");
    captureGameLinkFromLocation(win);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("defaults to the real window", () => {
    window.history.replaceState(null, "", "/?game=g9");
    captureGameLinkFromLocation();
    expect(window.location.search).toBe("");
    expect(peekPendingGameLink()).toBe("g9");
    clearPendingGameLink();
  });
});
