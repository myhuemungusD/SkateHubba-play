import { vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

/**
 * Shared fixtures + DOM helpers for the PlayerProfileScreen test suite.
 *
 * Lives outside the `*.test.tsx` glob on purpose: the test-duplication gate
 * (`scripts/check-test-duplication.mjs`) only scans `*.test.ts(x)`, so hoisting
 * the common profile/game factories and scroll-container utilities here both
 * keeps the gate green and gives every PlayerProfileScreen spec one source of
 * truth for its fixtures.
 *
 * NOTE: `vi.mock(...)` factories are intentionally NOT exported from here —
 * Vitest hoists `vi.mock` to the top of the importing module, so those calls
 * must stay physically inside each test file. Only inert data + pure DOM
 * helpers belong in this module.
 */

/** The viewer ("me") — used as `currentUserProfile` in every spec. */
export const viewerProfile: UserProfile = {
  uid: "me",
  username: "viewer",
  stance: "regular",
  createdAt: null,
};

/** A second player whose public profile the viewer can open. */
export const opponentProfile: UserProfile = {
  uid: "u2",
  username: "sk8rboi",
  stance: "goofy",
  createdAt: null,
  wins: 10,
  losses: 3,
};

/**
 * Build a completed `GameDoc` between the viewer and the opponent. Defaults to
 * a clean win for the viewer with a single landed Kickflip turn; pass overrides
 * to exercise forfeits, opposite winners, empty turn history, etc.
 */
export function buildCompletedGame(overrides?: Partial<GameDoc>): GameDoc {
  return {
    id: "g1",
    player1Uid: "me",
    player2Uid: "u2",
    player1Username: "viewer",
    player2Username: "sk8rboi",
    p1Letters: 0,
    p2Letters: 5,
    status: "complete",
    currentTurn: "me",
    phase: "setting",
    currentSetter: "me",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: null,
    turnNumber: 1,
    winner: "me",
    createdAt: null,
    updatedAt: { toMillis: () => Date.now() } as GameDoc["updatedAt"],
    turnHistory: [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "me",
        setterUsername: "viewer",
        matcherUid: "u2",
        matcherUsername: "sk8rboi",
        setVideoUrl: "",
        matchVideoUrl: "",
        landed: true,
        letterTo: null,
      },
    ],
    ...overrides,
  } as GameDoc;
}

/** Shape returned by the mocked `usePlayerProfile` hook. */
export interface FetchedProfileState {
  profile: UserProfile | null;
  games: GameDoc[];
  loading: boolean;
  error: string | null;
}

/**
 * Build a `usePlayerProfile` return value. Defaults to the resolved-empty state
 * (no profile, no games, not loading, no error) — pass overrides for loading /
 * error / opponent-fetch variants.
 */
export function fetchedState(overrides?: Partial<FetchedProfileState>): FetchedProfileState {
  return { profile: null, games: [], loading: false, error: null, ...overrides };
}

/** Default props for rendering the screen as the viewer's own profile. */
export function buildBaseProps() {
  return {
    viewedUid: "me",
    currentUserProfile: viewerProfile,
    ownGames: [] as GameDoc[],
    isOwnProfile: true,
    onOpenGame: vi.fn(),
    onBack: vi.fn(),
  };
}

/** The single PTR/scroll container the screen renders at its root. */
export function getScrollContainer(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".overflow-y-auto");
  if (!el) throw new Error("scroll container not found");
  return el;
}

/**
 * Drive a top-of-scroll pull past the PTR trigger on the given element. Raw
 * travel is attenuated by the hook's resistance, so 400px clears the trigger.
 */
export function pullPastTrigger(el: HTMLElement): void {
  fireEvent.pointerDown(el, { isPrimary: true, clientY: 0 });
  fireEvent.pointerMove(el, { clientY: 400 });
}
