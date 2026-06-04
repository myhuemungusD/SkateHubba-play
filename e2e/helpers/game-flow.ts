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
import { verifyEmail, forceTokenRefresh } from "./emulator";
import { signUpAndSetupProfile } from "./auth-flow";

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
