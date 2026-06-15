/**
 * Shared game-flow UI helpers for Playwright e2e specs.
 *
 * game.spec.ts and clip-upload.spec.ts both drive the setter from the lobby
 * through the challenge form to the setter's "Name your trick" step. Inlining
 * that sequence in both specs trips the test-duplication gate, so the canonical
 * flow lives here. Trick names stay per-test (they vary), so this helper stops
 * at the point where the trick-name input is ready.
 */
import { expect, type Page } from "@playwright/test";
import { createGame, createProfile, createUser, verifyEmail, forceTokenRefresh } from "./emulator";
import { signUpAndSetupProfile } from "./auth-flow";

interface Credentials {
  email: string;
  password: string;
  username: string;
}

/** UIDs returned by seedJudgeRefGame, so specs can assert on persisted state. */
export interface SeededJudgeGame {
  setterUid: string;
  matcherUid: string;
  judgeUid: string;
}

/** Which party a uid-valued game field should resolve to. */
type Party = "setter" | "matcher" | "judge";

export interface SeedJudgeGameOptions {
  /** Game phase to seed (matching for Call-BS, disputable for landed review). */
  phase: "setting" | "matching" | "setReview" | "disputable";
  /** Who currently holds the turn — the player/judge whose action unblocks it. */
  turnHolder: Party;
  /** The player whose attempt the judge is reviewing (disputable / setReview). */
  judgeReviewFor?: Party;
  /** Non-uid field overrides (trick name, video urls, letter counts, etc.). */
  fields?: Record<string, unknown>;
}

/**
 * Seed a three-party refereed game directly via the emulator REST API: two
 * players plus an accepted judge, with the judge denormalized onto the game
 * doc so `isJudgeActive` is true and the dispute / Call-BS paths unlock.
 *
 * Players + judge are created programmatically (no UI signup) because dispute
 * specs only ever sign them in. `setter` always holds `currentSetter`; the
 * caller names the `turnHolder` (and optional `judgeReviewFor`) by ROLE and the
 * helper resolves them to the freshly-minted UIDs — the caller can't reference
 * a uid it doesn't yet have.
 *
 * Returns the three UIDs so specs can read the game back with `getGameState`
 * and assert the post-ruling transition (currentSetter rotation, letter deltas).
 */
export async function seedJudgeRefGame(
  gameId: string,
  setter: Credentials,
  matcher: Credentials,
  judge: Credentials,
  opts: SeedJudgeGameOptions,
): Promise<SeededJudgeGame> {
  const setterUser = await createUser(setter.email, setter.password);
  const matcherUser = await createUser(matcher.email, matcher.password);
  const judgeUser = await createUser(judge.email, judge.password);
  await Promise.all([
    createProfile(setterUser.uid, setter.username, setter.email, true),
    createProfile(matcherUser.uid, matcher.username, matcher.email, true),
    createProfile(judgeUser.uid, judge.username, judge.email, true),
  ]);

  const uidFor: Record<Party, string> = {
    setter: setterUser.uid,
    matcher: matcherUser.uid,
    judge: judgeUser.uid,
  };

  await createGame(gameId, setterUser.uid, setter.username, matcherUser.uid, matcher.username, {
    phase: opts.phase,
    currentSetter: setterUser.uid,
    currentTurn: uidFor[opts.turnHolder],
    judgeId: judgeUser.uid,
    judgeUsername: judge.username,
    judgeStatus: "accepted",
    ...(opts.judgeReviewFor ? { judgeReviewFor: uidFor[opts.judgeReviewFor] } : {}),
    ...(opts.fields ?? {}),
  });

  return { setterUid: setterUser.uid, matcherUid: matcherUser.uid, judgeUid: judgeUser.uid };
}

/**
 * From a verified, signed-in setter on the lobby: open the challenge form,
 * challenge the given opponent by handle, and wait until the setter's
 * "Name your trick" input is visible (game created in the setting phase with
 * the caller as setter).
 */
export async function challengeToSetter(page: Page, opponentHandle: string): Promise<void> {
  await page.getByRole("button", { name: "Challenge Someone" }).click();
  await page.getByPlaceholder("their_handle").fill(opponentHandle);
  await page.getByRole("button", { name: /Send Challenge/i }).click();
  // The challenger becomes the setter — the game opens in the setting phase
  // and the trick-name input is shown.
  await expect(page.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 10_000 });
}

/**
 * Full cold-start setter preamble shared by game.spec.ts and clip-upload.spec.ts:
 * sign up `setter` through the UI, verify their email, reload + refresh the
 * token so Firestore rules see email_verified, then challenge `opponentHandle`
 * and land on the "Name your trick" step.
 *
 * The caller must inject the media mock (page.addInitScript(MEDIA_MOCK_SCRIPT))
 * BEFORE calling this when the test will record a clip — addInitScript only
 * applies to navigations that happen after it is registered, and this helper
 * performs the first navigation via signUpAndSetupProfile().
 */
export async function signUpVerifiedAndChallenge(
  page: Page,
  setter: Credentials,
  opponentHandle: string,
): Promise<void> {
  await signUpAndSetupProfile(page, setter.email, setter.password, setter.username);
  await verifyEmail(setter.email);
  await page.reload();
  await forceTokenRefresh(page);
  await challengeToSetter(page, opponentHandle);
}
