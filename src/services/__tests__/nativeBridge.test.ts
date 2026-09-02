import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock @capacitor/core ─────────────────────── */

const mockIsNativePlatform = vi.hoisted(() => vi.fn().mockReturnValue(false));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNativePlatform(), getPlatform: () => "web" },
}));

/* ── mock the three plugins ───────────────────────
 * Each plugin is exposed through a getter so a test can make the dynamic
 * `import()` reject (simulating a plugin that failed to load in the shell)
 * by flipping a flag, without resetting the module registry. */

const { mockShare, mockClipboardWrite, mockGetStatus, mockNetAddListener, mockRemove, failImport } = vi.hoisted(() => ({
  mockShare: vi.fn().mockResolvedValue(undefined),
  mockClipboardWrite: vi.fn().mockResolvedValue(undefined),
  mockGetStatus: vi.fn(),
  mockNetAddListener: vi.fn(),
  mockRemove: vi.fn().mockResolvedValue(undefined),
  failImport: { share: false, clipboard: false, network: false },
}));

function guard<T>(key: keyof typeof failImport, value: T): T {
  if (failImport[key]) throw new Error(`${key} plugin unavailable`);
  return value;
}

vi.mock("@capacitor/share", () => ({
  get Share() {
    return guard("share", { share: mockShare });
  },
}));
vi.mock("@capacitor/clipboard", () => ({
  get Clipboard() {
    return guard("clipboard", { write: mockClipboardWrite });
  },
}));
vi.mock("@capacitor/network", () => ({
  get Network() {
    return guard("network", { getStatus: mockGetStatus, addListener: mockNetAddListener });
  },
}));

/* ── mock logger ──────────────────────────────── */

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({
  logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  isShareAvailable,
  shareText,
  shareUrl,
  copyText,
  getNetworkSnapshot,
  subscribeToNetworkStatus,
} from "../nativeBridge";

/* ── helpers ──────────────────────────────────── */

/** Replace a navigator member for the duration of a test. */
function setNavigator(key: string, value: unknown): void {
  Object.defineProperty(navigator, key, { value, writable: true, configurable: true });
}

function stubWebShare(canShare?: (data: { files?: File[] }) => boolean): ReturnType<typeof vi.fn> {
  const share = vi.fn().mockResolvedValue(undefined);
  setNavigator("share", share);
  setNavigator("canShare", canShare);
  return share;
}

const FILE = new File(["x"], "clip.webm", { type: "video/webm" });
const CLIP = { title: "SkateHubba — kickflip", text: "clip", files: [FILE], textWithoutFiles: "clip\nhttps://a" };

/** Flush the microtasks the native network subscription chain queues. */
async function flush(): Promise<void> {
  // Two macrotask hops: the dynamic import() settles on its own tick before
  // the getStatus() / addListener() chain runs.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(false);
  failImport.share = false;
  failImport.clipboard = false;
  failImport.network = false;
  mockGetStatus.mockResolvedValue({ connected: true });
  mockNetAddListener.mockResolvedValue({ remove: mockRemove });
});

afterEach(() => {
  setNavigator("share", undefined);
  setNavigator("canShare", undefined);
  setNavigator("onLine", true);
});

/* ── isShareAvailable ─────────────────────────── */

describe("isShareAvailable", () => {
  it("is always true on native, even without navigator.share", () => {
    mockIsNativePlatform.mockReturnValue(true);
    expect(isShareAvailable()).toBe(true);
  });

  it("mirrors navigator.share on web", () => {
    expect(isShareAvailable()).toBe(false);
    stubWebShare();
    expect(isShareAvailable()).toBe(true);
  });
});

/* ── shareText ────────────────────────────────── */

describe("shareText on native", () => {
  beforeEach(() => mockIsNativePlatform.mockReturnValue(true));

  it("shares text + url through the Share plugin, ignoring files", async () => {
    await expect(shareText({ ...CLIP, url: "https://a" })).resolves.toBe("native_share_text");
    expect(mockShare).toHaveBeenCalledWith({
      title: "SkateHubba — kickflip",
      text: "clip\nhttps://a",
      url: "https://a",
    });
  });

  it("omits absent title and url", async () => {
    await shareText({ text: "hello" });
    expect(mockShare).toHaveBeenCalledWith({ text: "hello" });
  });

  it("propagates a cancelled/failed share", async () => {
    mockShare.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(shareText({ text: "hello" })).rejects.toThrow("Share canceled");
  });

  it("warns and falls back to the web chain when the plugin is unavailable", async () => {
    failImport.share = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });

    await expect(shareText({ text: "hello", textWithoutFiles: "hello link" })).resolves.toBe("clipboard");
    expect(mockWarn).toHaveBeenCalledWith("native_share_unavailable", expect.any(Object));
    expect(writeText).toHaveBeenCalledWith("hello link");
  });
});

