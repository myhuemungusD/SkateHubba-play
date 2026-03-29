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

test("diagnostic: browser-to-emulator connectivity", async ({ page }) => {
  // Capture ALL browser console output for CI debugging
  const logs: string[] = [];
  page.on("console", (msg) => {
    const text = `[browser:${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  page.on("pageerror", (err) => {
    const text = `[browser:pageerror] ${err.message}`;
    logs.push(text);
    console.log(text);
  });

  // Step 1: Load the app
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible({ timeout: 10_000 });
  console.log("[diag] App loaded");

  // Step 2: Check if emulator mode is active (window.__e2eFirebaseAuth)
  const emulatorMode = await page.evaluate(() => {
    return {
      hasE2eAuth: "__e2eFirebaseAuth" in globalThis,
      envDev: (window as unknown as Record<string, unknown>).__vite_env_DEV,
    };
  });
  console.log(`[diag] Emulator mode: __e2eFirebaseAuth=${emulatorMode.hasE2eAuth}`);

  // Step 3: Check if browser can reach Auth emulator directly via fetch
  const authReachable = await page.evaluate(async () => {
    try {
      const res = await fetch("http://localhost:9099/", { mode: "no-cors" });
      return `ok type=${res.type} status=${res.status}`;
    } catch (err) {
      return `error: ${err}`;
    }
  });
  console.log(`[diag] Auth emulator from browser (localhost): ${authReachable}`);

  const authReachable2 = await page.evaluate(async () => {
    try {
      const res = await fetch("http://127.0.0.1:9099/", { mode: "no-cors" });
      return `ok type=${res.type} status=${res.status}`;
    } catch (err) {
      return `error: ${err}`;
    }
  });
  console.log(`[diag] Auth emulator from browser (127.0.0.1): ${authReachable2}`);

  // Step 4: Try creating a user via REST API from the browser
  const restSignup = await page.evaluate(async () => {
    try {
      const res = await fetch("http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "browser-diag@test.com", password: "password123", returnSecureToken: true }),
      });
      const data = await res.json();
      return `status=${res.status} uid=${(data as Record<string, string>).localId ?? "NONE"} error=${(data as Record<string, unknown>).error ?? "NONE"}`;
    } catch (err) {
      return `fetch_error: ${err}`;
    }
  });
  console.log(`[diag] REST signup from browser: ${restSignup}`);

  // Step 5: Check Firestore emulator reachability
  const fsReachable = await page.evaluate(async () => {
    try {
      const res = await fetch("http://localhost:8080/", { mode: "no-cors" });
      return `ok type=${res.type} status=${res.status}`;
    } catch (err) {
      return `error: ${err}`;
    }
  });
  console.log(`[diag] Firestore emulator from browser: ${fsReachable}`);

  // Step 6: Try the actual sign-up flow and capture what happens
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByLabel("Birth month")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Birth month").fill("01");
  await page.getByLabel("Birth day").fill("15");
  await page.getByLabel("Birth year").fill("2000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill("diag@test.com");
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill("password123");
  await pwFields.nth(1).fill("password123");
  await page.getByRole("button", { name: "Create Account" }).click();
  console.log("[diag] Create Account clicked");

  // Wait 3 seconds then check SDK auth state directly
  await page.waitForTimeout(3_000);

  // Check Firebase Auth SDK state via exposed __e2eFirebaseAuth
  const sdkState = await page.evaluate(() => {
    const auth = (globalThis as Record<string, unknown>).__e2eFirebaseAuth as
      | {
          currentUser?: { uid?: string; email?: string } | null;
          _isInitialized?: boolean;
          config?: { apiHost?: string; apiKey?: string };
          emulatorConfig?: unknown;
        }
      | undefined;
    if (!auth) return "NO_AUTH_OBJECT";
    return JSON.stringify({
      hasCurrentUser: !!auth.currentUser,
      uid: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      isInitialized: auth._isInitialized ?? "unknown",
      apiHost: auth.config?.apiHost ?? "unknown",
      apiKey: auth.config?.apiKey ?? "unknown",
      hasEmulatorConfig: !!auth.emulatorConfig,
    });
  });
  console.log(`[diag] SDK auth state after 3s: ${sdkState}`);

  const url = page.url();
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "COULD NOT GET BODY TEXT");
  console.log(`[diag] After 3s: URL=${url}`);
  console.log(`[diag] After 3s: page text (first 800 chars): ${bodyText.slice(0, 800)}`);

  // Now wait for navigation
  try {
    await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });
    console.log(`[diag] SUCCESS: navigated to ${page.url()}`);
  } catch {
    console.log(`[diag] NAVIGATION TIMEOUT! URL stuck at ${page.url()}`);
    // Dump ALL browser logs (not just last 30)
    console.log(`[diag] === ALL BROWSER LOGS (${logs.length}) ===`);
    logs.forEach((l) => console.log(`  ${l}`));
    console.log("[diag] === END BROWSER LOGS ===");
    throw new Error(`Navigation failed. URL stuck at ${url}. See [diag] logs above.`);
  }

  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
  console.log("[diag] Profile setup visible - FULL SUCCESS");
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
