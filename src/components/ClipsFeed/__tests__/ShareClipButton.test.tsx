import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareClipButton } from "../ShareClipButton";
import { trackEvent } from "../../../services/analytics";
import { shareText, type ShareTextOptions } from "../../../services/nativeBridge";
import { captureException } from "../../../lib/sentry";
import { makeGameClip } from "../../__tests__/clipFixtures.test-helpers";

vi.mock("../../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../../services/nativeBridge", async (importOriginal) => ({
  isShareCancel: (await importOriginal<typeof import("../../../services/nativeBridge")>()).isShareCancel,
  shareText: vi.fn(),
}));
vi.mock("../../../lib/sentry", () => ({ captureException: vi.fn() }));

const TOKEN_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm?alt=media&token=secret-token";
const clip = makeGameClip({ playerUid: "uid-alice", playerUsername: "alice", trickName: "50/50", videoUrl: TOKEN_URL });

function lastShareOptions(): ShareTextOptions {
  return vi.mocked(shareText).mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ShareClipButton", () => {
  it("shares a link to another player's profile, never their video file", async () => {
    vi.mocked(shareText).mockResolvedValue("native_share_text");
    render(<ShareClipButton clip={clip} isOwnClip={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Share @alice's 50/50" }));

    const opts = lastShareOptions();
    expect(opts.title).toBe("SkateHubba — 50/50");
    expect(opts.text).toMatch(/^Check out @alice's 50\/50 on SkateHubba!\nhttps?:\/\/.+\/player\/uid-alice$/);
    expect(opts.nativeFile).toBeUndefined();
    expect(opts.loadFiles).toBeUndefined();
    expect(JSON.stringify(opts)).not.toContain("secret-token");
    expect(await screen.findByRole("button", { name: "Clip shared" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Clip shared");
  });

  it("logs the method and context only: no uid, username or URL", async () => {
    vi.mocked(shareText).mockResolvedValue("clipboard");
    render(<ShareClipButton clip={clip} isOwnClip={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Share @alice's 50/50" }));

    expect(trackEvent).toHaveBeenCalledWith("clip_shared", { method: "clipboard", context: "feed", own: false });
    const props = JSON.stringify(vi.mocked(trackEvent).mock.calls);
    expect(props).not.toMatch(/alice|uid-alice|secret-token|http/);
  });

  it("shares your own clip as the video file, with a text fallback", async () => {
    vi.mocked(shareText).mockResolvedValue("native_share");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["v"], { type: "video/mp4" })) }),
    );
    render(<ShareClipButton clip={clip} isOwnClip />);

    await userEvent.click(screen.getByRole("button", { name: "Share your 50/50" }));

    const opts = lastShareOptions();
    expect(opts.text).toBe("Check out my 50/50 on SkateHubba!");
    expect(opts.textWithoutFiles).toMatch(/^Check out my 50\/50 on SkateHubba!\nhttps?:\/\//);
    expect(opts.nativeFile).toEqual({ url: TOKEN_URL, filename: "skatehubba-50/50.webm" });
    const files = await opts.loadFiles!();
    expect(fetch).toHaveBeenCalledWith(TOKEN_URL);
    expect(files[0].name).toBe("skatehubba-50/50.mp4");
    expect(files[0].type).toBe("video/mp4");
    expect(trackEvent).toHaveBeenCalledWith("clip_shared", { method: "native_share", context: "feed", own: true });
  });

  it("rejects loadFiles when the clip download fails, so the bridge falls back to text", async () => {
    vi.mocked(shareText).mockResolvedValue("native_share_text");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<ShareClipButton clip={clip} isOwnClip />);

    await userEvent.click(screen.getByRole("button", { name: "Share your 50/50" }));

    await expect(lastShareOptions().loadFiles!()).rejects.toThrow("Fetch failed");
  });

  it("locks the button while the sheet is open", async () => {
    let finish: (m: "native_share_text") => void = () => {};
    vi.mocked(shareText).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ShareClipButton clip={clip} isOwnClip={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Share @alice's 50/50" }));
    expect(screen.getByRole("button", { name: "Sharing clip" })).toBeDisabled();

    await act(async () => finish("native_share_text"));
    expect(screen.getByRole("button", { name: "Clip shared" })).toBeEnabled();
  });

  it("goes quietly back to idle when the sheet is closed", async () => {
    vi.mocked(shareText).mockRejectedValue(new Error("Share canceled"));
    render(<ShareClipButton clip={clip} isOwnClip={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Share @alice's 50/50" }));

    expect(await screen.findByRole("button", { name: "Share @alice's 50/50" })).toBeEnabled();
    expect(captureException).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("reports a real failure without the clip URL, then resets after 2s", async () => {
    vi.mocked(shareText).mockRejectedValue(new Error("boom"));
    render(<ShareClipButton clip={clip} isOwnClip />);

    await userEvent.click(screen.getByRole("button", { name: "Share your 50/50" }));

    expect(await screen.findByRole("button", { name: "Share failed. Tap to try again" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Share failed");
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ShareClipButton", own: true },
    });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toContain("secret-token");

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Share your 50/50" })).toBeInTheDocument();
  });

  it("restarts the reset timer on a second share and clears it on unmount", async () => {
    vi.mocked(shareText).mockResolvedValue("native_share_text");
    const { unmount } = render(<ShareClipButton clip={clip} isOwnClip={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Share @alice's 50/50" }));
    act(() => vi.advanceTimersByTime(1500));
    await userEvent.click(screen.getByRole("button", { name: "Clip shared" }));
    act(() => vi.advanceTimersByTime(1500));
    // The second share restarted the 2s window, so it still reads "shared".
    expect(screen.getByRole("button", { name: "Clip shared" })).toBeInTheDocument();

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("unmounts cleanly before any share", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<ShareClipButton clip={clip} isOwnClip={false} />);
    unmount();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
