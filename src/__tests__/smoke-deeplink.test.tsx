/**
 * Regression tests for direct-URL deep-linking.
 *
 * The bug: opening the app at /map, /record, or /player/:uid via the address
 * bar (or a shared link) bounced the user back to /lobby. Root cause was a
 * one-render lag in AuthContext, where `activeProfile` mirrored `profile`
 * via useEffect — the routing effect in NavigationContext fired in the gap
 * between profile being set and activeProfile catching up, treated the user
 * as profile-less, and replaced the URL with /profile, then /lobby.
 *
 * These tests pin the behavior: a direct deep-link with a fully-resolved
 * auth user must render the requested screen, not bounce.
 *
 * The second describe reuses the same route-level harness to pin the props
 * `App.tsx` hands the own-profile route — a different bug class, but one only
 * observable by rendering the real route table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import App from "../App";
import { verifiedUser, testProfile } from "./smoke-helpers";
import type { UserProfile } from "../services/users";

// Minimal mock surface: only the modules `App` directly touches at startup
// (firebase init, useAuth, the services Lobby + lazy screens import). The
// shared smoke harness factory provisions the rest as no-ops.
const mocks = await vi.hoisted(async () => (await import("./harness/mockServices")).createAllSmokeMocks());
vi.mock("../firebase", () => mocks.firebase.module);
vi.mock("../hooks/useAuth", () => mocks.auth.module);
vi.mock("../services/auth", () => mocks.authSvc.module);
vi.mock("@sentry/react", () => mocks.sentry.module);
vi.mock("../services/users", () => mocks.users.module);
vi.mock("../services/games", () => mocks.games.module);
vi.mock("../services/storage", () => mocks.storage.module);
vi.mock("../services/fcm", () => mocks.fcm.module);
vi.mock("../services/blocking", () => mocks.blocking.module);
vi.mock("../services/analytics", () => mocks.analytics.module);

/** Surfaces the live URL so route-level navigation can be asserted on. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

/** Mount the real route table at a URL. No readiness wait — callers pick the
 *  signal that suits their route (see renderAt vs. the public-profile block). */
async function mountApp(initialPath: string): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return result;
}

async function renderAt(initialPath: string): Promise<RenderResult> {
  const result = await mountApp(initialPath);
  // Wait for the persistent BottomNav to mount — it only renders on the
  // four authed primary screens (lobby/map/record/player), so its presence
  // confirms the route resolved past the Suspense fallback. Asserting on a
  // route-agnostic readiness signal (rather than the global "Loading"
  // spinner) keeps the helper insensitive to per-screen status overlays
  // (e.g. MapPage's "Loading map" while tiles initialize).
  await screen.findByRole("navigation", { name: "Primary navigation" });
  return result;
}

/** Returns the screen name marked as the active bottom-nav tab. */
function activeNavTab(): string | null {
  const link = document.querySelector('a[aria-current="page"]');
  return link?.getAttribute("aria-label") ?? null;
}

// Both describes need the same fully-resolved auth user — a signed-in account
// with a profile already loaded, which is the precondition for any route in
// this file to render rather than bounce. Declared once at file scope so the
// two blocks can't drift apart.
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.refs.useAuth.mockReturnValue({
    loading: false,
    user: verifiedUser,
    profile: testProfile as UserProfile,
    refreshProfile: vi.fn(),
  });
});

describe("Smoke: direct-URL deep-linking", () => {
  it("loads /record directly without bouncing to /lobby", async () => {
    await renderAt("/record");
    // The "Me" tab being active proves NavigationContext resolved the URL
    // to the record screen rather than bouncing through /profile → /lobby.
    expect(activeNavTab()).toBe("Me");
  });

  it("loads /map directly without bouncing to /lobby", async () => {
    await renderAt("/map");
    expect(activeNavTab()).toBe("Map");
  });

  it("loads /player/:uid directly without bouncing to /lobby", async () => {
    await renderAt("/player/u2");
    // BottomNav's matchPaths config lights up "Me" for /player/* deep links.
    expect(activeNavTab()).toBe("Me");
  });

  it("loads /lobby directly and renders the lobby", async () => {
    await renderAt("/lobby");
    expect(activeNavTab()).toBe("Home");
    expect(await screen.findByText("Your Games")).toBeInTheDocument();
  });
});

/**
 * `/record` is the own-profile surface behind BottomNav's "Me" tab — the one
 * users actually reach. It rendered PlayerProfileScreen without `onAddSpot` or
 * `onRefreshProfile`, so the "ADD A SPOT" CTA sat permanently disabled and the
 * pull-to-refresh gesture animated without refetching anything, even though
 * `/player/:uid` passed both. Prop wiring on a route is only observable
 * through the real route table, hence an App-level spec.
 */
describe("Smoke: /record own-profile affordances", () => {
  it("renders ADD A SPOT as an enabled control, not an inert affordance", async () => {
    await renderAt("/record");
    expect(await screen.findByRole("button", { name: /add a spot/i })).toBeEnabled();
  });

  it("routes ADD A SPOT to the map with the Add Spot sheet requested", async () => {
    await renderAt("/record");
    await userEvent.click(await screen.findByRole("button", { name: /add a spot/i }));
    // `?add=1` is the whole point: plain /map leaves the sheet shut because
    // its open state is local to SpotMap.
    expect(screen.getByTestId("location").textContent).toBe("/map?add=1");
  });

  it("does not render the achievements ribbon", async () => {
    await renderAt("/record");
    await screen.findByRole("button", { name: /add a spot/i });
    expect(screen.queryByTestId("achievements-ribbon")).not.toBeInTheDocument();
  });

  it("does not render a level indicator", async () => {
    await renderAt("/record");
    await screen.findByRole("button", { name: /add a spot/i });
    expect(screen.queryByLabelText(/^Level /)).not.toBeInTheDocument();
  });

  it("routes the MY STATS button to the owner-only analytics screen", async () => {
    await renderAt("/record");
    await userEvent.click(await screen.findByTestId("my-stats-button"));
    // A lazy route only commits its URL once the chunk resolves — poll rather
    // than asserting on the first paint (same reason as the /spots restore).
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/my-stats");
    });
    expect(await screen.findByRole("heading", { name: "My Stats" })).toBeInTheDocument();
  });
});

