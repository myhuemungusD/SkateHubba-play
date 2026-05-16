/**
 * E2E for the offline-state resilience UX (audit F8).
 *
 * <OfflineBanner> subscribes to `useOnlineStatus`, which mirrors
 * `navigator.onLine` and listens for the browser's `online` / `offline`
 * window events. Playwright's `context.setOffline()` flips `navigator.onLine`
 * and fires those events deterministically, so we don't need to tamper
 * with global mocks.
 *
 * Beyond the banner, this spec asserts that the cached UI shell (header,
 * "Your Games" heading) remains responsive while offline. The Firestore
 * persistent cache (configured in `src/firebase.ts`) lets the lobby keep
 * rendering its last snapshot — a regression that yanks the UI on
 * disconnect would corrupt that contract.
 */
import { test, expect } from "@playwright/test";
import { clearAll } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

const USER = { email: "offline@test.com", password: "password123", username: "offliner" };

test.beforeEach(async () => {
  await clearAll();
});

test("going offline shows the offline banner; going back online hides it", async ({ page, context }) => {
  await signUpAndSetupProfile(page, USER.email, USER.password, USER.username);

  const banner = page.getByText(/You.?re offline/i);

  // Sanity: online by default → banner hidden.
  await expect(banner).toHaveCount(0);

  // Trip the offline state. `setOffline(true)` updates navigator.onLine and
  // dispatches the `offline` event the `useOnlineStatus` subscribe handler
  // listens for.
  await context.setOffline(true);
  await expect(banner).toBeVisible({ timeout: 5_000 });
  // The banner uses role="status" with aria-live="assertive" so screen
  // readers announce it without polling — assert the role hook directly.
  await expect(page.getByRole("status").filter({ hasText: /You.?re offline/i })).toBeVisible();

  // Restore connectivity → banner disappears.
  await context.setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 5_000 });
});

test("lobby UI shell stays mounted while offline (cached snapshot)", async ({ page, context }) => {
  await signUpAndSetupProfile(page, USER.email, USER.password, USER.username);

  // Capture a stable element from the cached lobby before the disconnect.
  const heading = page.getByRole("heading", { name: "Your Games" });
  await expect(heading).toBeVisible();

  await context.setOffline(true);
  // Banner appears AND the cached heading is still in the DOM — a
  // regression that unmounts the lobby on disconnect would fail this.
  await expect(page.getByText(/You.?re offline/i)).toBeVisible({ timeout: 5_000 });
  await expect(heading).toBeVisible();

  await context.setOffline(false);
});
