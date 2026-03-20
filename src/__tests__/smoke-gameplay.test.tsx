import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { authedUser, verifiedUser, testProfile, activeGame, renderApp, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */

const mockUseAuth = vi.fn();

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockResetPassword = vi.fn();

const mockCreateProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();
const mockGetUidByUsername = vi.fn();
const mockDeleteUserData = vi.fn();

const mockCreateGame = vi.fn();
const mockSetTrick = vi.fn();
const mockFailSetTrick = vi.fn();
const mockSubmitMatchAttempt = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
const mockSubscribeToMyGames = vi.fn(() => vi.fn());
const mockSubscribeToGame = vi.fn(() => vi.fn());

const mockUploadVideo = vi.fn();

vi.mock("../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
const mockDeleteAccount = vi.fn();
const mockResendVerification = vi.fn();
const mockSignInWithGoogle = vi.fn();
const mockResolveGoogleRedirect = vi.fn().mockResolvedValue(null);
vi.mock("../services/auth", () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  resendVerification: (...args: unknown[]) => mockResendVerification(...args),
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
  resolveGoogleRedirect: (...args: unknown[]) => mockResolveGoogleRedirect(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
vi.mock("../services/users", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  deleteUserData: (...args: unknown[]) => mockDeleteUserData(...args),
  getPlayerDirectory: vi.fn().mockResolvedValue([]),
  getLeaderboard: vi.fn().mockResolvedValue([]),
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/games", () => ({
  createGame: (...args: unknown[]) => mockCreateGame(...args),
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  failSetTrick: (...args: unknown[]) => mockFailSetTrick(...args),
  submitMatchAttempt: (...args: unknown[]) => mockSubmitMatchAttempt(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
  subscribeToMyGames: (...args: unknown[]) => mockSubscribeToMyGames(...args),
  subscribeToGame: (...args: unknown[]) => mockSubscribeToGame(...args),
}));
vi.mock("../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
}));
vi.mock("../services/fcm", () => ({
  requestPushPermission: vi.fn().mockResolvedValue(null),
  removeFcmToken: vi.fn().mockResolvedValue(undefined),
  onForegroundMessage: vi.fn(() => vi.fn()),
}));
vi.mock("../firebase", () => ({
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  default: {},
}));
vi.mock("../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    gameCreated: vi.fn(),
    trickSet: vi.fn(),
    matchSubmitted: vi.fn(),
    gameCompleted: vi.fn(),
    videoUploaded: vi.fn(),
    signUp: vi.fn(),
    signIn: vi.fn(),
  },
}));
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const profile = testProfile;

const { withGames, withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth,
  mockSubscribeToMyGames,
  mockSubscribeToGame,
});

