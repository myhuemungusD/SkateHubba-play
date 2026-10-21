import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { clearAll } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

/**
 * axe-core WCAG 2.1 A/AA checks on the main screens. Runs inside the normal
 * e2e job (emulator-backed dev server), so it needs no CI job of its own.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // Print a readable summary on failure instead of a giant object diff.
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

// Scan finished frames, not entrance animations: axe reads a fading-in
// bubble's partial opacity as low contrast. The app honors this setting.
test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await clearAll();
});

test.describe("Accessibility", () => {
  test("Landing page has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible({ timeout: 10_000 });
    await scan(page);
  });

  test("Auth screen has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 10_000 });
    await scan(page);
  });

  test("Map page has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/map");
    await page.waitForLoadState("load");
    await scan(page);
  });

  test("Lobby has no detectable accessibility violations", async ({ page }) => {
    await signUpAndSetupProfile(page, "a11y-lobby@test.com", "password123", "a11ylobby");
    await scan(page);
  });

  test("Settings page has no detectable accessibility violations", async ({ page }) => {
    await signUpAndSetupProfile(page, "a11y-settings@test.com", "password123", "a11ysettings");
    // Open Settings the way a user does (lobby header icon). Firestore keeps
    // a listener open, so "networkidle" never settles; wait for the heading.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForURL("**/settings**", { timeout: 10_000 });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });
    await scan(page);
  });
});
