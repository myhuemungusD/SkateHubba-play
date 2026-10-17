import { test, expect } from "@playwright/test";
import { clearAll } from "./helpers/emulator";
import { RUNNER_ENABLED } from "./helpers/feature-flags";

test.beforeEach(async () => {
  await clearAll();
});

test("skate runner route loads when the flag is on", async ({ page }) => {
  test.skip(!RUNNER_ENABLED, "Skate Runner is off unless VITE_FEATURE_RUNNER_ENABLED=true");

  await page.goto("/play/runner");
  await expect(page.getByRole("heading", { name: "Skate Runner" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("runner-score")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("runner-announce")).toHaveText("Left lane");
});
