import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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
