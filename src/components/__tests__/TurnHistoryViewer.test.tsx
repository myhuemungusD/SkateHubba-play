import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnHistoryViewer } from "../TurnHistoryViewer";
import type { TurnRecord } from "../../services/games";
import { Capacitor } from "@capacitor/core";

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url.startsWith("https://firebasestorage.googleapis.com/"),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
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

  it("hides download buttons in the iOS app but keeps share", () => {
    const spy = vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload showShare />);
    expect(screen.queryByText("Save clip")).not.toBeInTheDocument();
    expect(screen.getAllByText("Share clip")).toHaveLength(2);
    spy.mockRestore();
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
    expect(writeText).toHaveBeenCalled();

    Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  it("share button attaches the downloaded clip when Web Share Level 2 is available", async () => {
    const share = stubLevel2Share();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["vid"])),
    } as Response);

    await clickShareAndWait();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }));
    // An untyped blob is shared as mp4, not the old hardcoded webm.
    const [file] = (share.mock.calls[0][0] as { files: File[] }).files;
    expect(file.name).toMatch(/\.mp4$/);
    expect(file.type).toBe("video/mp4");

    unstubLevel2Share();
  });

  it("saves an mp4 turn clip with a .mp4 name", async () => {
    const mockBlob = new Blob(["video"], { type: "video/mp4" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(mockBlob) } as Response);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => expect(screen.getByText("Saved!")).toBeInTheDocument());
    expect(names).toEqual(["skatehubba-round1-set.mp4"]);

    vi.restoreAllMocks();
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
