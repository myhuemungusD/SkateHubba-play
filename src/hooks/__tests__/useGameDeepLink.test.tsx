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
  online: true,
  loadNotificationGame: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../../context/AuthContext", () => ({ useAuthContext: () => h.auth }));
vi.mock("../../context/NavigationContext", () => ({ useNavigationContext: () => h.nav }));
vi.mock("../../context/GameContext", () => ({ useGameContext: () => h.game }));
vi.mock("../../context/NotificationContext", () => ({ useNotifications: () => ({ notify: h.notify }) }));
vi.mock("../../components/GameNotificationWatcher", () => ({ OPEN_GAME_EVENT: "skatehubba:open-game" }));
vi.mock("../../services/notifications", () => ({
  loadNotificationGame: (...args: unknown[]) => h.loadNotificationGame(...args),
}));
vi.mock("../useOnlineStatus", () => ({ useOnlineStatus: () => h.online }));
vi.mock("../../services/logger", () => ({ logger: h.logger }));

import { useGameDeepLink } from "../useGameDeepLink";

const KEY = "skate.pendingGameLink";
const DENIED = expect.objectContaining({ type: "error", title: "You can't open that game" });
const LOAD_FAILED = expect.objectContaining({ type: "info", title: "Couldn't open that game" });

function game(overrides: Partial<GameDoc> = {}): GameDoc {
  return { id: "g1", player1Uid: "u1", player2Uid: "u2", status: "active", ...overrides } as GameDoc;
}

const found = (g: GameDoc) => ({ status: "found", game: g });
const FAILED = { status: "failed" };

function signIn(screen = "lobby") {
  h.auth.user = { uid: "u1" };
  h.auth.activeProfile = { uid: "u1" };
  h.nav.screen = screen;
}

/** A link main.tsx parked from /?game=<id> before the router mounted. */
function park(id: string) {
  sessionStorage.setItem(KEY, id);
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
  h.online = true;
  h.loadNotificationGame.mockResolvedValue({ status: "unavailable" });
});

