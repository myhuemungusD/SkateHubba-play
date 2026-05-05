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
import { act, render, screen, waitFor, type RenderResult } from "@testing-library/react";
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
  // Wait for the React.lazy() Suspense boundary to settle so the assertions
  // inspect the final route, not the loading spinner.
  await waitFor(() => {
    expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
  });
  return result;
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
    // PlayerProfileScreen renders its own layout — assert on something the
    // lobby does NOT render so a stray bounce-to-lobby would fail loud.
    await waitFor(() => {
      expect(screen.queryByText("Your Games")).not.toBeInTheDocument();
    });
  });

  it("loads /map directly without bouncing to /lobby", async () => {
    await renderAt("/map");
    // The map screen renders Mapbox-based UI; we just verify we didn't get
    // routed to the lobby's "Your Games" header.
    await waitFor(() => {
      expect(screen.queryByText("Your Games")).not.toBeInTheDocument();
    });
  });

  it("loads /player/:uid directly without bouncing to /lobby", async () => {
    await renderAt("/player/u2");
    await waitFor(() => {
      expect(screen.queryByText("Your Games")).not.toBeInTheDocument();
    });
  });

  it("loads /lobby directly and renders the lobby", async () => {
    await renderAt("/lobby");
    expect(await screen.findByText("Your Games")).toBeInTheDocument();
  });
});
