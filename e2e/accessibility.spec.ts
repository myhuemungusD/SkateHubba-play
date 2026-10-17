import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility checks with axe-core. Tests critical user paths for WCAG compliance.
 * Runs against the emulator-backed dev server (npm run test:e2e).
 */

test.describe("Accessibility", () => {
  test("Landing page has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("Auth screen has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/auth");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("Lobby has no detectable accessibility violations", async ({ page }) => {
    // Sign in first
    await page.goto("/auth");
    await page.getByPlaceholder("Email address").fill("test@example.com");
    await page.getByPlaceholder("Password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for lobby to load
    await page.waitForURL("/lobby", { timeout: 10000 });

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("Map page has no detectable accessibility violations", async ({ page }) => {
    // Navigate to map (requires auth in production but may be accessible in test)
    await page.goto("/map");

    // Give map time to load
    await page.waitForTimeout(2000);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("Settings page has no detectable accessibility violations", async ({ page }) => {
    // Sign in first
    await page.goto("/auth");
    await page.getByPlaceholder("Email address").fill("test@example.com");
    await page.getByPlaceholder("Password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("/lobby");

    // Navigate to settings
    await page.goto("/settings");
    await page.waitForTimeout(1000);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
