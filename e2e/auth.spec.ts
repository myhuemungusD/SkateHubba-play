import { test, expect } from "@playwright/test";
import { clearAll, verifyEmail } from "./helpers/emulator";

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function signUpViaUI(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByPlaceholder("you@email.com").fill(email);
  // Fill both password fields (Password + Confirm)
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill(password);
  await pwFields.nth(1).fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
}

async function completeProfileSetup(page: import("@playwright/test").Page, username: string) {
  // Wait for the profile setup screen
  await expect(page.getByText("Lock in your handle")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("sk8legend").fill(username);
  // Wait for availability check to resolve (debounced 400 ms)
  await expect(page.getByText(`@${username} is available ✓`)).toBeVisible({ timeout: 5_000 });
  // "Regular" stance is pre-selected; just submit
  await page.getByRole("button", { name: "Lock It In" }).click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
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
  await page.getByPlaceholder("you@email.com").fill("returner@test.com");
  await page.getByPlaceholder("••••••••").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 10_000 });
});