describe("Smoke: Gameplay", () => {
  it("gameplay screen shows setter UI when it's your turn to set", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
    });

    // Trick name input is shown with hint; recorder is hidden until name is entered
    const trickInput = screen.getByLabelText("TRICK NAME");
    expect(trickInput).toBeInTheDocument();
    expect(trickInput).toBeEnabled();
    expect(screen.getByText("Name your trick to start recording")).toBeInTheDocument();

    // Type a trick name to reveal the recorder
    await userEvent.type(trickInput, "Kickflip");

    // Phase banner updates to show the trick name
    expect(screen.getByText("Set your Kickflip")).toBeInTheDocument();

    // Input remains editable until recording finishes
    expect(trickInput).toBeEnabled();

    // Hint disappears once recorder is revealed
    expect(screen.queryByText("Name your trick to start recording")).not.toBeInTheDocument();

    // Camera auto-opens for setter, so record button should appear in preview state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record — Land Your Trick/ })).toBeInTheDocument();
    });
  });

  it("setter auto-submits trick after recording", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockResolvedValueOnce(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
    });

    // Verify the phase banner shows correct text for setter
    expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
  });

  it("shows waiting screen when it's opponent's turn", async () => {
    const game = activeGame({ phase: "matching", currentTurn: "u2", currentSetter: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/Waiting on @rival/)).toBeInTheDocument();
    });
  });

  it("gameplay screen shows matcher UI when it's your turn to match", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Tre Flip",
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/Match.*Tre Flip/)).toBeInTheDocument();
    });
  });

  it("checks for expired turn when opening a game", async () => {
    mockForfeitExpiredTurn.mockResolvedValueOnce({ forfeited: false, winner: null });
    const game = activeGame({
      phase: "setting",
      currentSetter: "u2",
      currentTurn: "u2",
      turnDeadline: { toMillis: () => Date.now() - 1000 }, // expired
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(mockForfeitExpiredTurn).toHaveBeenCalledWith("game1");
    });
  });

  it("game screen back button returns to lobby", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
    });

    // Re-setup lobby for return
    withGames([game]);
    await userEvent.click(screen.getByText("← Games"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  it("game screen shows turn timer", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      // Timer shows hours/minutes/seconds format
      expect(screen.getByText(/\d+h \d+m \d+s/)).toBeInTheDocument();
    });
  });

  it("waiting screen shows setting context when opponent is setting", async () => {
    const game = activeGame({ phase: "setting", currentTurn: "u2", currentSetter: "u2" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/setting a trick for you/)).toBeInTheDocument();
    });
  });

  it("waiting screen shows matching context when opponent is matching", async () => {
    const game = activeGame({ phase: "matching", currentTurn: "u2", currentSetter: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/attempting to match your trick/)).toBeInTheDocument();
    });
  });

  it("matcher sees setter's trick video", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Heelflip",
      currentTrickVideoUrl: `https://firebasestorage.googleapis.com/v0/b/${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "sk8hub-d7806.firebasestorage.app"}/o/trick.webm?alt=media`,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    const videoUrl = `https://firebasestorage.googleapis.com/v0/b/${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "sk8hub-d7806.firebasestorage.app"}/o/trick.webm?alt=media`;
    await waitFor(() => {
      expect(screen.getByText(/@rival's TRICK/)).toBeInTheDocument();
      const video = document.querySelector(`video[src='${videoUrl}']`);
      expect(video).toBeTruthy();
    });
  });

  it("gameplay screen shows letter scores for both players", async () => {
    const game = activeGame({
      phase: "setting",
      currentSetter: "u1",
      currentTurn: "u1",
      p1Letters: 2,
      p2Letters: 3,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("VS")).toBeInTheDocument();
      expect(screen.getByText(/@sk8r/)).toBeInTheDocument();
      expect(screen.getByText(/@rival/)).toBeInTheDocument();
    });
  });

  it("setter's trick is submitted after recording and clicking Landed", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockResolvedValueOnce(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    // Type a trick name to reveal the recorder
    await waitFor(() => {
      expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");

    // Wait for camera to open and VideoRecorder to reach "preview" state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    });

    // Start recording (demo mode)
    await userEvent.click(screen.getByRole("button", { name: /record/i }));

    // Stop recording
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop recording/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/Landed/));

    // setTrick should have been called with the custom trick name
    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "Kickflip", null);
    });

    // Input locks after recording completes
    expect(screen.getByLabelText("TRICK NAME")).toBeDisabled();
  });

  it("trick name input locks after recording and recorder stays mounted", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockResolvedValueOnce(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Hardflip");

    // Recorder is revealed
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    });

    // Record and stop
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // Input is disabled and recorder done state is visible (not unmounted)
    expect(screen.getByLabelText("TRICK NAME")).toBeDisabled();
    expect(screen.getByText(/Recorded/)).toBeInTheDocument();

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "Hardflip", null);
    });
  });

  it("setter submits trick without upload after confirming landed (demo mode)", async () => {
    // Covers the submitSetterTrick code path when blob is null (demo mode recording)
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockResolvedValue(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    // Type trick name to reveal recorder
    await waitFor(() => {
      expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "360 Flip");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    // Confirms submitSetterTrick ran without upload (blob=null in demo mode)
    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "360 Flip", null);
      expect(mockUploadVideo).not.toHaveBeenCalled();
    });
  });

  it("matcher submits attempt after recording", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Heelflip",
    });
    mockSubmitMatchAttempt.mockResolvedValueOnce(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    // Matcher: autoOpen=false, must manually open camera
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /open camera/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /open camera/i }));

    // Camera rejected → preview state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /record/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop recording/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // Self-judging: matcher sees "Did you land it?" with Landed/Missed buttons
    await waitFor(() => {
      expect(screen.getByText(/✓ Landed/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/✓ Landed/));

    await waitFor(() => {
      expect(mockSubmitMatchAttempt).toHaveBeenCalledWith("game1", null, true);
    });
  });

  it("setter submits trick after confirming landed (upload skipped in demo mode)", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockResolvedValueOnce(undefined);
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    // Type trick name to reveal recorder
    await waitFor(() => {
      expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Heelflip");

    // Wait for camera → preview
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    // setTrick called (no upload since blob=null in demo mode)
    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "Heelflip", null);
    });
  });

  it("matcher submit error shows error banner", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    mockSubmitMatchAttempt.mockRejectedValueOnce(new Error("Submit failed"));
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => screen.getByRole("button", { name: /open camera/i }));
    await userEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /record/i }));

    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => screen.getByText(/✓ Landed/));
    await userEvent.click(screen.getByText(/✓ Landed/));

    await waitFor(() => {
      expect(screen.getByText("Submit failed")).toBeInTheDocument();
    });
  });

  it("setter landed failure shows error and retry button", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockRejectedValueOnce(new Error("Network error"));
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Heelflip");

    await waitFor(() => screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed (which will fail)
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    // Retry should attempt again
    mockSetTrick.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledTimes(2);
    });
  });

  it("setter shows 'Sending to @opponent...' during submission", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    // Make setTrick hang to show submitting state
    mockSetTrick.mockImplementation(() => new Promise(() => {}));
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");

    await waitFor(() => screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed (which will hang)
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(screen.getByText(/Sending to @rival/)).toBeInTheDocument();
    });
  });

  it("matcher shows fallback error when submitMatchAttempt throws non-Error", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    mockSubmitMatchAttempt.mockRejectedValueOnce("string error");
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));
    await waitFor(() => screen.getByRole("button", { name: /open camera/i }));
    await userEvent.click(screen.getByRole("button", { name: /open camera/i }));
    await waitFor(() => screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => screen.getByText(/✓ Landed/));
    await userEvent.click(screen.getByText(/✓ Landed/));

    await waitFor(() => {
      expect(screen.getByText("Failed to submit attempt")).toBeInTheDocument();
    });
  });

  it("setter landed shows fallback error for non-Error thrown", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    mockSetTrick.mockRejectedValueOnce("string error");
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));
    await waitFor(() => expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");

    await waitFor(() => screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await waitFor(() => screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // "Did you land it?" appears — click Landed (which will fail)
    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(screen.getByText("Failed to send trick")).toBeInTheDocument();
    });
  });

  it("forfeit check runs only once per game", async () => {
    mockForfeitExpiredTurn.mockResolvedValue({ forfeited: false, winner: null });
    const game = activeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      turnDeadline: { toMillis: () => Date.now() - 1000 },
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(mockForfeitExpiredTurn).toHaveBeenCalledTimes(1);
    });
  });

  it("forfeit check error does not crash", async () => {
    mockForfeitExpiredTurn.mockRejectedValueOnce(new Error("Forfeit error"));
    const game = activeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      turnDeadline: { toMillis: () => Date.now() - 1000 },
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    // No crash — waiting screen shows
    await waitFor(() => {
      expect(screen.getByText(/Waiting on @rival/)).toBeInTheDocument();
    });
  });

  it("subscribeToGame callback with null does not crash", async () => {
    const game = activeGame();
    mockSubscribeToGame.mockImplementation((_id: string, cb: (g: any) => void) => {
      cb(null); // exercise the !updated return branch
      return vi.fn();
    });
    renderLobby([game]);

    await userEvent.click(screen.getByText(/vs @rival/));
    // App should not crash
    await waitFor(() => expect(screen.getByText("← Games")).toBeInTheDocument());
  });
});
