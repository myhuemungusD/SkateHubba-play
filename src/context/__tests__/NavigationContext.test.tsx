import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Component, type ReactNode } from "react";
import { useNavigationContext, NavigationProvider } from "../NavigationContext";
import { AuthProvider } from "../AuthContext";

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: null, profile: null, refreshProfile: vi.fn() }),
}));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
  deleteAccount: vi.fn(),
}));
vi.mock("../../services/users", () => ({
  deleteUserData: vi.fn(),
}));
vi.mock("../../services/analytics", () => ({
  analytics: { signIn: vi.fn() },
}));
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { signIn: vi.fn(), accountDeleted: vi.fn() },
}));
vi.mock("../../lib/sentry", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
}));
vi.mock("../../lib/posthog", () => ({
  identify: vi.fn(),
  resetIdentity: vi.fn(),
}));

class ErrorCatcher extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span data-testid="error">{this.state.error.message}</span> : this.props.children;
  }
}

describe("useNavigationContext", () => {
  it("throws when used outside NavigationProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useNavigationContext();
      return null;
    }

    const { getByTestId } = render(
      <ErrorCatcher>
        <TestComponent />
      </ErrorCatcher>,
    );

    expect(getByTestId("error").textContent).toBe("useNavigationContext must be used within NavigationProvider");
    spy.mockRestore();
  });

  it("returns context value with default screen as landing", () => {
    function TestComponent() {
      const ctx = useNavigationContext();
      return <span data-testid="screen">{ctx.screen}</span>;
    }

    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <NavigationProvider>
            <TestComponent />
          </NavigationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(getByTestId("screen").textContent).toBe("landing");
  });

  describe("age gate", () => {
    // Wraps the hook under test in the same provider stack the app mounts,
    // scoped to /auth so the auth router doesn't try to bounce us mid-test.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/auth"]}>
        <AuthProvider>
          <NavigationProvider>{children}</NavigationProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    it("initializes ageGateDob=null and ageGateParentalConsent=false", () => {
      const { result } = renderHook(() => useNavigationContext(), { wrapper });
      expect(result.current.ageGateDob).toBeNull();
      expect(result.current.ageGateParentalConsent).toBe(false);
    });

    it("setAgeGateResult stores DOB and parentalConsent for ProfileSetup to consume", () => {
      const { result } = renderHook(() => useNavigationContext(), { wrapper });
      act(() => result.current.setAgeGateResult("2000-01-15", false));
      expect(result.current.ageGateDob).toBe("2000-01-15");
      expect(result.current.ageGateParentalConsent).toBe(false);

      act(() => result.current.setAgeGateResult("2012-06-01", true));
      expect(result.current.ageGateDob).toBe("2012-06-01");
      expect(result.current.ageGateParentalConsent).toBe(true);
    });

    it("clearAgeGate wipes both fields so a failed signUp doesn't leak DOB across the mode toggle", () => {
      // Regression: setAgeGateResult fires BEFORE signUp so ProfileSetup can
      // read the DOB synchronously once auth flips. If signUp then rejects
      // and the user toggles to sign-in with an existing account whose
      // profile is missing, ProfileSetup would read the stale DOB. The
      // AuthScreen catch handler calls clearAgeGate to roll that back.
      const { result } = renderHook(() => useNavigationContext(), { wrapper });
      act(() => result.current.setAgeGateResult("2012-06-01", true));
      expect(result.current.ageGateDob).toBe("2012-06-01");
      expect(result.current.ageGateParentalConsent).toBe(true);

      act(() => result.current.clearAgeGate());
      expect(result.current.ageGateDob).toBeNull();
      expect(result.current.ageGateParentalConsent).toBe(false);
    });

    it("clearAgeGate is a no-op when the context is already empty", () => {
      const { result } = renderHook(() => useNavigationContext(), { wrapper });
      expect(result.current.ageGateDob).toBeNull();
      act(() => result.current.clearAgeGate());
      expect(result.current.ageGateDob).toBeNull();
      expect(result.current.ageGateParentalConsent).toBe(false);
    });
  });

  it("setScreen('player') throws — callers must go through navigateToPlayer(uid)", () => {
    // 'player' is a current-screen marker for the /player/:uid dynamic
    // route. There's no static /player path in the router, so dispatching
    // to it used to silently 404 via the catch-all. Force the bug to be
    // loud. Throwing inside render() lets the ErrorCatcher boundary
    // capture the message so we can assert on it.
    function TestComponent() {
      const ctx = useNavigationContext();
      ctx.setScreen("player" as "landing");
      return null;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <AuthProvider>
          <NavigationProvider>
            <ErrorCatcher>
              <TestComponent />
            </ErrorCatcher>
          </NavigationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(getByTestId("error").textContent).toMatch(/navigateToPlayer/);
    spy.mockRestore();
  });
});
