import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("sw-cleanup", () => {
  it("keeps push and asset-cache workers that are still installing", async () => {
    const keepMessaging = vi.fn();
    const keepCache = vi.fn();
    const drop = vi.fn();
    const registrations = [
      {
        active: null,
        waiting: null,
        installing: { scriptURL: "https://skatehubba.com/firebase-messaging-sw.js?apiKey=1" },
        unregister: keepMessaging,
      },
      {
        active: { scriptURL: "https://skatehubba.com/asset-cache-sw.js" },
        unregister: keepCache,
      },
      {
        active: { scriptURL: "https://skatehubba.com/stale-sw.js" },
        unregister: drop,
      },
    ];
    const getRegistrations = vi.fn().mockResolvedValue(registrations);
    const original = navigator.serviceWorker;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistrations } });
    const source = readFileSync(resolve("public/sw-cleanup.js"), "utf8");
    window.eval(source);
    await Promise.resolve();
    expect(keepMessaging).not.toHaveBeenCalled();
    expect(keepCache).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: original });
  });
});
