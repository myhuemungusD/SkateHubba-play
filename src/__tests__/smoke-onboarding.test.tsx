import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockHelpers } from "./smoke-helpers";

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
  onboarding.refs.getLocalProgress.mockReturnValue(null);
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
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/i'm Hubz/i)).toBeInTheDocument();
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

    // Step 1 → 2: "let's go"
    await userEvent.click(screen.getByRole("button", { name: /let's go/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/Step 2 of 5/).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: /your tag/i })).toBeInTheDocument();
  });

  it("does NOT show the tour for users who already completed it", async () => {
    onboarding.refs.getOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 1,
      completedAt: { seconds: 0, nanoseconds: 0 },
      skippedAt: null,
    });
    await renderVerifiedLobby([]);
    // Lobby content renders normally; the overlay never appears.
    await screen.findByText(/Ready to S\.K\.A\.T\.E\.\?/i);
    expect(screen.queryByTestId("tutorial-overlay")).not.toBeInTheDocument();
  });

  it("re-arms the tour when a new tutorial version supersedes a stale completion", async () => {
    onboarding.refs.getOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 0, // older than current TUTORIAL_VERSION = 1
      completedAt: { seconds: 0, nanoseconds: 0 },
      skippedAt: null,
    });
    await renderVerifiedLobby([]);
    expect(await screen.findByTestId("tutorial-overlay")).toBeInTheDocument();
  });
});
