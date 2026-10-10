/**
 * Phone overflow guard for the pre-JS LCP shells and the legal pages.
 *
 * iPhone SE (375x667, DPR 2) and iPhone 16 (393x852, DPR 3). The shell in
 * index.html must be gone once React has committed — it is position:fixed
 * and used to stay on screen over the real UI. scrollWidth must not exceed
 * the layout viewport.
 *
 * Signed-out /feed is not in this list: App replaces that URL with /, so a
 * check here would be another landing-page test. Lighthouse CI has the same
 * limit — its /feed run scores the landing page, not the clips feed.
 */
import { test, expect, type Page } from "@playwright/test";

const PHONES = [
  { name: "iphone se", width: 375, height: 667, dpr: 2 },
  { name: "iphone 16", width: 393, height: 852, dpr: 3 },
] as const;

const ROUTES = [
  { path: "/", heading: /skatehubba/i },
  { path: "/auth", heading: "Create Account" },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
] as const;

async function expectMountedLayout(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await expect(page.locator(".lcp-shell")).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: phone.dpr,
      isMobile: true,
      hasTouch: true,
    });

    test("public routes fit and the lcp shell is gone", async ({ page }) => {
      test.setTimeout(90_000);
      for (const route of ROUTES) {
        await page.goto(route.path);
        await expectMountedLayout(page, route.heading);
      }
    });
  });
}
