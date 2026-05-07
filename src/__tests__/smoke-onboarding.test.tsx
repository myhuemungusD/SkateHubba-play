import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockHelpers, renderApp, verifiedUser } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// Mirrors the smoke-* harness so the same App boot sequence runs end-to-end.
// Onboarding service is mocked here too — but tests below override the
// default "completed" state to force the tour to render.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, onboarding, sentry } =
  await vi.hoisted(async () => (await import("./harness/mockServices")).createAllSmokeMocks());

vi.mock("../hooks/useAuth", () => auth.module);
vi.mock("../services/auth", () => authSvc.module);
vi.mock("../services/users", () => users.module);
vi.mock("../services/games", () => games.module);
vi.mock("../services/storage", () => storage.module);
vi.mock("../services/fcm", () => fcm.module);
vi.mock("../firebase", () => firebase.module);
vi.mock("../services/analytics", () => analytics.module);
vi.mock("@sentry/react", () => sentry.module);
vi.mock("../services/blocking", () => blocking.module);
vi.mock("../services/onboarding", () => onboarding.module);

beforeEach(() => {
  vi.clearAllMocks();
  // Re-arm the harness defaults that vi.clearAllMocks resets — withGames
  // covers the games subscription, but onboarding needs an explicit reset
  // so each test starts with the same "fresh user, no completion" baseline
  // unless it overrides with mockResolvedValueOnce.
  onboarding.refs.getOnboardingState.mockResolvedValue(null);
  onboarding.refs.subscribeToOnboardingState.mockImplementation((_uid: string, cb: (s: unknown) => void) => {
    cb(null);
    return () => undefined;
  });
  onboarding.refs.getLocalProgress.mockReturnValue(null);
  onboarding.refs.getLocalDismissed.mockReturnValue(false);
});

const { renderVerifiedLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

describe("Smoke: Onboarding tour", () => {
  it("shows the welcome bubble on first lobby render and hides it on skip", async () => {
    await renderVerifiedLobby([]);

    // Welcome bubble appears once OnboardingProvider resolves the null state.
    const overlay = await screen.findByTestId("tutorial-overlay");
    // Coach mark is non-modal (tour points at controls but does not block them),
    // so the dialog must NOT advertise itself as modal.
    expect(overlay).not.toHaveAttribute("aria-modal");
    expect(screen.getByText(/quick tour/i)).toBeInTheDocument();
    // stepLabel renders twice (visible decoration + sr-only inside the
    // aria-live region) so we assert via getAllByText rather than getByText.
    expect(screen.getAllByText(/Step 1 of 5/).length).toBeGreaterThan(0);

    // Skip dismisses the tour and persists via markOnboardingSkipped.
    await userEvent.click(screen.getByRole("button", { name: /skip/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("tutorial-overlay")).not.toBeInTheDocument();
    });
    expect(onboarding.refs.markOnboardingSkipped).toHaveBeenCalledTimes(1);
  });

  it("advances through steps when the primary CTA is tapped", async () => {
    await renderVerifiedLobby([]);
    await screen.findByTestId("tutorial-overlay");

    // Step 1 ("welcome") has no anchor and screen=null so it always renders.
    // Clicking "show me" advances; step 2 ("your tag") targets a selector
    // that lives on the /profile screen (not /lobby), so the anchor-missing
    // watchdog will silently advance past it. We assert the next visible
    // step lands on a heading whose anchor exists on the lobby (challenge
    // or record).
    await userEvent.click(screen.getByRole("button", { name: /show me/i }));
    await waitFor(() => {
      // Anchor-missing watchdog has up to 1500ms — give the assertion room.
      const headings = screen.queryAllByRole("heading");
      expect(headings.some((h) => /start a session|land it/i.test(h.textContent ?? ""))).toBe(true);
    });
  });

  it("does NOT show the tour for users who already completed it", async () => {
    onboarding.refs.subscribeToOnboardingState.mockImplementation((_uid: string, cb: (s: unknown) => void) => {
      cb({ tutorialVersion: 2, completedAt: { seconds: 0, nanoseconds: 0 }, skippedAt: null });
      return () => undefined;
    });
    await renderVerifiedLobby([]);
    // Lobby content renders normally; the overlay never appears.
    await screen.findByText(/Ready to S\.K\.A\.T\.E\.\?/i);
    expect(screen.queryByTestId("tutorial-overlay")).not.toBeInTheDocument();
  });

  it("re-arms the tour when a new tutorial version supersedes a stale completion", async () => {
    onboarding.refs.subscribeToOnboardingState.mockImplementation((_uid: string, cb: (s: unknown) => void) => {
      cb({ tutorialVersion: 0, completedAt: { seconds: 0, nanoseconds: 0 }, skippedAt: null });
      return () => undefined;
    });
    await renderVerifiedLobby([]);
    expect(await screen.findByTestId("tutorial-overlay")).toBeInTheDocument();
  });

  it("does NOT render the tour while a brand-new user is still on /profile", async () => {
    // Signed-in user with NO active profile yet — they're on /profile
    // creating their account. The tour must not fire here, otherwise a
    // skip/complete would write fields to users/{uid}/private/profile that
    // the subsequent createProfile transaction would clobber.
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: verifiedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    games.refs.subscribeToMyGames.mockImplementation(() => () => {});
    await renderApp();

    // Wait long enough for any racing onboarding fetch to resolve.
    await waitFor(() => {
      expect(onboarding.refs.subscribeToOnboardingState).not.toHaveBeenCalled();
    });
    expect(screen.queryByTestId("tutorial-overlay")).not.toBeInTheDocument();
  });
});
