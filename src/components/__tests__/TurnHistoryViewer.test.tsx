import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnHistoryViewer } from "../TurnHistoryViewer";
import type { TurnRecord } from "../../services/games";
import { captureException } from "../../lib/sentry";

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url.startsWith("https://firebasestorage.googleapis.com/"),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sentry")>()),
  captureException: vi.fn(),
}));

const makeTurn = (n: number, overrides?: Partial<TurnRecord>): TurnRecord => ({
  turnNumber: n,
  trickName: `Kickflip ${n}`,
  setterUid: "u1",
  setterUsername: "alice",
  matcherUid: "u2",
  matcherUsername: "bob",
  setVideoUrl: `https://firebasestorage.googleapis.com/set${n}.webm`,
  matchVideoUrl: `https://firebasestorage.googleapis.com/match${n}.webm`,
  landed: true,
  letterTo: null,
  ...overrides,
});

function stubLevel2Share() {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true, writable: true });
  return share;
}

function unstubLevel2Share() {
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
  vi.restoreAllMocks();
}

async function clickShareAndWait() {
  render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
  await userEvent.click(screen.getAllByText("Share clip")[0]);
  await waitFor(() => expect(screen.getByText("Shared!")).toBeInTheDocument());
}

describe("TurnHistoryViewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when turns is empty", () => {
    const { container } = render(<TurnHistoryViewer turns={[]} currentUserUid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders collapsed by default with correct count", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1), makeTurn(2)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (2 rounds)")).toBeInTheDocument();
    // Turns should not be visible
    expect(screen.queryByText("Kickflip 1")).not.toBeInTheDocument();
  });

  it("uses singular 'round' for 1 turn", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (1 round)")).toBeInTheDocument();
  });

  it("expands on button click to show turns", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    await userEvent.click(screen.getByText("Game Clips (1 round)"));
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
    expect(screen.getByText("Landed")).toBeInTheDocument();
    expect(screen.getByText(/@alice's trick/)).toBeInTheDocument();
    expect(screen.getByText(/@bob's attempt/)).toBeInTheDocument();
  });

  it("renders expanded by default when defaultExpanded is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
  });

  it("shows Missed badge and letter info", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u2" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText(/@bob gets a letter/)).toBeInTheDocument();
  });

  it("shows (you) when letter is to current user", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u1", matcherUid: "u1", matcherUsername: "me" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText(/(you)/)).toBeInTheDocument();
  });

  it("collapses on second toggle click", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    await userEvent.click(toggle);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText("Round 1: Kickflip 1")).not.toBeInTheDocument();
  });

  it("has aria-expanded attribute on toggle button", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders video elements with aria labels when expanded", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByLabelText("Kickflip 1 set by alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Kickflip 1 attempted by bob")).toBeInTheDocument();
  });

  it("skips ClipVideo for non-firebase URLs", () => {
    const turn = makeTurn(1, { setVideoUrl: "https://example.com/v.webm", matchVideoUrl: "" });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    // Non-firebase URLs return null from ClipVideo
    expect(screen.queryByLabelText(/Kickflip 1 set by/)).not.toBeInTheDocument();
  });

  it("shows download buttons when showDownload is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    const saveButtons = screen.getAllByText("Save clip");
    expect(saveButtons.length).toBe(2); // one for set, one for match
  });

  it("shows share buttons when showShare is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
    const shareButtons = screen.getAllByText("Share clip");
    expect(shareButtons.length).toBe(2);
  });

  it("download button transitions through saving states", async () => {
    const mockBlob = new Blob(["video"], { type: "video/webm" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(mockBlob) } as Response);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Saved!")).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it("download button shows failure on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeInTheDocument();
    });
    // The token-bearing download URL never reaches Sentry.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "DownloadBtn", filename: "skatehubba-round1-set.webm" },
    });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toContain("firebasestorage");

    vi.restoreAllMocks();
  });

  it("share button uses clipboard when navigator.share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origShare = navigator.share;
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["vid"])),
    } as Response);

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
    await userEvent.click(screen.getAllByText("Share clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Shared!")).toBeInTheDocument();
    });
    // No file share: the copied text links to the setter's profile (the clip's owner), not the app root.
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^Check out my Kickflip 1 on SkateHubba!\n.+\/player\/u1$/),
    );

    await userEvent.click(screen.getAllByText("Share clip")[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    // The matcher's clip links to the matcher.
    expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/\/player\/u2$/));

    Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  it("save and share labels reset after 2s, the blob URL is revoked after 10s, and unmount clears pending resets", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["vid"])),
      } as Response);
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
      const clear = vi.spyOn(globalThis, "clearTimeout");

      const { unmount } = render(
        <TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload showShare />,
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getAllByText("Save clip")[0]);
      await screen.findByText("Saved!");
      // A second save before the reset fires replaces the pending reset.
      await user.click(screen.getByText("Saved!"));
      await waitFor(() => expect(screen.getAllByText("Saved!")).toHaveLength(1));
      await user.click(screen.getAllByText("Share clip")[0]);
      await screen.findByText("Shared!");

      vi.advanceTimersByTime(2000);
      await waitFor(() => expect(screen.queryByText("Saved!")).not.toBeInTheDocument());
      expect(screen.queryByText("Shared!")).not.toBeInTheDocument();
      vi.advanceTimersByTime(8000);
      expect(revoke).toHaveBeenCalledWith("blob:test");

      await user.click(screen.getAllByText("Save clip")[0]);
      await user.click(screen.getAllByText("Share clip")[0]);
      await screen.findByText("Shared!");
      clear.mockClear();
      unmount();
      expect(clear.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("download button shows failure on a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("offers save and share only for the clip that exists when the set clip is missing", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { setVideoUrl: "" })]}
        currentUserUid="u1"
        defaultExpanded
        showDownload
        showShare
      />,
    );
    expect(screen.getAllByText("Save clip")).toHaveLength(1);
    expect(screen.getAllByText("Share clip")).toHaveLength(1);
  });

  it("share failure is reported without the clip's download URL", async () => {
    const failure = new Error("No activity found");
    const share = vi.fn().mockRejectedValue(failure);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
    await userEvent.click(screen.getAllByText("Share clip")[0]);

    expect(await screen.findByText("Share failed")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(failure, { extra: { context: "ShareBtn", trickName: "Kickflip 1" } });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toContain("firebasestorage");

    delete (navigator as { share?: unknown }).share;
  });

  it("share button attaches the downloaded clip when Web Share Level 2 is available", async () => {
    const share = stubLevel2Share();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["vid"])),
    } as Response);

    await clickShareAndWait();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }));

    unstubLevel2Share();
  });

  it("share button falls back to text when the clip download fails", async () => {
    const share = stubLevel2Share();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);

    await clickShareAndWait();
    expect(share).toHaveBeenCalledWith(expect.not.objectContaining({ files: expect.anything() }));

    unstubLevel2Share();
  });

  it("shows letter recipient as setter when letterTo is setterUid (not matcherUid)", () => {
    // letterTo !== matcherUid means the setter gets the letter
    const turn = makeTurn(1, {
      landed: false,
      letterTo: "u1",
      setterUid: "u1",
      setterUsername: "alice",
      matcherUid: "u2",
      matcherUsername: "bob",
    });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u2" defaultExpanded />);
    // Since letterTo ("u1") !== matcherUid ("u2"), it shows setter's name
    expect(screen.getByText(/@alice gets a letter/)).toBeInTheDocument();
  });

  // ── Referee indicator tests ──

  it("shows 'Refereed' indicator when turn has judgedBy set", () => {
    const turn = makeTurn(1, { judgedBy: "judge-uid" });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByText("Refereed")).toBeInTheDocument();
  });

  it("hides 'Refereed' indicator when turn has no judgedBy", () => {
    const turn = makeTurn(1, { judgedBy: null });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.queryByText("Refereed")).not.toBeInTheDocument();
  });

  it("hides 'Refereed' indicator when judgedBy is undefined (honor system)", () => {
    const turn = makeTurn(1);
    // Default makeTurn doesn't set judgedBy (undefined)
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.queryByText("Refereed")).not.toBeInTheDocument();
  });
});
