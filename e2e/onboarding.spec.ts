/**
 * E2E coverage for the onboarding tour redesign (Wave 1).
 *
 * The tour is rendered by <TutorialOverlay> as a non-blocking coach mark — a
 * non-modal `role="dialog"` labelled by the step title. These tests assert the
 * dialog's lifecycle on the lobby, persistence across reloads, pause-on-game,
 * keyboard semantics, cross-tab dismissal, and replay-from-Settings re-arm.
 *
 * Conventions mirrored from auth.spec.ts and game.spec.ts:
 *   - clearAll() in beforeEach for emulator isolation
 *   - sign up via UI so the AuthContext + OnboardingProvider see a real uid
 *   - semantic queries only (getByRole / getByLabel) — no class-name assertions
 *
 * The tour is gated by AuthContext.activeProfile, so tests sign up + complete
 * profile setup before asserting tour visibility on the lobby.
 *
 * Visibility note: the dialog wrapper itself has no intrinsic layout (its
 * children are `position: fixed`), so its bounding box is zero and Playwright
 * reports the wrapper as `hidden` even when the bubble paints. We resolve
 * visibility via the bubble's progressbar — a stable, sized, role-based
 * anchor — and reach into the dialog subtree for descendant queries.
 */

import { test, expect, type BrowserContext, type Page, type Locator } from "@playwright/test";
import { clearAll } from "./helpers/emulator";

// ─── Constants pinned from production source ─────────────────────────────────
//
// Mirror values from src/services/onboarding.ts and tutorialSteps.ts so a
// TUTORIAL_VERSION bump or step-count change shows up here as a focused diff.
const TUTORIAL_VERSION = 2;
const TUTORIAL_TOTAL_STEPS = 5;

function dismissedKey(uid: string): string {
  return `skatehubba.onboarding.dismissed.v${TUTORIAL_VERSION}.${uid}`;
}

// ─── Shared UI helpers (mirroring auth.spec.ts / game.spec.ts patterns) ──────

async function fillAgeFields(page: Page) {
  await expect(page.getByLabel("Birth month")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Birth month").fill("01");
  await page.getByLabel("Birth day").fill("15");
  await page.getByLabel("Birth year").fill("2000");
}

async function signUpAndSetupProfile(page: Page, email: string, password: string, username: string) {
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("http://localhost:9099/", { mode: "no-cors" }).catch(() => {});
    await fetch("http://localhost:8080/", { mode: "no-cors" }).catch(() => {});
  });
  await page.getByRole("button", { name: "Use email", exact: true }).click();
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill(email);
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill(password);
  await pwFields.nth(1).fill(password);
  await fillAgeFields(page);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });

  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("sk8legend").fill(username);
  await expect(page.getByText(`@${username} is available ✓`)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Lock It In" }).click();
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
}

async function getCurrentUid(page: Page): Promise<string> {
  const uid = await page.evaluate(() => {
    type E2EAuth = { currentUser?: { uid?: string } };
    const auth = (globalThis as unknown as Record<string, E2EAuth | undefined>).__e2eFirebaseAuth;
    return auth?.currentUser?.uid ?? null;
  });
  expect(uid, "expected an authenticated user").toBeTruthy();
  return uid as string;
}

// ─── Tour locators ───────────────────────────────────────────────────────────

/**
 * Visibility anchor for the tour: the bubble's grip-tape progressbar. The
 * progressbar has stable role + aria-label "Step N of M" and renders with a
 * non-zero box, so toBeVisible / toBeHidden behave intuitively here even
 * though the dialog wrapper itself is laid-out at zero size.
 */
function tourProgress(page: Page): Locator {
  return page.getByRole("progressbar", { name: /^Step \d+ of \d+$/ });
}

/**
 * The dialog wrapper as a containment scope for descendant queries
 * (`getByRole("button", …)`). Used for finding the close / skip / back /
 * primary-CTA buttons within the dialog subtree.
 */
function tourDialog(page: Page): Locator {
  return page.locator('[role="dialog"][aria-labelledby="onboarding-title"]');
}

// ─── Setup ───────────────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test("fresh user sees tour dialog on lobby with skip / back / next CTAs", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-fresh@test.com", "password123", "tourfresh");

  const progress = tourProgress(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });
  // role="dialog" + aria-labelledby targets the welcome step's title.
  const dialog = tourDialog(page);
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator("#onboarding-title")).toHaveText(/welcome/i);

  // Close affordance with accessible name "close tour".
  await expect(dialog.getByRole("button", { name: /close tour/i })).toBeVisible();

  // Step 0 CTAs: primary "show me", "skip" present, "back" hidden.
  await expect(dialog.getByRole("button", { name: "show me" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "skip" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "back" })).toHaveCount(0);

  // Progressbar exposes the step count for AT.
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await expect(progress).toHaveAttribute("aria-valuemax", String(TUTORIAL_TOTAL_STEPS));
});

test("primary CTA advances the tour and the step persists across reloads", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-advance@test.com", "password123", "touradv");

  const progress = tourProgress(page);
  const dialog = tourDialog(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });
  await expect(progress).toHaveAttribute("aria-valuenow", "1");

  await dialog.getByRole("button", { name: "show me" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "2", { timeout: 10_000 });
  // Step label renders twice in the bubble — once as the visible "Step N of M"
  // chip and once as an sr-only live-region announcement. Both must reflect
  // the new index, so assert at least one node is attached.
  await expect(dialog.getByText(`Step 2 of ${TUTORIAL_TOTAL_STEPS}`).first()).toBeAttached();

  // Reload — the tour resumes at the same step (localStorage progress key).
  await page.reload();
  const resumedProgress = tourProgress(page);
  await expect(resumedProgress).toBeVisible({ timeout: 10_000 });
  await expect(resumedProgress).toHaveAttribute("aria-valuenow", "2");
});

