/**
 * Shared auth + profile-setup UI helpers for Playwright e2e specs.
 *
 * Three specs (auth, game, onboarding) used to inline near-identical copies of
 * fillAgeFields / signUpViaUI / completeProfileSetup / signUpAndSetupProfile /
 * signInViaUI, each diverging slightly. Centralizing the canonical flow keeps
 * the test-dup gate green and prevents drift the next time the auth screen or
 * profile-setup card is restyled.
 *
 * The signup helper primes emulator connections via no-cors fetch — harmless
 * for warm connections, prevents Firebase SDK first-request hangs in CI.
 *
 * Both entry points pre-answer the cookie/analytics consent prompt before their
 * first navigation. ConsentBanner is `fixed bottom-0 … z-50` until answered and
 * therefore sits over the bottom nav (`z-40`) and the recorder controls, so
 * every authenticated flow needs it gone. Seeding it here — rather than
 * clicking it away later — is the single, race-free mechanism: the banner
 * initialises synchronously from localStorage, so it never mounts at all.
 */
import { expect, type Page } from "@playwright/test";
import { CONSENT_ANSWERED_SCRIPT } from "./consent";
import { expectOnLobby } from "./lobby-nav";

/**
 * Fill the inline DOB fields on the AuthScreen signup card with a valid adult
 * DOB. There is no standalone age-gate screen — DOB is collected on the same
 * card as email + password.
 */
export async function fillAgeFields(page: Page): Promise<void> {
  await expect(page.getByLabel("Birth month")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Birth month").fill("01");
  await page.getByLabel("Birth day").fill("15");
  await page.getByLabel("Birth year").fill("2000");
}

/**
 * Drive the signup card from cold landing to a successful create-account that
 * navigates to /profile or /lobby (depending on whether profile setup is
 * still pending). Does NOT complete profile setup — pair with
 * completeProfileSetup() or use signUpAndSetupProfile() for the full flow.
 */
export async function signUpViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.addInitScript(CONSENT_ANSWERED_SCRIPT);
  await page.goto("/");
  // Prime emulator connections from the browser to prevent SDK hangs in CI
  // headless Chrome. Harmless once connections are warm.
  await page.evaluate(async () => {
    await fetch("http://localhost:9099/", { mode: "no-cors" }).catch(() => {});
    await fetch("http://localhost:8080/", { mode: "no-cors" }).catch(() => {});
  });
  // The landing hero's email row is "Sign in · Create account" — there is no
  // longer a "Use email" button, and the stale locator failed every spec that
  // signs up (i.e. nearly the whole suite) the moment it was reached.
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  // Fill both password fields (Password + Confirm).
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill(password);
  await pwFields.nth(1).fill(password);
  await fillAgeFields(page);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });
}

/**
 * Complete the single-card profile setup (username + pre-selected stance).
 * Asserts the user lands on the lobby afterwards.
 */
export async function completeProfileSetup(page: Page, username: string): Promise<void> {
  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("sk8legend").fill(username);
  // Wait for availability check to resolve (debounced 400 ms).
  await expect(page.getByText(`@${username} is available ✓`)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Lock It In" }).click();
  await expectOnLobby(page);
}

/**
 * The full cold-start flow: signup card → profile setup → lobby. Used by
 * specs that need a fresh, fully-onboarded account.
 */
export async function signUpAndSetupProfile(
  page: Page,
  email: string,
  password: string,
  username: string,
): Promise<void> {
  await signUpViaUI(page, email, password);
  await completeProfileSetup(page, username);
}

/**
 * Sign an existing user back in. Skips the signup card entirely.
 */
export async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.addInitScript(CONSENT_ANSWERED_SCRIPT);
  await page.goto("/");
  // `exact` is load-bearing: the landing page carries BOTH a nav "Account"
  // button and a hero "Create account" button, and a substring match resolves
  // to two elements — a Playwright strict-mode violation, not a miss.
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expectOnLobby(page);
}
