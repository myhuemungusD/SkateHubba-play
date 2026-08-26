/**
 * Shared game-flow UI helpers for Playwright e2e specs.
 *
 * game.spec.ts and clip-upload.spec.ts both drive the setter from the lobby
 * through the challenge form to the setter's "Name your trick" step. Inlining
 * that sequence in both specs trips the test-duplication gate, so the canonical
 * flow lives here. Trick names stay per-test (they vary), so this helper stops
 * at the point where the trick-name input is ready.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createProfile, createUser, verifyEmail, forceTokenRefresh } from "./emulator";
import { MEDIA_MOCK_SCRIPT } from "./media-mock";
import { signUpAndSetupProfile, signInViaUI } from "./auth-flow";
import { openActiveGameFromLobby, openChallengeForm } from "./lobby-nav";

interface Credentials {
  email: string;
  password: string;
  username: string;
}

/**
 * From a verified, signed-in setter on the lobby: open the challenge form,
 * challenge the given opponent by handle, and wait until the setter's
 * "Name your trick" input is visible (game created in the setting phase with
 * the caller as setter).
 */
export async function challengeToSetter(page: Page, opponentHandle: string): Promise<void> {
  await openChallengeForm(page);
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

/**
 * Sign an existing player back in and open the active game they share with
 * `opponentHandle` straight from the lobby.
 *
 * The two steps are always paired in the multi-context game specs (a second
 * browser context signs in purely to take its turn), and the lobby half is no
 * longer a single click — a game the viewer can't move on hides behind the
 * "N waiting on them" disclosure — so the pair lives here rather than being
 * re-inlined per test.
 */
export async function signInAndOpenGame(page: Page, player: Credentials, opponentHandle: string): Promise<void> {
  await signInViaUI(page, player.email, player.password);
  await openActiveGameFromLobby(page, opponentHandle);
}

/** A dedicated browser context plus its first page — one simulated device. */
export interface PlayerSession {
  ctx: BrowserContext;
  page: Page;
}

/**
 * Seed `opponent` in the emulator, then open a fresh context for `setter`,
 * sign them up through the UI, verify them, and challenge `opponent` —
 * leaving the page on the setter's trick-name step.
 *
 * The media mock is installed before the first navigation so callers that go
 * on to record a clip don't need a second variant of this preamble; it is
 * inert for callers that never open the camera.
 *
 * Caller owns the returned context and must close it.
 */
export async function openSetterSession(
  browser: Browser,
  setter: Credentials,
  opponent: Credentials,
): Promise<PlayerSession> {
  const seeded = await createUser(opponent.email, opponent.password);
  await createProfile(seeded.uid, opponent.username, opponent.email, false);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(MEDIA_MOCK_SCRIPT);
  await signUpVerifiedAndChallenge(page, setter, opponent.username);
  return { ctx, page };
}

/**
 * Open a second device for `matcher`: fresh context with the media mock
 * installed, signed in, and sitting inside the active game they share with
 * `opponentHandle`.
 *
 * Caller owns the returned context and must close it.
 */
export async function openMatcherSession(
  browser: Browser,
  matcher: Credentials,
  opponentHandle: string,
): Promise<PlayerSession> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(MEDIA_MOCK_SCRIPT);
  await signInAndOpenGame(page, matcher, opponentHandle);
  return { ctx, page };
}
