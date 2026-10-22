import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { ReactNode } from "react";
import type { GameDoc } from "../../services/games";

const OPEN_GAME = "skatehubba:open-game";

const h = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, activeProfile: null as object | null },
  nav: { screen: "lobby" as string, setScreen: vi.fn() },
  game: { games: [] as unknown[], openGame: vi.fn(), activeGame: null as { id: string } | null },
  notify: vi.fn(),
  getNotificationGame: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../../context/AuthContext", () => ({ useAuthContext: () => h.auth }));
vi.mock("../../context/NavigationContext", () => ({ useNavigationContext: () => h.nav }));
vi.mock("../../context/GameContext", () => ({ useGameContext: () => h.game }));
vi.mock("../../context/NotificationContext", () => ({ useNotifications: () => ({ notify: h.notify }) }));
vi.mock("../../components/GameNotificationWatcher", () => ({ OPEN_GAME_EVENT: "skatehubba:open-game" }));
vi.mock("../../services/notifications", () => ({
  getNotificationGame: (...args: unknown[]) => h.getNotificationGame(...args),
}));
vi.mock("../../services/logger", () => ({ logger: h.logger }));

import { useGameDeepLink } from "../useGameDeepLink";

const KEY = "skate.pendingGameLink";

function game(overrides: Partial<GameDoc> = {}): GameDoc {
  return { id: "g1", player1Uid: "u1", player2Uid: "u2", status: "active", ...overrides } as GameDoc;
}

function signIn(screen = "lobby") {
  h.auth.user = { uid: "u1" };
  h.auth.activeProfile = { uid: "u1" };
  h.nav.screen = screen;
}

function mount(path = "/lobby") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      useGameDeepLink();
      return useLocation();
    },
    { wrapper },
  );
}

function fire(detail: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_GAME, { detail }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.auth.user = null;
  h.auth.activeProfile = null;
  h.nav.screen = "landing";
  h.game.games = [];
  h.game.activeGame = null;
  h.getNotificationGame.mockResolvedValue(null);
});

describe("useGameDeepLink: ?game= on load", () => {
  it("opens a game from the loaded list and strips the param", async () => {
    signIn();
    const g = game();
    h.game.games = [g];
    const { result } = mount("/?game=g1");
    expect(result.current.search).toBe("");
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.getNotificationGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps other query params and the hash when stripping", () => {
    const { result } = mount("/?utm_source=push&game=g1#x");
    expect(result.current.search).toBe("?utm_source=push");
    expect(result.current.hash).toBe("#x");
    expect(sessionStorage.getItem(KEY)).toBe("g1");
  });

  it("fetches a game the list doesn't have yet (cold start) and opens it", async () => {
    signIn();
    const g = game({ id: "g2", player1Uid: "u9", player2Uid: "u1" });
    h.getNotificationGame.mockResolvedValue(g);
    mount("/?game=g2");
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.getNotificationGame).toHaveBeenCalledWith("g2");
  });

  it("opens a game this account judges", async () => {
    signIn();
    const g = game({ player1Uid: "u8", player2Uid: "u9", judgeId: "u1" });
    h.getNotificationGame.mockResolvedValue(g);
    mount("/?game=g1");
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
  });

  it("falls back to the lobby with the error toast when the game is gone or unreadable", async () => {
    signIn("me");
    mount("/me?game=g1");
    await waitFor(() => expect(h.nav.setScreen).toHaveBeenCalledWith("lobby"));
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: "You can't open that game" }),
    );
    expect(h.game.openGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("refuses a game this account isn't in", async () => {
    signIn();
    h.getNotificationGame.mockResolvedValue(game({ player1Uid: "u8", player2Uid: "u9", judgeId: null }));
    mount("/?game=g1");
    await waitFor(() => expect(h.nav.setScreen).toHaveBeenCalledWith("lobby"));
    expect(h.game.openGame).not.toHaveBeenCalled();
  });

  it("strips an invalid id without using it", async () => {
    signIn();
    const { result } = mount("/lobby?game=..%2Fusers%2Fu2");
    expect(result.current.search).toBe("");
    expect(h.logger.warn).toHaveBeenCalledWith("game_link_invalid_id");
    await act(async () => {});
    expect(h.getNotificationGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("useGameDeepLink: signed out", () => {
  it("parks the id through sign-in and profile setup, then opens the game", async () => {
    const g = game();
    h.game.games = [g];
    const { rerender } = mount("/?game=g1");
    expect(sessionStorage.getItem(KEY)).toBe("g1");
    await act(async () => {});
    expect(h.game.openGame).not.toHaveBeenCalled();

    // Signed in, no profile yet: still waiting.
    h.auth.user = { uid: "u1" };
    h.nav.screen = "profile";
    rerender();
    await act(async () => {});
    expect(h.game.openGame).not.toHaveBeenCalled();

    // Profile exists but the auth router is still on /profile: still waiting.
    h.auth.activeProfile = { uid: "u1" };
    rerender();
    await act(async () => {});
    expect(h.game.openGame).not.toHaveBeenCalled();

    h.nav.screen = "lobby";
    rerender();
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("picks up an id parked before this page load (Google redirect sign-in)", async () => {
    sessionStorage.setItem(KEY, "g1");
    signIn();
    const g = game();
    h.game.games = [g];
    mount("/lobby");
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
  });

  it("drops a fetch that resolves after the user signed out", async () => {
    signIn();
    let resolve!: (g: GameDoc) => void;
    h.getNotificationGame.mockReturnValue(new Promise<GameDoc>((r) => (resolve = r)));
    const { rerender } = mount("/?game=g1");
    await waitFor(() => expect(h.getNotificationGame).toHaveBeenCalled());
    h.auth.user = null;
    h.auth.activeProfile = null;
    rerender();
    await act(async () => resolve(game()));
    expect(h.game.openGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBe("g1");
  });
});

describe("useGameDeepLink: in-app taps (OPEN_GAME_EVENT)", () => {
  it("opens the game a tap names, fetching it when the list is empty", async () => {
    signIn();
    const g = game({ id: "g3" });
    h.getNotificationGame.mockResolvedValue(g);
    mount();
    fire({ gameId: "g3" });
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
  });

  it("ignores a tap for the game already open (the SDK's late notification-clicked message)", async () => {
    signIn("game");
    h.game.activeGame = { id: "g1" };
    mount("/game");
    fire({ gameId: "g1" });
    await act(async () => {});
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(h.getNotificationGame).not.toHaveBeenCalled();
  });

  it("routes a Roll Dice tap to /dice/<id>", () => {
    signIn();
    const { result } = mount();
    fire({ gameId: "d1", kind: "dice" });
    expect(result.current.pathname).toBe("/dice/d1");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([[null], [{}], [{ gameId: "" }], [{ gameId: "a/b" }]])("ignores a malformed event %#", async (detail) => {
    signIn();
    const { result } = mount();
    fire(detail);
    await act(async () => {});
    expect(result.current.pathname).toBe("/lobby");
    expect(h.getNotificationGame).not.toHaveBeenCalled();
    expect(h.game.openGame).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    signIn();
    const { unmount } = mount();
    unmount();
    fire({ gameId: "g1" });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
