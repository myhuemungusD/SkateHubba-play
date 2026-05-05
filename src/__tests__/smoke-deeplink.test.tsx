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
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

async function renderAt(initialPath: string): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>,
    );
  });
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

describe("Smoke: direct-URL deep-linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.refs.useAuth.mockReturnValue({
      loading: false,
      user: verifiedUser,
      profile: testProfile as UserProfile,
      refreshProfile: vi.fn(),
    });
  });

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
