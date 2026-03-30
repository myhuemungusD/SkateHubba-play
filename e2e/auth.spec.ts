import { test, expect } from "@playwright/test";
import { clearAll, verifyEmail } from "./helpers/emulator";

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function passAgeGate(page: import("@playwright/test").Page) {
  // Wait for age gate to render
  await expect(page.getByLabel("Birth month")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Birth month").fill("01");
  await page.getByLabel("Birth day").fill("15");
  await page.getByLabel("Birth year").fill("2000");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function signUpViaUI(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await passAgeGate(page);
  // Wait for auth form to render
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  // Fill both password fields (Password + Confirm)
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill(password);
  await pwFields.nth(1).fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  // Wait for navigation away from auth screen (profile setup or lobby)
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });
}

async function completeProfileSetup(page: import("@playwright/test").Page, username: string) {
  // Wait for the profile setup screen
  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("sk8legend").fill(username);
  // Wait for availability check to resolve (debounced 400 ms)
  await expect(page.getByText(`@${username} is available ✓`)).toBeVisible({ timeout: 5_000 });
  // Step 1 → Step 2 (stance)
  await page.getByRole("button", { name: "Next" }).click();
  // Step 2 → Step 3 (review) — "Regular" stance is pre-selected
  await page.getByRole("button", { name: "Next" }).click();
  // Step 3 — submit
  await page.getByRole("button", { name: "Lock It In" }).click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

test("emulator connectivity: sign up via SDK works", async ({ page }) => {
  // This test warms up the browser ↔ emulator connection before the real tests.
  // In CI headless Chrome, the Firebase SDK's first request to the emulator can
  // hang unless the browser has already established a connection to the host.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible({ timeout: 10_000 });

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
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await passAgeGate(page);
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill("warmup@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("password123");
  await pwFields.nth(1).fill("password123");
  await page.getByRole("button", { name: "Create Account" }).click();

  // Wait for navigation — this confirms the full SDK → emulator → onAuthStateChanged flow works
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });
  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
});

test("sign up → profile setup → lobby", async ({ page }) => {
  await signUpViaUI(page, "player@test.com", "password123");
  await completeProfileSetup(page, "sk8player");

  // Should be on the lobby
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("@sk8player")).toBeVisible();
});

test("sign up form rejects mismatched passwords", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await passAgeGate(page);

  await page.getByPlaceholder("you@email.com").fill("test@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("password123");
  await pwFields.nth(1).fill("different456");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page.getByText("Passwords don't match")).toBeVisible();
});

test("sign up form rejects short passwords", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await passAgeGate(page);

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

  // "Challenge Someone" is disabled for unverified users
  const challengeBtn = page.getByRole("button", { name: "Challenge Someone" });
  await expect(challengeBtn).toBeDisabled();

  // Verify the email via the emulator REST API (simulates clicking the email link)
  await verifyEmail(email);

  // Reload so Firebase SDK re-reads the updated emailVerified flag
  await page.reload();

  // Banner should be gone and challenge button enabled
  await expect(banner).not.toBeVisible({ timeout: 10_000 });
  await expect(challengeBtn).toBeEnabled();
});

test("sign in with existing account reaches lobby", async ({ page }) => {
  // Sign up first to create the account
  await signUpViaUI(page, "returner@test.com", "password123");
  await completeProfileSetup(page, "returner");

  // Sign out
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByText("S.K.A.T.E.")).toBeVisible({ timeout: 5_000 });

  // Sign back in
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill("returner@test.com");
  await page.getByPlaceholder("••••••••").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/lobby**", { timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 10_000 });
});
