import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const installPromptAnswered = vi.fn();
const appInstalled = vi.fn();
vi.mock("../../services/analytics", () => ({
  analytics: {
    installPromptAnswered: (...args: unknown[]) => installPromptAnswered(...args),
    appInstalled: (...args: unknown[]) => appInstalled(...args),
  },
}));

import {
  captureInstallPrompt,
  getServerSnapshot,
  getSnapshot,
  promptInstall,
  subscribe,
  __resetInstallPromptForTest,
  type BeforeInstallPromptEvent,
} from "../installPrompt";

/** Build a fake Chromium `beforeinstallprompt` event and dispatch it. */
function fireBeforeInstallPrompt(
  outcome: "accepted" | "dismissed" = "accepted",
  prompt = vi.fn().mockResolvedValue(undefined),
) {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: "web" }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

describe("installPrompt store", () => {
  beforeEach(() => {
    __resetInstallPromptForTest();
    captureInstallPrompt();
  });

  afterEach(() => {
    __resetInstallPromptForTest();
    vi.clearAllMocks();
  });

  it("starts empty and reports no prompt on the server", () => {
    expect(getSnapshot()).toBe("none");
    expect(getServerSnapshot()).toBe("none");
  });

  it("parks beforeinstallprompt, suppresses the mini-infobar, and notifies subscribers", () => {
    const cb = vi.fn();
    subscribe(cb);
    const { event } = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(getSnapshot()).toBe("prompt");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("captureInstallPrompt is idempotent — a second call does not double-register", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    captureInstallPrompt();
    captureInstallPrompt();
    expect(addSpy).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("unsubscribe stops notifications", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    unsub();
    fireBeforeInstallPrompt();
    expect(cb).not.toHaveBeenCalled();
  });

  it("promptInstall returns unavailable when nothing is parked", async () => {
    await expect(promptInstall()).resolves.toBe("unavailable");
    expect(installPromptAnswered).not.toHaveBeenCalled();
  });

  it("promptInstall opens the dialog once, records acceptance, and flips to installed", async () => {
    const cb = vi.fn();
    subscribe(cb);
    let answer: (choice: { outcome: "accepted"; platform: string }) => void = () => {};
    const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
    const prompt = vi.fn().mockResolvedValue(undefined);
    Object.assign(event, {
      prompt,
      userChoice: new Promise((resolve) => {
        answer = resolve;
      }),
    });
    window.dispatchEvent(event);
    cb.mockClear();

    const first = promptInstall();
    // Dialog open: the store still reads "prompt" (an unrelated re-render
    // must not flip the card), and a double-tap must not reach prompt().
    await Promise.resolve();
    expect(getSnapshot()).toBe("prompt");
    await expect(promptInstall()).resolves.toBe("unavailable");
    expect(cb).not.toHaveBeenCalled();

    answer({ outcome: "accepted", platform: "web" });
    await expect(first).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe("installed");
    expect(installPromptAnswered).toHaveBeenCalledWith("accepted");
    // One notification, after the user answered — never mid-dialog.
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("promptInstall on dismissal drops back to none and records the answer", async () => {
    fireBeforeInstallPrompt("dismissed");
    await expect(promptInstall()).resolves.toBe("dismissed");
    expect(getSnapshot()).toBe("none");
    expect(installPromptAnswered).toHaveBeenCalledWith("dismissed");
  });

  it("promptInstall still notifies subscribers when the browser throws", async () => {
    const cb = vi.fn();
    subscribe(cb);
    fireBeforeInstallPrompt("accepted", vi.fn().mockRejectedValue(new Error("not a user gesture")));
    cb.mockClear();
    await expect(promptInstall()).rejects.toThrow("not a user gesture");
    expect(getSnapshot()).toBe("none");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(installPromptAnswered).not.toHaveBeenCalled();
  });

  it("appinstalled marks the store installed, clears the parked event, and tracks it", () => {
    const cb = vi.fn();
    subscribe(cb);
    fireBeforeInstallPrompt();
    window.dispatchEvent(new Event("appinstalled"));
    expect(getSnapshot()).toBe("installed");
    expect(appInstalled).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("reset detaches the window listeners", () => {
    __resetInstallPromptForTest();
    const cb = vi.fn();
    subscribe(cb);
    fireBeforeInstallPrompt();
    expect(getSnapshot()).toBe("none");
    expect(cb).not.toHaveBeenCalled();
    // Reset when nothing was captured is a no-op (covers the guard branch).
    __resetInstallPromptForTest();
  });
});
