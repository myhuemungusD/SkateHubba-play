/**
 * Native (iOS) record screen: the camera is drawn BEHIND the web view, so the
 * viewfinder has to be on screen and clear of the pinned action dock or the
 * skater sees the green camera dot with no picture. The setter's scoreboard
 * and trick picker, and the matcher's 55dvh setter clip, both used to leave it
 * below the fold. JSDOM has no layout, so the geometry of a 375x667 and a
 * 430x932 phone is stubbed onto the boxes the hook measures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GamePlayScreen } from "../GamePlayScreen";

const VIDEO_URL = "https://firebasestorage.googleapis.com/v0/b/test/o/video.webm";

vi.mock("../../services/games", () => ({
  setTrick: vi.fn(),
  failSetTrick: vi.fn(),
  submitMatchAttempt: vi.fn(),
  resolveDispute: vi.fn(),
  forfeitExpiredTurn: vi.fn(),
  callBSOnSetTrick: vi.fn(),
  judgeRuleSetTrick: vi.fn(),
  acceptJudgeInvite: vi.fn(),
  declineJudgeInvite: vi.fn(),
  acceptLanded: vi.fn(),
  isJudgeActive: () => false,
}));
vi.mock("../../services/disputes", () => ({
  raiseDispute: vi.fn(),
  canRaiseDispute: () => true,
  subscribeToGameDispute: () => vi.fn(),
}));
vi.mock("../../services/storage", () => ({ uploadVideo: vi.fn() }));
vi.mock("../../services/haptics", async () => {
  const actual = await vi.importActual<typeof import("../../services/haptics")>("../../services/haptics");
  return { ...actual, playHaptic: vi.fn() };
});

const mockOpenNativePreview = vi.fn();
const mockCloseNativePreview = vi.fn();
vi.mock("../../services/nativeVideo", async () => {
  const actual = await vi.importActual<typeof import("../../services/nativeVideo")>("../../services/nativeVideo");
  return {
    ...actual,
    isNativePlatform: () => true,
    openNativePreview: () => mockOpenNativePreview(),
    closeNativePreview: () => mockCloseNativePreview(),
    isNativePreviewLive: () => true,
    recordNativeVideo: () => new Promise(() => undefined),
  };
});

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

/** Fields that start empty on a fresh active game. */
const EMPTY_GAME_FIELDS = [
  "currentTrickName",
  "currentTrickVideoUrl",
  "matchVideoUrl",
  "winner",
  "createdAt",
  "updatedAt",
];

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(EMPTY_GAME_FIELDS.map((key) => [key, null])),
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    turnNumber: 1,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    ...overrides,
  } as any;
}

const SETTER = makeGame();
const MATCHER = makeGame({
  phase: "matching",
  currentSetter: "u2",
  currentTrickName: "Kickflip",
  currentTrickVideoUrl: VIDEO_URL,
});

function box(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // On for iPhone since #788 — the setter's recorder shows before a trick is picked.
  vi.stubEnv("VITE_FEATURE_TRICK_PICKER_ENABLED", "true");
  mockOpenNativePreview.mockResolvedValue(true);
  mockCloseNativePreview.mockResolvedValue(undefined);
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

/** Lay the page out as on a phone of `height`, with the viewfinder at `vfTop`. */
function phone(height: number, vfTop: number, dockTop: number) {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  const vfHeight = Math.round(height * 0.55);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("data-testid") === "trick-viewfinder") return box(vfTop, vfTop + vfHeight);
    if (this.classList.contains("action-dock")) return box(dockTop, height);
    return box(0, 0);
  });
}

describe.each([
  ["small phone 375x667", 667, 540],
  ["large phone 430x932", 932, 800],
])("GamePlayScreen native camera on a %s", (_name, height, dockTop) => {
  it.each([
    ["setter (scoreboard + trick picker above)", SETTER, Math.round(height * 0.7)],
    ["matcher (55dvh setter clip above)", MATCHER, Math.round(height * 0.9)],
  ])("brings the %s viewfinder on screen above the dock as the preview opens", async (_who, game, vfTop) => {
    phone(height, vfTop, dockTop);
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    // Live preview on entry — no tap.
    await screen.findByTestId("camera-crosshair");
    expect(mockOpenNativePreview).toHaveBeenCalled();
    const viewfinder = screen.getByTestId("trick-viewfinder");
    expect(viewfinder.className).toContain("bg-transparent");
    await waitFor(() => expect(viewfinder.parentElement?.classList.contains("sh-native-cam")).toBe(true));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: "end", behavior: "smooth" }));
    // Bottom edge lands 12px above the dock, whatever the phone.
    expect(viewfinder.style.scrollMarginBottom).toBe(`${height - dockTop + 12}px`);
  });
});

it("leaves the setter's page alone when the viewfinder already shows", async () => {
  phone(932, 120, 800);
  render(<GamePlayScreen game={SETTER} profile={profile} onBack={vi.fn()} />);
  await screen.findByTestId("camera-crosshair");
  expect(scrollSpy).not.toHaveBeenCalled();
});

it("lets go of the camera when the record screen closes", async () => {
  phone(667, 100, 540);
  const view = render(<GamePlayScreen game={MATCHER} profile={profile} onBack={vi.fn()} />);
  await screen.findByTestId("camera-crosshair");
  view.unmount();
  expect(mockCloseNativePreview).toHaveBeenCalled();
});