describe("useGameDeepLink: parked link (push tap cold load)", () => {
  it("opens a game from the loaded list without a read, then clears the link", async () => {
    park("g1");
    signIn();
    const g = game();
    h.game.games = [g];
    mount();
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.loadNotificationGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("fetches a game the list doesn't have yet (cold start) and opens it", async () => {
    park("g2");
    signIn();
    const g = game({ id: "g2", player1Uid: "u9", player2Uid: "u1" });
    h.loadNotificationGame.mockResolvedValue(found(g));
    mount();
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.loadNotificationGame).toHaveBeenCalledWith("g2");
  });

  it("opens a game this account judges", async () => {
    park("g1");
    signIn();
    const g = game({ player1Uid: "u8", player2Uid: "u9", judgeId: "u1" });
    h.loadNotificationGame.mockResolvedValue(found(g));
    mount();
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
  });

  it("falls back to the lobby with the access-denied toast when the game is gone or unreadable", async () => {
    park("g1");
    signIn("me");
    mount("/me");
    await waitFor(() => expect(h.nav.setScreen).toHaveBeenCalledWith("lobby"));
    expect(h.notify).toHaveBeenCalledWith(DENIED);
    expect(h.game.openGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("refuses a game this account isn't in", async () => {
    park("g1");
    signIn();
    h.loadNotificationGame.mockResolvedValue(found(game({ player1Uid: "u8", player2Uid: "u9", judgeId: null })));
    mount();
    await waitFor(() => expect(h.nav.setScreen).toHaveBeenCalledWith("lobby"));
    expect(h.game.openGame).not.toHaveBeenCalled();
  });

  it("ignores a tampered parked id", async () => {
    park("../users/u2");
    signIn();
    mount();
    await act(async () => {});
    expect(h.loadNotificationGame).not.toHaveBeenCalled();
  });
});

describe("useGameDeepLink: signed out", () => {
  it("parks the id through sign-in and profile setup, then opens the game", async () => {
    park("g1");
    const g = game();
    h.game.games = [g];
    const { rerender } = mount("/");
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

  it("drops a fetch that resolves after the user signed out", async () => {
    park("g1");
    signIn();
    let resolve!: (r: unknown) => void;
    h.loadNotificationGame.mockReturnValue(new Promise((r) => (resolve = r)));
    const { rerender } = mount();
    await waitFor(() => expect(h.loadNotificationGame).toHaveBeenCalled());
    h.auth.user = null;
    h.auth.activeProfile = null;
    rerender();
    await act(async () => resolve(found(game())));
    expect(h.game.openGame).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBe("g1");
  });
});

describe("useGameDeepLink: offline tap (read failed)", () => {
  /** A parked link whose first read fails while the device is offline. */
  async function mountOfflineTap() {
    park("g1");
    signIn();
    h.online = false;
    h.loadNotificationGame.mockResolvedValue(FAILED);
    const view = mount();
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(LOAD_FAILED));
    return view;
  }

  it("keeps the link, shows the neutral toast, and opens the game once back online", async () => {
    const { rerender } = await mountOfflineTap();
    expect(h.notify).not.toHaveBeenCalledWith(DENIED);
    expect(h.nav.setScreen).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBe("g1");
    expect(h.logger.info).toHaveBeenCalledWith("game_link_load_failed", { gameId: "g1" });

    // Still offline: an unrelated re-render doesn't hammer the read.
    rerender();
    await act(async () => {});
    expect(h.loadNotificationGame).toHaveBeenCalledTimes(1);

    const g = game();
    h.loadNotificationGame.mockResolvedValue(found(g));
    h.online = true;
    rerender();
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.loadNotificationGame).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("waits for the next reconnect when the device drops offline again", async () => {
    park("g1");
    signIn();
    h.loadNotificationGame.mockResolvedValue(FAILED);
    const { rerender } = mount();
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(LOAD_FAILED));

    h.online = false;
    rerender();
    await act(async () => {});
    expect(h.loadNotificationGame).toHaveBeenCalledTimes(1);

    h.online = true;
    rerender();
    await waitFor(() => expect(h.loadNotificationGame).toHaveBeenCalledTimes(2));
  });

  it("drops the link on reconnect if the user opened another game meanwhile", async () => {
    const { rerender } = await mountOfflineTap();

    h.game.activeGame = { id: "other" };
    h.nav.screen = "game";
    h.loadNotificationGame.mockResolvedValue(found(game()));
    rerender();
    h.online = true;
    rerender();
    await waitFor(() => expect(h.loadNotificationGame).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(h.game.openGame).not.toHaveBeenCalled();
    expect(h.nav.setScreen).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledWith("game_link_dropped_user_moved_on", { gameId: "g1" });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("shows access-denied after reconnect when the game really isn't readable", async () => {
    const { rerender } = await mountOfflineTap();

    h.loadNotificationGame.mockResolvedValue({ status: "unavailable" });
    h.online = true;
    rerender();
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(DENIED));
    expect(h.nav.setScreen).toHaveBeenCalledWith("lobby");
  });

  it("tries a new tap straight away even while waiting to reconnect", async () => {
    await mountOfflineTap();

    const g = game({ id: "g5" });
    h.loadNotificationGame.mockResolvedValue(found(g));
    fire({ gameId: "g5" });
    await waitFor(() => expect(h.game.openGame).toHaveBeenCalledWith(g));
    expect(h.loadNotificationGame).toHaveBeenLastCalledWith("g5");
  });
});

describe("useGameDeepLink: in-app taps (OPEN_GAME_EVENT)", () => {
  it("opens the game a tap names, fetching it when the list is empty", async () => {
    signIn();
    const g = game({ id: "g3" });
    h.loadNotificationGame.mockResolvedValue(found(g));
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
    expect(h.loadNotificationGame).not.toHaveBeenCalled();
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
    expect(h.loadNotificationGame).not.toHaveBeenCalled();
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