test("Enter advances when bubble has focus; Enter inside an input does not", async ({ page }) => {
  // The keydown guard skips Enter/Space when the focus target is an INPUT,
  // TEXTAREA, SELECT, or contenteditable — but the lobby in its post-profile
  // state has no guaranteed text input the test can rely on. The unit suite
  // under src/components/onboarding/__tests__ already covers the typing-target
  // branch deterministically; covering it end-to-end without flake requires a
  // stable input target on the lobby surface (e.g. a future search field or
  // an explicit data-tutorial-input hook).
  test.fixme(
    true,
    "lobby has no deterministic text input to focus while tour is active — needs production-side hook before this test can run without flake",
  );

  await signUpAndSetupProfile(page, "tour-enter@test.com", "password123", "tourenter");
  const progress = tourProgress(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });

  // Focus the bubble's primary CTA and press Enter — should advance.
  await tourDialog(page).getByRole("button", { name: "show me" }).focus();
  await page.keyboard.press("Enter");
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
});

test("Escape dismisses the tour and the dismissed flag persists across reload", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-esc@test.com", "password123", "touresc");

  const progress = tourProgress(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });

  const uid = await getCurrentUid(page);

  await page.keyboard.press("Escape");
  await expect(progress).toBeHidden({ timeout: 5_000 });

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), dismissedKey(uid));
  expect(stored).toBe("1");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
  await expect(tourProgress(page)).toBeHidden();
});

test("close (×) button dismisses the tour and persists across reload", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-close@test.com", "password123", "tourclose");

  const progress = tourProgress(page);
  const dialog = tourDialog(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });

  const uid = await getCurrentUid(page);

  await dialog.getByRole("button", { name: /close tour/i }).click();
  await expect(progress).toBeHidden({ timeout: 5_000 });

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), dismissedKey(uid));
  expect(stored).toBe("1");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
  await expect(tourProgress(page)).toBeHidden();
});

test("tour pauses (does not show) on the gameplay screen, resumes on lobby", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-pause@test.com", "password123", "tourpause");

  const progress = tourProgress(page);
  const dialog = tourDialog(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });

  // Advance once so we can verify the step is preserved (not reset) on return.
  await dialog.getByRole("button", { name: "show me" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "2", { timeout: 10_000 });

  // Navigate to /game — OnboardingContext suppresses tour on screen === "game".
  // We don't need a real active game: the screen-aware shouldShow is gated on
  // the URL/screen alone (activeGame is independent and null for fresh users).
  await page.goto("/game");
  await expect(tourProgress(page)).toBeHidden({ timeout: 5_000 });

  // Navigate back — tour resumes at the same step.
  await page.goto("/lobby");
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
  const resumed = tourProgress(page);
  await expect(resumed).toBeVisible({ timeout: 10_000 });
  await expect(resumed).toHaveAttribute("aria-valuenow", "2");
});

test("cross-tab dismissal propagates via storage event", async ({ browser }) => {
  // Two independent contexts. Each carries its own auth session — Firebase
  // auth state isn't shared across browser contexts in Playwright (separate
  // IndexedDB origins), so cross-tab sync via the localStorage `storage`
  // event can only be exercised when both tabs are in the SAME context.
  // The redesign documents same-origin tab sync, so we open two pages in a
  // single context against the same authenticated user. Tab A dismisses,
  // Tab B (without reload) reflects via the storage event.
  const ctx: BrowserContext = await browser.newContext();
  try {
    const pageA = await ctx.newPage();
    await signUpAndSetupProfile(pageA, "tour-xtab@test.com", "password123", "tourxtab");
    await expect(tourProgress(pageA)).toBeVisible({ timeout: 10_000 });

    // Tab B: same context, same origin → shares localStorage with Tab A.
    const pageB = await ctx.newPage();
    await pageB.goto("/lobby");
    await expect(pageB.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
    await expect(tourProgress(pageB)).toBeVisible({ timeout: 10_000 });

    // Tab A dismisses via Escape.
    await pageA.keyboard.press("Escape");
    await expect(tourProgress(pageA)).toBeHidden({ timeout: 5_000 });

    // Tab B should reflect the dismissal — useOnboarding listens for
    // `storage` events and re-reconciles when the dismissed key flips.
    await expect(tourProgress(pageB)).toBeHidden({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});

test("Settings → Replay onboarding re-arms the tour at step 0", async ({ page }) => {
  await signUpAndSetupProfile(page, "tour-replay@test.com", "password123", "tourreplay");

  const progress = tourProgress(page);
  const dialog = tourDialog(page);
  await expect(progress).toBeVisible({ timeout: 10_000 });

  // Skip the tour from step 0.
  await dialog.getByRole("button", { name: "skip" }).click();
  await expect(progress).toBeHidden({ timeout: 5_000 });

  // Open Settings via the lobby header's "Settings" icon button (aria-label).
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForURL("**/settings**", { timeout: 10_000 });

  // Replay the tutorial.
  await page.getByRole("button", { name: /Replay onboarding/i }).click();

  // The replay handler resets local + server state. Navigate back to the
  // lobby (manually, in case Settings doesn't auto-route in this build) and
  // assert the tour re-arms from step 0.
  await page.goto("/lobby");
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });

  const reArmed = tourProgress(page);
  await expect(reArmed).toBeVisible({ timeout: 10_000 });
  await expect(reArmed).toHaveAttribute("aria-valuenow", "1");
});
