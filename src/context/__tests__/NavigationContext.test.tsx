import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { Component, type ReactNode } from "react";
import { useNavigationContext, NavigationProvider, pathToScreen, type Screen } from "../NavigationContext";
import { AuthProvider, useAuthContext } from "../AuthContext";

/** Mutable auth state so a single file can exercise both sides of the bounce. */
let mockAuth: { loading: boolean; user: { uid: string } | null; profile: { username: string } | null } = {
  loading: false,
  user: null,
  profile: null,
};

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ ...mockAuth, refreshProfile: vi.fn(), reloadAuthUser: vi.fn() }),
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
// Any error handed to beginMfaChallenge counts as a second-factor challenge —
// the real extraction is the service's business, not the router's.
vi.mock("../../services/mfa", () => ({
  getMfaChallenge: () => ({ resolver: {}, hints: [{ uid: "f1", factorId: "phone" }] }),
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

/** Surfaces the live URL so navigation helpers can be asserted on directly. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

/**
 * Dispatches setScreen(target) during render and returns the message the
 * ErrorCatcher boundary captured. Throwing inside render() is what makes an
 * unsupported dispatch observable at all.
 */
function dispatchSetScreen(target: Screen): string {
  function TestComponent() {
    useNavigationContext().setScreen(target);
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
  const message = getByTestId("error").textContent ?? "";
  spy.mockRestore();
  return message;
}

/**
 * Mount `children` inside the router + provider stack at `initialPath`.
 *
 * Named distinctly from the `renderAt` declared inside the deep-link describe
 * below: that one takes only a path and returns a URL reader, and a same-named
 * helper with a different signature shadowing this one reads like a bug.
 */
function renderWithProviders(initialPath: string, children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth = { loading: false, user: null, profile: null };
  sessionStorage.clear();
  vi.restoreAllMocks();
});

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

    const { getByTestId } = renderWithProviders("/", <TestComponent />);

    expect(getByTestId("screen").textContent).toBe("landing");
  });

  it("navigateToMapWithAddSpot routes to /map?add=1 so the Add Spot sheet opens on arrival", () => {
    // setScreen('map') lands on a bare map: the sheet's open state is local to
    // SpotMap with no other external entry point, which is exactly why the
    // profile's "ADD A SPOT" CTA used to be a dead end. The param is the
    // contract MapPage reads — mirrors navigateToChallengeWithSpot's ?spot=.
    //
    // Signed IN, because /map is not a public screen: spot reads require auth
    // (firestore.rules), so the auth router bounces a signed-out visitor off
    // /map to "/" before any of this runs. Every real caller of this helper
    // (the profile "ADD A SPOT" CTA) is inside the authenticated app anyway.
    mockAuth = { loading: false, user: { uid: "u1" }, profile: { username: "skater" } };

    function TestComponent() {
      const ctx = useNavigationContext();
      return (
        <button type="button" data-testid="go" onClick={ctx.navigateToMapWithAddSpot}>
          go
        </button>
      );
    }

    const { getByTestId } = renderWithProviders(
      "/map",
      <>
        <TestComponent />
        <LocationProbe />
      </>,
    );

    act(() => {
      getByTestId("go").click();
    });
    expect(getByTestId("location").textContent).toBe("/map?add=1");
  });

  it("leaves a signed-out visitor on /player/:uid instead of bouncing to landing", () => {
    // The auth router is a second, independent gate: even with the route
    // guard in App.tsx opened up, a "player" missing from PUBLIC_SCREENS
    // would replace the URL with "/" the moment the effect ran, and the
    // shared link would still be unreachable without an account.
    function TestComponent() {
      const ctx = useNavigationContext();
      return <span data-testid="screen">{ctx.screen}</span>;
    }

    const { getByTestId } = renderWithProviders(
      "/player/u2",
      <>
        <TestComponent />
        <LocationProbe />
      </>,
    );

    expect(getByTestId("screen").textContent).toBe("player");
    expect(getByTestId("location").textContent).toBe("/player/u2");
  });

  it("routes a captured second-factor challenge to /auth so the card has somewhere to render", () => {
    // AuthScreen is the only renderer of MfaVerifyCard, but Google sign-in also
    // starts from Landing and a redirect resolves on "/" — the challenge was
    // captured with nothing on screen, stranding the user mid-sign-in. Mirrors
    // the googleError → /auth bounce.
    function MfaTrigger() {
      const auth = useAuthContext();
      return (
        <button
          type="button"
          data-testid="mfa"
          onClick={() => auth.beginMfaChallenge({ code: "auth/multi-factor-auth-required" }, "google")}
        >
          go
        </button>
      );
    }

    const { getByTestId } = renderWithProviders(
      "/",
      <>
        <MfaTrigger />
        <LocationProbe />
      </>,
    );
    expect(getByTestId("location").textContent).toBe("/");

    act(() => {
      getByTestId("mfa").click();
    });

    expect(getByTestId("location").textContent).toBe("/auth");
  });

  it("setScreen('player') throws — callers must go through navigateToPlayer(uid)", () => {
    // 'player' is a current-screen marker for the /player/:uid dynamic
    // route. There's no static /player path in the router, so dispatching
    // to it used to silently 404 via the catch-all. Force the bug to be loud.
    expect(dispatchSetScreen("player")).toMatch(/navigateToPlayer/);
  });

  it("setScreen('spotdetail') throws — the bare /spots path isn't routed", () => {
    // Same story for the /spots/:id marker: without the id segment the
    // dispatch would fall through to the 404 catch-all.
    expect(dispatchSetScreen("spotdetail")).toMatch(/\/spots\/<id>/);
  });
});