describe("shareText on web", () => {
  it("shares the file when Web Share Level 2 accepts it", async () => {
    const share = stubWebShare(() => true);
    await expect(shareText({ ...CLIP, url: "https://a" })).resolves.toBe("native_share");
    expect(share).toHaveBeenCalledWith({
      title: "SkateHubba — kickflip",
      text: "clip",
      url: "https://a",
      files: [FILE],
    });
  });

  it("omits absent title and url on both web branches", async () => {
    const share = stubWebShare(() => true);
    await shareText({ text: "clip", files: [FILE] });
    expect(share).toHaveBeenCalledWith({ text: "clip", files: [FILE] });

    stubWebShare(() => false);
    await shareText({ text: "clip", files: [FILE] });
    expect(navigator.share).toHaveBeenLastCalledWith({ text: "clip" });
  });

  it("falls back to text when the file cannot be shared", async () => {
    const share = stubWebShare(() => false);
    await expect(shareText(CLIP)).resolves.toBe("native_share_text");
    expect(share).toHaveBeenCalledWith({ title: "SkateHubba — kickflip", text: "clip\nhttps://a" });
  });

  it("falls back to text when canShare is unimplemented", async () => {
    const share = stubWebShare();
    await expect(shareText(CLIP)).resolves.toBe("native_share_text");
    expect(share).toHaveBeenCalledWith({ title: "SkateHubba — kickflip", text: "clip\nhttps://a" });
  });

  it("copies to the clipboard when Web Share is unsupported", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await expect(shareText(CLIP)).resolves.toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("clip\nhttps://a");
  });

  it("shareUrl shares the plain text and url", async () => {
    const share = stubWebShare();
    await expect(shareUrl({ title: "SkateHubba", text: "join me", url: "https://a" })).resolves.toBe(
      "native_share_text",
    );
    expect(share).toHaveBeenCalledWith({ title: "SkateHubba", text: "join me", url: "https://a" });
  });
});

/* ── copyText ─────────────────────────────────── */

describe("copyText", () => {
  it("uses navigator.clipboard on web", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await copyText("hi");
    expect(writeText).toHaveBeenCalledWith("hi");
    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it("uses the Clipboard plugin on native", async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await copyText("hi");
    expect(mockClipboardWrite).toHaveBeenCalledWith({ string: "hi" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("warns and falls back to navigator.clipboard when the plugin fails", async () => {
    mockIsNativePlatform.mockReturnValue(true);
    failImport.clipboard = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator("clipboard", { writeText });
    await copyText("hi");
    expect(mockWarn).toHaveBeenCalledWith("native_clipboard_failed", expect.any(Object));
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it("rejects when the web clipboard rejects", async () => {
    setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await expect(copyText("hi")).rejects.toThrow("denied");
  });
});

/* ── network status ───────────────────────────── */

describe("network status on web", () => {
  it("reports navigator.onLine and re-notifies on window events", () => {
    const cb = vi.fn();
    const unsub = subscribeToNetworkStatus(cb);

    setNavigator("onLine", false);
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getNetworkSnapshot()).toBe(false);

    setNavigator("onLine", true);
    window.dispatchEvent(new Event("online"));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(getNetworkSnapshot()).toBe(true);

    unsub();
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("network status on native", () => {
  beforeEach(() => mockIsNativePlatform.mockReturnValue(true));

  it("seeds from the plugin and tracks change events, ignoring navigator.onLine", async () => {
    setNavigator("onLine", true);
    mockGetStatus.mockResolvedValue({ connected: false });
    const cb = vi.fn();
    const unsub = subscribeToNetworkStatus(cb);
    await flush();

    expect(getNetworkSnapshot()).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);

    const handler = mockNetAddListener.mock.calls[0][1] as (s: { connected: boolean }) => void;
    handler({ connected: true });
    expect(getNetworkSnapshot()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    await flush();
    expect(mockRemove).toHaveBeenCalled();
    // Cache cleared — navigator.onLine is authoritative again.
    expect(getNetworkSnapshot()).toBe(true);
    unsub();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing listener removal", async () => {
    mockRemove.mockRejectedValueOnce(new Error("already removed"));
    const unsub = subscribeToNetworkStatus(vi.fn());
    await flush();
    unsub();
    await expect(flush()).resolves.toBeUndefined();
  });

  it("skips registration when unsubscribed before the plugin responds", async () => {
    const cb = vi.fn();
    const unsub = subscribeToNetworkStatus(cb);
    unsub();
    await flush();

    expect(cb).not.toHaveBeenCalled();
    expect(mockNetAddListener).not.toHaveBeenCalled();
  });

  it("warns when the plugin is unavailable and leaves the web snapshot in place", async () => {
    failImport.network = true;
    setNavigator("onLine", false);
    const cb = vi.fn();
    const unsub = subscribeToNetworkStatus(cb);
    await flush();

    expect(mockWarn).toHaveBeenCalledWith("network_listener_failed", expect.any(Object));
    expect(getNetworkSnapshot()).toBe(false);
    unsub();
    await flush();
  });
});
