import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipShareButtons } from "../waiting/ClipShareButtons";
import { trackEvent } from "../../services/analytics";
import { shareText } from "../../services/nativeBridge";
import { Capacitor } from "@capacitor/core";
import { captureException } from "../../lib/sentry";

vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../services/nativeBridge", async (importOriginal) => ({
  isShareCancel: (await importOriginal<typeof import("../../services/nativeBridge")>()).isShareCancel,
  shareText: vi.fn(),
}));
vi.mock("../../lib/sentry", () => ({ captureException: vi.fn() }));

// Real download URLs carry a Storage access token.
const TOKEN_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm?alt=media&token=secret-token";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["v"], { type: "video/webm" })) }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ClipShareButtons", () => {
  it("hides Save in the iOS app, where downloads silently do nothing, and keeps Share", () => {
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);
    expect(screen.queryByText("Save Clip")).not.toBeInTheDocument();
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows Save on the web", () => {
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
  });

  it("reports the method the bridge used and resets the label after 2s", async () => {
    vi.mocked(shareText).mockResolvedValue("clipboard");
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Shared!")).toBeInTheDocument();
    expect(shareText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Check out my Kick Flip on SkateHubba!",
        textWithoutFiles: expect.stringContaining("Check out my Kick Flip on SkateHubba!\n"),
        // The iOS app shares the video file itself.
        nativeFile: { url: "https://cdn/clip.webm", filename: "skatehubba-kick-flip.webm" },
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("clip_shared", { method: "clipboard", context: "waiting_screen" });

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("shows a failure label and reports when the share really fails", async () => {
    vi.mocked(shareText).mockRejectedValue(new Error("No activity found"));
    render(<ClipShareButtons videoUrl={TOKEN_URL} trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Share failed")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ClipShareButtons.share", trickName: "Kick Flip" },
    });
    // The token-bearing download URL never reaches Sentry.
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toMatch(/secret-token|firebasestorage/);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it.each([
    ["web Share AbortError", new DOMException("Share canceled", "AbortError")],
    ["iOS/Android plugin cancel", new Error("Share canceled")],
    ["plugin cancel as a plain object", { message: "Share cancelled", code: "UNKNOWN" }],
  ])("returns to idle with no failure and no report when the user closes the sheet (%s)", async (_label, err) => {
    vi.mocked(shareText).mockRejectedValue(err);
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Share Clip")).toBeEnabled();
    expect(screen.queryByText("Share failed")).not.toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("shares an mp4 clip as .mp4 with its real type", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["v"], { type: "video/mp4" })),
    } as unknown as Response);
    vi.mocked(shareText).mockResolvedValue("native_share");
    render(<ClipShareButtons videoUrl="https://cdn/clip.mp4" trickName="Tre Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));
    await screen.findByText("Shared!");

    const { loadFiles } = vi.mocked(shareText).mock.calls[0][0] as { loadFiles: () => Promise<File[]> };
    const [file] = await loadFiles();
    expect(file.name).toBe("skatehubba-tre-flip.mp4");
    expect(file.type).toBe("video/mp4");

    // A failed clip download rejects, so the bridge degrades to a text share.
    vi.mocked(fetch).mockResolvedValue({ ok: false } as unknown as Response);
    await expect(loadFiles()).rejects.toThrow("Fetch failed");
  });

  it("saves with the matching extension and defaults an untyped blob to mp4", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["v"])),
    } as unknown as Response);
    const createObjectURL = vi.fn((b: Blob) => `blob:${b.type}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("skatehubba-tre-flip.mp4");
    });
    render(<ClipShareButtons videoUrl="https://cdn/clip" trickName="Tre Flip" />);

    await userEvent.click(screen.getByText("Save Clip"));

    expect(await screen.findByText("Saved!")).toBeInTheDocument();
    expect(click).toHaveBeenCalled();
    expect(createObjectURL.mock.calls[0][0].type).toBe("video/mp4");
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(8000));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:video/mp4");
    click.mockRestore();
  });

  it("shows a failure label and reports when the download fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as unknown as Response);
    render(<ClipShareButtons videoUrl={TOKEN_URL} trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Save Clip"));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ClipShareButtons.save", trickName: "Kick Flip" },
    });
    // The token-bearing download URL never reaches Sentry.
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toMatch(/secret-token|firebasestorage/);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
  });

  it("keeps a webm clip as .webm", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("skatehubba-kick-flip.webm");
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Save Clip"));

    expect(await screen.findByText("Saved!")).toBeInTheDocument();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
