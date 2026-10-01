/**
 * Regression guard: on a 390px phone the cookie/analytics banner used to sit
 * on top of the signup card's "Create Account" button (and the "Already have
 * an account? Sign in" toggle under it), so the primary CTA was half covered
 * with no way to scroll it clear.
 *
 * ConsentBanner now reserves its own height at the bottom of the document
 * while it is visible. This spec deliberately does NOT pre-answer consent
 * (unlike every other spec — see helpers/consent.ts) so the banner mounts.
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("cookie banner never covers the /auth signup actions at 390x844", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();

  const banner = page.getByRole("region", { name: "Cookie and analytics notice" });
  await expect(banner).toBeVisible();

  // Scroll to the very end of the page, as a user reaching for the CTA would.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const bannerBox = await banner.locator("> div").boundingBox();
  expect(bannerBox).not.toBeNull();
  for (const action of [
    page.getByRole("button", { name: "Create Account", exact: true }),
    page.getByRole("button", { name: /Already have an account/ }),
  ]) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(bannerBox!.y);
    // Hit-test only: confirms nothing intercepts the pointer, without submitting.
    await action.click({ trial: true, timeout: 2_000 });
  }

  // Consent semantics are unchanged: nothing is recorded until the user answers.
  expect(await page.evaluate(() => localStorage.getItem("sh_analytics_consent"))).toBeNull();
  await banner.getByRole("button", { name: "OK" }).click();
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("sh_analytics_consent"))).toBe("accepted");
  await expect(page.locator("html")).not.toHaveClass(/consent-banner-open/);
});
