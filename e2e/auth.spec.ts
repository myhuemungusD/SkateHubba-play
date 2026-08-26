import { test, expect } from "@playwright/test";
import { clearAll, verifyEmail } from "./helpers/emulator";
import { signUpViaUI, completeProfileSetup, fillAgeFields, emailAuthOptions } from "./helpers/auth-flow";
import { expectOnLobby, openChallengeForm, tapChallengeTab } from "./helpers/lobby-nav";

// ─── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

test("emulator connectivity: sign up via SDK works", async ({ page }) => {
  // This test warms up the browser ↔ emulator connection before the real tests.
  // In CI headless Chrome, the Firebase SDK's first request to the emulator can
  // hang unless the browser has already established a connection to the host.
  await page.goto("/");
  const createAccount = emailAuthOptions(page).getByRole("button", { name: "Create account" });
  await expect(createAccount).toBeVisible({ timeout: 10_000 });

  // Verify emulator mode is active
  const connected = await page.evaluate(() => "__e2eFirebaseAuth" in globalThis);
  expect(connected).toBe(true);

  // Prime the browser's connection to emulator hosts with direct fetches.
  // This prevents the Firebase SDK's first request from hanging in CI.
  await page.evaluate(async () => {
    await fetch("http://localhost:9099/", { mode: "no-cors" }).catch(() => {});
    await fetch("http://localhost:8080/", { mode: "no-cors" }).catch(() => {});
  });

  // Do a full sign-up flow through the UI
  await createAccount.click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill("warmup@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("password123");
  await pwFields.nth(1).fill("password123");
  await fillAgeFields(page);
  await page.getByRole("button", { name: "Create Account" }).click();

  // Wait for navigation — this confirms the full SDK → emulator → onAuthStateChanged flow works
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });
  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
});

test("sign up → profile setup → lobby", async ({ page }) => {
  await signUpViaUI(page, "player@test.com", "password123");
  await completeProfileSetup(page, "sk8player");

  // Should be on the lobby
  await expectOnLobby(page);
  await expect(page.getByText("@sk8player")).toBeVisible();
});

test("sign up form rejects mismatched passwords", async ({ page }) => {
  await page.goto("/");
  await emailAuthOptions(page).getByRole("button", { name: "Create account" }).click();

  await page.getByPlaceholder("you@email.com").fill("test@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("password123");
  await pwFields.nth(1).fill("different456");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page.getByText("Passwords don't match")).toBeVisible();
});

test("sign up form rejects short passwords", async ({ page }) => {
  await page.goto("/");
  await emailAuthOptions(page).getByRole("button", { name: "Create account" }).click();

  await page.getByPlaceholder("you@email.com").fill("test@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("abc");
  await pwFields.nth(1).fill("abc");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page.getByText("Password must be 6+ characters")).toBeVisible();
});

test("email verification banner visible after sign up, hidden after verification", async ({ page }) => {
  const email = "verify@test.com";
  await signUpViaUI(page, email, "password123");
  await completeProfileSetup(page, "verifyuser");

  // Banner should be visible because email is not yet verified
  const banner = page.getByText("VERIFY YOUR EMAIL", { exact: true });
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // The lobby's own "Challenge Someone" button is gone — challenging now
  // starts from the always-enabled Challenge tab, and the gate moved to the
  // /challenge route guard (App.tsx: UnverifiedChallengeRedirect). So the
  // guarantee to assert is the bounce, not a disabled control: an unverified
  // user who taps Challenge is told why and is put back on the lobby.
  await expect(page.getByText("Verify your email to start a game")).toBeVisible();
  await tapChallengeTab(page);
  // `.first()`: the dev server runs React StrictMode, which mounts the
  // redirect component twice and therefore fires the toast twice. The
  // contract under test is the message, not how many times it rendered.
  await expect(page.getByText("Verify your email to challenge someone.").first()).toBeVisible({ timeout: 10_000 });
  await expectOnLobby(page);

  // Verify the email via the emulator REST API (simulates clicking the email link)
  await verifyEmail(email);

  // Reload so Firebase SDK re-reads the updated emailVerified flag
  await page.reload();

  // Banner should be gone and the same tap now reaches the challenge form.
  await expect(banner).not.toBeVisible({ timeout: 10_000 });
  await openChallengeForm(page);
});

test("sign in with existing account reaches lobby", async ({ page }) => {
  // Sign up first to create the account
  await signUpViaUI(page, "returner@test.com", "password123");
  await completeProfileSetup(page, "returner");

  // Sign out
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByText("S.K.A.T.E.")).toBeVisible({ timeout: 5_000 });

  // Sign back in
  await emailAuthOptions(page).getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill("returner@test.com");
  await page.getByPlaceholder("••••••••").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/lobby**", { timeout: 15_000 });

  await expectOnLobby(page);
});
