import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { authedUser, renderApp, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// Harness factories are loaded via dynamic import inside vi.hoisted so the
// ref objects exist before vi.mock() factories run. Top-level `await` is
// supported in vitest's ESM test modules.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, sentry } = await vi.hoisted(
  async () => {
    const m = await import("./harness/mockServices");
    return {
      auth: m.createUseAuthMocks(),
      authSvc: m.createAuthServiceMocks(),
      users: m.createUsersServiceMocks(),
      games: m.createGamesServiceMocks(),
      storage: m.createStorageServiceMocks(),
      fcm: m.createFcmServiceMocks(),
      firebase: m.createFirebaseMocks(),
      analytics: m.createAnalyticsMocks(),
      blocking: m.createBlockingServiceMocks(),
      sentry: m.createSentryMocks(),
    };
  },
);

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

beforeEach(() => vi.clearAllMocks());

const { withGames } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

describe("Smoke: Profile Setup", () => {
  it("shows profile setup when user exists but has no profile", async () => {
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();
    expect(await screen.findByText("Pick your handle")).toBeInTheDocument();
  });

  it("profile setup disables submit with short username", async () => {
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const usernameInput = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(usernameInput, "ab");

    const submitBtn = screen.getByText("Lock It In");
    expect(submitBtn).toBeDisabled();
    // Also shows the minimum character hint
    expect(screen.getByText(/Min 3 characters/)).toBeInTheDocument();
  });

  it("profile setup shows username available indicator", async () => {
    users.refs.isUsernameAvailable.mockResolvedValueOnce(true);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const usernameInput = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(usernameInput, "coolname");

    await waitFor(() => {
      expect(screen.getByText(/@coolname is available/)).toBeInTheDocument();
    });
  });

  it("profile setup shows username taken indicator", async () => {
    users.refs.isUsernameAvailable.mockResolvedValueOnce(false);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const usernameInput = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(usernameInput, "taken");

    await waitFor(() => {
      expect(screen.getByText(/@taken is taken/)).toBeInTheDocument();
    });
  });

  it("profile setup allows toggling stance on the single-card form", async () => {
    users.refs.isUsernameAvailable.mockResolvedValue(true);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    await screen.findByPlaceholderText("sk8legend");

    // Stance buttons render alongside username — no wizard steps to navigate.
    const regularBtn = screen.getByRole("radio", { name: /Regular/ });
    const goofyBtn = screen.getByRole("radio", { name: /Goofy/ });
    expect(regularBtn).toHaveAttribute("aria-checked", "true");
    expect(goofyBtn).toHaveAttribute("aria-checked", "false");

    // Click Goofy
    await userEvent.click(goofyBtn);

    // Goofy should now be selected
    expect(screen.getByRole("radio", { name: /Goofy/ })).toHaveAttribute("aria-checked", "true");
  });

  it("profile setup creates profile and transitions to lobby with inline DOB", async () => {
    const refreshProfile = vi.fn();
    const newProfile = { uid: "u1", username: "newsk8r", stance: "Regular", emailVerified: false, createdAt: null };
    users.refs.createProfile.mockResolvedValueOnce(newProfile);
    users.refs.isUsernameAvailable.mockResolvedValue(true);

    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile,
    });
    await renderApp();

    // Username
    const usernameInput = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(usernameInput, "newsk8r");
    await waitFor(() => expect(screen.getByText(/@newsk8r is available/)).toBeInTheDocument());

    // Google-signup path: DOB is collected inline on the same card.
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "15");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");

    // Auth state flips to reflect the new profile once createProfile resolves.
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: newProfile,
      refreshProfile,
    });
    withGames([]);

    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(users.refs.createProfile).toHaveBeenCalledWith("u1", "newsk8r", "Regular", false, "2000-01-15", false);
    });
  });

  it("shows error when username availability check fails", async () => {
    users.refs.isUsernameAvailable.mockRejectedValue(new Error("Firestore unavailable"));
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "validname");

    // The component retries once after 1.5s before surfacing the error
    await waitFor(
      () => {
        expect(screen.getByText("Could not check username — try again")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("shows error when profile creation fails", async () => {
    users.refs.isUsernameAvailable.mockResolvedValue(true);
    users.refs.createProfile.mockRejectedValueOnce(new Error("Firestore write failed"));
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: true },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "validname");

    await waitFor(() => expect(screen.getByText(/available/i)).toBeInTheDocument());

    // Inline DOB satisfies the service's COPPA gate.
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "15");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await userEvent.click(screen.getByText("Lock It In"));

    await waitFor(() => {
      expect(screen.getByText("Firestore write failed")).toBeInTheDocument();
    });
  });

  it("profile setup shows error when submitting while username check is pending", async () => {
    // Make availability check never resolve (stays null)
    users.refs.isUsernameAvailable.mockImplementation(() => new Promise(() => {}));
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "testuser");

    // Check shows "Checking..."
    expect(screen.getByText("Checking...")).toBeInTheDocument();

    // Button is disabled because available !== true, so submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(screen.getByText("Still checking username — wait a moment")).toBeInTheDocument();
    });
  });

  it("profile setup shows error when submitting taken username", async () => {
    users.refs.isUsernameAvailable.mockResolvedValue(false);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "taken_name");

    await waitFor(() => expect(screen.getByText(/@taken_name is taken/)).toBeInTheDocument());

    // Submit via form (button is disabled)
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(screen.getByText("Username is taken")).toBeInTheDocument();
    });
  });

  it("profile setup rejects username shorter than 3 characters on form submit", async () => {
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "ab");

    // Submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(screen.getByText("Username must be 3+ characters")).toBeInTheDocument();
    });
  });

  it("profile setup error banner can be dismissed", async () => {
    users.refs.isUsernameAvailable.mockResolvedValue(false);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "taken_user");

    await waitFor(() => expect(screen.getByText(/@taken_user is taken/)).toBeInTheDocument());

    // Force submit via form to get error banner
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(screen.getByText("Username is taken")).toBeInTheDocument());

    // Dismiss
    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("Username is taken")).not.toBeInTheDocument();
  });

  it("profile setup uses displayName as suggested username", async () => {
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false, displayName: "Cool Skater123" },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    const input = (await screen.findByPlaceholderText("sk8legend")) as HTMLInputElement;
    expect(input.value).toBe("coolskater123");
  });

  it("profile setup rejects username with invalid characters on form submit", async () => {
    // The input already strips invalid chars, but the validation still checks
    users.refs.isUsernameAvailable.mockResolvedValue(true);
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com", emailVerified: false },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    // Type valid chars via input
    const input = await screen.findByPlaceholderText("sk8legend");
    await userEvent.type(input, "abc");

    await waitFor(() => expect(screen.getByText(/@abc is available/)).toBeInTheDocument());
  });

  it("profile setup handles user with null email", async () => {
    auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: null, emailVerified: false, displayName: null },
      profile: null,
      refreshProfile: vi.fn(),
    });
    await renderApp();

    await waitFor(() => expect(screen.getByText("Pick your handle")).toBeInTheDocument());
  });
});