/**
 * Deep links that outlive the auth bounce.
 *
 * A shared /spots/<uuid> link used to lose its destination: the recipient was
 * redirected to sign in and then dumped on /lobby. The spot id is now stashed
 * in sessionStorage before the bounce and consumed on the lobby transition —
 * the same mechanism the older /challenge?spot= link already used, but under
 * its own key so the two can never restore to each other's screen.
 */
describe("auth-router deep-link stash/restore", () => {
  const SPOT_ID = "11111111-2222-3333-4444-555555555555";
  const CHALLENGE_KEY = "skate.pendingChallengeSpot";
  const DETAIL_KEY = "skate.pendingSpotDetail";

  /** Mounts the auth router at `path` and returns a reader for the live URL. */
  function renderAt(path: string): () => string {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <NavigationProvider>
            <LocationProbe />
          </NavigationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    return () => getByTestId("location").textContent ?? "";
  }

  /** Signs the user in with a resolved profile — the post-bounce precondition. */
  function signIn(): void {
    mockAuth = { loading: false, user: { uid: "u1" }, profile: { username: "skater" } };
  }

  it("stashes the spot id before bouncing a signed-out visitor off /spots/:id", () => {
    const url = renderAt(`/spots/${SPOT_ID}`);
    expect(sessionStorage.getItem(DETAIL_KEY)).toBe(SPOT_ID);
    // Bounce target matches the App.tsx route element's signed-out <Navigate>,
    // so the two redirect mechanisms can't fight over the URL.
    expect(url()).toBe("/");
    expect(sessionStorage.getItem(CHALLENGE_KEY)).toBeNull();
  });

  it("does not stash a spot id that isn't a uuid", () => {
    // Anything else is either a typo or someone probing the storage key with
    // an arbitrary string that would later be pasted straight into a URL.
    const url = renderAt("/spots/not-a-real-id");
    expect(sessionStorage.getItem(DETAIL_KEY)).toBeNull();
    expect(url()).toBe("/");
  });

  it("still bounces when sessionStorage.setItem throws (private-mode Safari)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const url = renderAt(`/spots/${SPOT_ID}`);
    expect(url()).toBe("/");
    spy.mockRestore();
  });

  it("restores /spots/:id after sign-in and clears the stash", () => {
    sessionStorage.setItem(DETAIL_KEY, SPOT_ID);
    signIn();
    const url = renderAt("/");
    expect(url()).toBe(`/spots/${SPOT_ID}`);
    // Left behind, the id would hijack the next sign-in on this tab.
    expect(sessionStorage.getItem(DETAIL_KEY)).toBeNull();
  });

  it("restores /challenge?spot= after sign-in — the pre-existing flow is untouched", () => {
    sessionStorage.setItem(CHALLENGE_KEY, SPOT_ID);
    signIn();
    const url = renderAt("/");
    expect(url()).toBe(`/challenge?spot=${SPOT_ID}`);
    expect(sessionStorage.getItem(CHALLENGE_KEY)).toBeNull();
  });

  it("keeps the two keys from crossing when both are stashed", () => {
    // Same tab, two shared links. The challenge wins, but both are consumed —
    // a surviving stash would fire on the next sign-in and land the user on a
    // screen they never asked for.
    sessionStorage.setItem(CHALLENGE_KEY, SPOT_ID);
    sessionStorage.setItem(DETAIL_KEY, "99999999-8888-7777-6666-555555555555");
    signIn();
    const url = renderAt("/");
    expect(url()).toBe(`/challenge?spot=${SPOT_ID}`);
    expect(sessionStorage.getItem(DETAIL_KEY)).toBeNull();
  });

  it("ignores a tampered stash and lands on the lobby", () => {
    sessionStorage.setItem(DETAIL_KEY, "../../evil");
    signIn();
    const url = renderAt("/");
    expect(url()).toBe("/lobby");
  });

  it("lands on the lobby when sessionStorage reads throw", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    signIn();
    const url = renderAt("/");
    expect(url()).toBe("/lobby");
    spy.mockRestore();
  });

  it("stashes the /challenge?spot= query param before the bounce", () => {
    const url = renderAt(`/challenge?spot=${SPOT_ID}`);
    expect(sessionStorage.getItem(CHALLENGE_KEY)).toBe(SPOT_ID);
    expect(sessionStorage.getItem(DETAIL_KEY)).toBeNull();
    expect(url()).toBe("/");
  });

  it("resolves /spots/:id to the spotdetail screen instead of notfound", () => {
    // The screen identity is what makes the auth router see the URL at all:
    // as "notfound" it was treated as a public screen and returned early.
    expect(pathToScreen(`/spots/${SPOT_ID}`)).toBe("spotdetail");
    // Prefix match must not be sloppy — a sibling path is still a 404.
    expect(pathToScreen("/spotsomething")).toBe("notfound");
  });
});
