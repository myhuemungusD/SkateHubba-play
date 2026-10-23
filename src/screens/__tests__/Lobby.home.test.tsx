import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { Timestamp } from "firebase/firestore";
import type { ComponentProps } from "react";
import type { GameDoc } from "../../services/games";

const svc = vi.hoisted(() => ({ getPlayerDirectory: vi.fn(), getBlockedUserIds: vi.fn() }));
vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../services/auth", () => ({ resendVerification: vi.fn() }));
vi.mock("../../services/users", async (orig) => ({
  ...(await orig<typeof import("../../services/users")>()),
  getPlayerDirectory: svc.getPlayerDirectory,
}));
vi.mock("../../services/blocking", async (orig) => ({
  ...(await orig<typeof import("../../services/blocking")>()),
  getBlockedUserIds: svc.getBlockedUserIds,
}));

import { Lobby } from "../Lobby";
import { NotificationProvider } from "../../context/NotificationContext";

type LobbyProps = ComponentProps<typeof Lobby>;

function makeGame(o: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "g1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: Timestamp.fromMillis(Date.now() + 86_400_000),
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...o,
  };
}

const base: LobbyProps = {
  profile: { uid: "u1", username: "sk8r", stance: "regular", createdAt: null },
  user: { emailVerified: true },
  games: [],
  onChallenge: vi.fn(),
  onOpenGame: vi.fn(),
  onSignOut: vi.fn(),
  onViewRecord: vi.fn(),
};

function renderLobby(o: Partial<LobbyProps> = {}) {
  return render(
    <MemoryRouter>
      <NotificationProvider uid="u1">
        <Lobby {...base} {...o} />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

const finished = (id: string, uid: string, username: string, ms: number) =>
  makeGame({
    id,
    player2Uid: uid,
    player2Username: username,
    status: "complete",
    winner: "u1",
    updatedAt: Timestamp.fromMillis(ms),
  });

beforeEach(() => {
  vi.clearAllMocks();
  svc.getPlayerDirectory.mockResolvedValue([
    { uid: "u7", username: "tony", stance: "regular", createdAt: null },
    { uid: "u1", username: "sk8r", stance: "regular", createdAt: null },
  ]);
  svc.getBlockedUserIds.mockResolvedValue(new Set());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Lobby home order", () => {
  it("stacks search, games, recently played, then Who's skating last", () => {
    vi.stubEnv("VITE_FEATURE_SPOT_PRESENCE", "true");
    renderLobby({ games: [makeGame(), finished("f1", "u3", "kid", 5)] });
    const order = ["skater-search", "recently-played", "whos-skating-button"].map((id) => screen.getByTestId(id));
    const card = screen.getByRole("button", { name: /vs @rival/i });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(order[0], card)).toBe(true);
    expect(follows(card, order[1])).toBe(true);
    expect(follows(order[1], order[2])).toBe(true);
  });

  it("replaces the big empty card with a small hint below search", () => {
    renderLobby({ games: [finished("f1", "u3", "kid", 5)] });
    const hint = screen.getByTestId("empty-lobby-hint");
    expect(hint).toHaveTextContent("No games going");
    expect(
      screen.getByTestId("skater-search").compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not read the directory until the skater searches", () => {
    renderLobby();
    expect(svc.getPlayerDirectory).not.toHaveBeenCalled();
  });

  it("search Challenge opens the challenge form for that skater", async () => {
    const onChallengeUser = vi.fn();
    renderLobby({ onChallengeUser });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search skaters by username" }), "TON");
    await userEvent.click(await screen.findByRole("button", { name: "Challenge @tony" }));
    expect(onChallengeUser).toHaveBeenCalledWith("tony");
  });

  it("search Challenge falls back to the plain challenge form without onChallengeUser", async () => {
    const onChallenge = vi.fn();
    renderLobby({ onChallenge });
    await userEvent.type(screen.getByRole("searchbox"), "tony");
    await userEvent.click(await screen.findByRole("button", { name: "Challenge @tony" }));
    expect(onChallenge).toHaveBeenCalledTimes(1);
  });
});

describe("Lobby recently played", () => {
  it("lists distinct opponents, newest first, with a wins / games record", () => {
    renderLobby({
      games: [finished("a", "u3", "kid", 10), finished("b", "u4", "pops", 30), finished("c", "u3", "kid", 20)],
    });
    const section = screen.getByTestId("recently-played");
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("pops"), expect.stringContaining("kid")]);
    expect(rows[1]).toHaveTextContent("2 / 2 won");
    expect(rows[1]).not.toHaveTextContent(/\dW|\dL/);
  });

  it("hides blocked skaters", () => {
    renderLobby({ games: [finished("a", "u3", "kid", 10)], blockedUids: new Set(["u3"]) });
    expect(screen.queryByTestId("recently-played")).toBeNull();
  });

  it("Rematch calls onRematch for a verified viewer", async () => {
    const onRematch = vi.fn().mockResolvedValue(undefined);
    renderLobby({ games: [finished("a", "u3", "kid", 10)], onRematch });
    await userEvent.click(screen.getByRole("button", { name: "Rematch @kid" }));
    expect(onRematch).toHaveBeenCalledWith("u3", "kid");
  });

  it("Rematch is disabled for an unverified viewer", () => {
    renderLobby({ games: [finished("a", "u3", "kid", 10)], onRematch: vi.fn(), user: { emailVerified: false } });
    expect(screen.getByRole("button", { name: /Rematch @kid, verify email/ })).toBeDisabled();
  });
});

describe("Lobby Find me a challenger (VITE_FEATURE_RANDOM_CHALLENGER)", () => {
  it("is hidden while the flag is off (the default)", () => {
    renderLobby();
    expect(screen.queryByTestId("find-challenger")).toBeNull();
  });

  it("shows when the flag is on and skips skaters you already have a game with", async () => {
    vi.stubEnv("VITE_FEATURE_RANDOM_CHALLENGER", "true");
    svc.getPlayerDirectory.mockResolvedValue([
      { uid: "u2", username: "rival", stance: "regular", createdAt: null },
      { uid: "u7", username: "tony", stance: "regular", createdAt: null },
    ]);
    const onChallengeUser = vi.fn();
    renderLobby({ games: [makeGame()], onChallengeUser });
    await userEvent.click(screen.getByTestId("find-challenger"));
    expect(onChallengeUser).toHaveBeenCalledWith("tony");
  });

  it("falls back to the challenge form when nobody is free", async () => {
    vi.stubEnv("VITE_FEATURE_RANDOM_CHALLENGER", "true");
    svc.getPlayerDirectory.mockResolvedValue([]);
    const onChallenge = vi.fn();
    renderLobby({ onChallenge });
    await userEvent.click(screen.getByTestId("find-challenger"));
    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  it("is disabled for an unverified viewer", () => {
    vi.stubEnv("VITE_FEATURE_RANDOM_CHALLENGER", "true");
    renderLobby({ user: { emailVerified: false } });
    expect(screen.getByTestId("find-challenger")).toBeDisabled();
  });
});
