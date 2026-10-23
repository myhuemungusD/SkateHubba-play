/**
 * Phone overflow guard for the pre-JS LCP shells and the legal pages.
 *
 * iPhone SE (375x667, DPR 2) and iPhone 16 (393x852, DPR 3). The shell in
 * index.html must be gone once React has committed — it is position:fixed
 * and used to stay on screen over the real UI. The same phones also load
 * / and /auth with the app module withheld, so the shell word is checked
 * while it is still the first paint. scrollWidth must not exceed the
 * layout viewport, and the word itself must sit inside it.
 *
 * Signed-out /feed is not in this list: App replaces that URL with /, so a
 * check here would be another landing-page test. Lighthouse CI has the same
 * limit — its /feed run scores the landing page, not the clips feed.
 */
import { test, expect, type Page } from "@playwright/test";
import { clearAll, createProfile, createUser } from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";

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

/** Home and auth shells, measured with the app module withheld. */
const SHELLS = [
  { path: "/", shell: ".lcp-shell-home" },
  { path: "/auth", shell: ".lcp-shell-auth" },
] as const;

async function expectShellFits(page: Page, shell: string): Promise<void> {
  const word = page.locator(`${shell} .lcp-word`);
  await expect(word).toBeVisible();
  const box = await word.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);
  expect(box.left).toBeGreaterThanOrEqual(-1);
  expect(box.right).toBeLessThanOrEqual(box.innerWidth + 1);
  // About 90% of the phone. Under 80% means the word shrank off the LCP size.
  expect(box.width).toBeGreaterThan(box.innerWidth * 0.8);
  expect(box.width).toBeLessThanOrEqual(box.innerWidth);
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

    test("lcp shell fits before the app mounts", async ({ page }) => {
      test.setTimeout(90_000);
      await page.route("**/src/main.tsx*", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
      );
      for (const shell of SHELLS) {
        await page.goto(shell.path);
        await expectShellFits(page, shell.shell);
      }
    });
  });
}

test.describe("bottom nav at 320 with the largest text", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("every tab stays at least 44x44 and the bar does not scroll sideways", async ({ page }) => {
    test.setTimeout(90_000);
    const me = await createUser("nav-fit@test.com", "password123");
    await createProfile(me.uid, "navfitskater", me.email, true, false);
    await page.setViewportSize({ width: 320, height: 640 });
    await signInViaUI(page, "nav-fit@test.com", "password123");

    // iOS Dynamic Type at its largest maps to a 24px root (1.5x), the same
    // value lib/dynamicType.ts writes on device.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    const nav = page.getByRole("navigation", { name: /primary navigation/i });
    const links = nav.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      const name = await links.nth(i).getAttribute("aria-label");
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    // The bar itself must not spill past the phone. (Lobby content at 1.5x is
    // covered by the letter-row checks; this test is about the tab targets.)
    const bar = await nav.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(bar.left).toBeGreaterThanOrEqual(-1);
    expect(bar.right).toBeLessThanOrEqual(321);
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  });
});