/**
 * `/my-stats` shows counters that are nobody else's business. The route has no
 * Screen identity (same as /settings), so the `activeProfile` guard on the
 * route element is the entire own-profile gate — worth pinning at the route
 * level, because a guard that silently stops guarding looks identical from
 * inside the screen's own specs.
 */
describe("Smoke: /my-stats is owner-only", () => {
  it("loads directly for a signed-in user", async () => {
    await mountApp("/my-stats");
    expect(await screen.findByRole("heading", { name: "My Stats" })).toBeInTheDocument();
  });

  it("bounces a visitor with no profile to the landing page", async () => {
    mocks.auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await mountApp("/my-stats");
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
    expect(screen.queryByRole("heading", { name: "My Stats" })).not.toBeInTheDocument();
  });
});

/**
 * A shared /spots/<id> link opened by someone who isn't signed in.
 *
 * Two independent mechanisms redirect that visitor — the route element's
 * signed-out <Navigate>, and NavigationContext's auth router (which only
 * started seeing this URL once /spots/:id got a screen identity). Only the
 * real route table renders both at once, which is what makes this an
 * App-level spec: it pins that they agree on a destination rather than
 * fighting over the URL, and that the spot id outlives the round trip.
 */
describe("Smoke: /spots/:id deep link survives the auth bounce", () => {
  const SPOT_ID = "11111111-2222-3333-4444-555555555555";
  const DETAIL_KEY = "skate.pendingSpotDetail";

  it("bounces a signed-out visitor to a single settled URL, then restores the spot", async () => {
    sessionStorage.clear();
    mocks.auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });

    // Fresh element per pass — re-rendering the identical element object makes
    // React bail out of reconciliation, so the auth change would never land.
    const tree = (): ReactElement => (
      <MemoryRouter initialEntries={[`/spots/${SPOT_ID}`]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );
    let view!: RenderResult;
    await act(async () => {
      view = render(tree());
    });

    // One settled destination, not a ping-pong between "/auth" and "/".
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(sessionStorage.getItem(DETAIL_KEY)).toBe(SPOT_ID);

    // Sign-in resolves: the auth router would normally land them on /lobby.
    mocks.auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: verifiedUser,
      profile: testProfile as UserProfile,
      refreshProfile: vi.fn(),
    });
    await act(async () => {
      view.rerender(tree());
    });

    // The restore navigation is a router transition into a React.lazy route,
    // so the URL only commits once the chunk resolves — poll rather than
    // asserting on the first paint.
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(`/spots/${SPOT_ID}`);
    });
    expect(sessionStorage.getItem(DETAIL_KEY)).toBeNull();
  });
});

/**
 * The same route table, one deep-link, and NO account.
 *
 * `/player/:uid` is the app's share surface, and it used to bounce logged-out
 * visitors to `/` twice over — once from the route guard in `App.tsx`, once
 * from the auth router in `NavigationContext` — so a shared profile link could
 * only ever reach people who already had accounts. Both gates are exercised
 * here by mounting the real route table with a null auth user.
 */
describe("Smoke: public /player/:uid for a signed-out visitor", () => {
  /** The public doc a logged-out client is allowed to `get`. */
  const publicProfile: UserProfile = {
    uid: "u2",
    username: "sk8rboi",
    stance: "goofy",
    createdAt: null,
    wins: 10,
    losses: 3,
  };

  async function renderPublicProfile(): Promise<void> {
    await mountApp("/player/u2");
    // The screen is lazy — waiting on its content (rather than a route-agnostic
    // signal) is what proves the chunk actually mounted instead of bouncing.
    await screen.findByText("@sk8rboi");
  }

  beforeEach(() => {
    // Overrides the file-scope signed-in user.
    mocks.auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    mocks.users.refs.getUserProfile.mockResolvedValue(publicProfile);
  });

  it("renders the shared profile instead of bouncing to the landing page", async () => {
    await renderPublicProfile();
    expect(screen.getByTestId("location").textContent).toBe("/player/u2");
    expect(screen.getByText("goofy")).toBeInTheDocument();
    expect(screen.getByLabelText("Lifetime wins: 10")).toBeInTheDocument();
  });

  it("reads only the public profile doc, never the participant-gated games", async () => {
    await renderPublicProfile();
    expect(mocks.users.refs.getUserProfile).toHaveBeenCalledWith("u2");
    // `fetchPlayerCompletedGames` is absent from the games mock module, so a
    // query attempt would throw and take the screen down with it. Reaching
    // this assertion at all is the proof it was skipped.
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("routes the sign-up call to action into the auth flow", async () => {
    await renderPublicProfile();
    await userEvent.click(screen.getByRole("button", { name: "Sign up to challenge @sk8rboi" }));
    expect(screen.getByTestId("location").textContent).toBe("/auth");
  });

  it("withholds every affordance that needs an account", async () => {
    await renderPublicProfile();
    expect(screen.queryByText("Challenge @sk8rboi")).not.toBeInTheDocument();
    expect(screen.queryByText("Block this player")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-my-profile-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
    expect(screen.queryByText("GAMES VS YOU")).not.toBeInTheDocument();
  });

  it("hides the bottom tab bar, whose destinations are all auth-gated", async () => {
    await renderPublicProfile();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
  });
});
