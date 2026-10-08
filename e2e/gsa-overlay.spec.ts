/**
 * The Google app on iOS paints a floating address bar over the webview.
 * Safari and Chrome on iOS do not. The header must drop below that bar only
 * for the Google app, at the two phone sizes from the report.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { clearAll } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";
import { dismissBottomOverlays } from "./helpers/lobby-nav";

const PHONES = [
  { width: 393, height: 852 },
  { width: 375, height: 667 },
] as const;

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const GSA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/390.0.0 Safari/604.1";

const BROWSERS = [
  { name: "safari", ua: SAFARI },
  { name: "chrome", ua: CHROME_IOS },
  { name: "gsa", ua: GSA },
] as const;

async function openPhone(browser: Browser, ua: string, viewport: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: "http://localhost:5173",
    userAgent: ua,
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  return page;
}

async function overlayPad(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop) || 0);
}

/** Safari and Chrome iOS keep a 0 inset. The Google app is the only one that pads. */
function expectGsaOnlyPad(pad: Map<string, number>, phoneWidth: number): number {
  const safariPad = pad.get(`safari:${phoneWidth}`) ?? -1;
  const chromePad = pad.get(`chrome:${phoneWidth}`) ?? -1;
  const gsaPad = pad.get(`gsa:${phoneWidth}`) ?? -1;
  expect(safariPad).toBe(0);
  expect(chromePad).toBe(0);
  expect(gsaPad).toBeGreaterThan(40);
  return gsaPad;
}

test.beforeEach(async () => {
  await clearAll();
});

test("landing chrome stays put in Safari and Chrome iOS and clears the bar in the Google app", async ({ browser }) => {
  const navY = new Map<string, number>();
  const signY = new Map<string, number>();
  const pad = new Map<string, number>();

  for (const phone of PHONES) {
    for (const agent of BROWSERS) {
      const page = await openPhone(browser, agent.ua, phone);
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
      const signIn = await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox();
      expect(nav).not.toBeNull();
      expect(signIn).not.toBeNull();
      const key = `${agent.name}:${phone.width}`;
      navY.set(key, nav!.y);
      signY.set(key, signIn!.y);
      pad.set(key, await overlayPad(page));
      await page.context().close();
    }
  }

  for (const phone of PHONES) {
    const gsaPad = expectGsaOnlyPad(pad, phone.width);

    const safariNav = navY.get(`safari:${phone.width}`) ?? -1;
    const chromeNav = navY.get(`chrome:${phone.width}`) ?? -1;
    const gsaNav = navY.get(`gsa:${phone.width}`) ?? -1;
    expect(Math.abs(safariNav)).toBeLessThanOrEqual(1);
    expect(Math.abs(chromeNav - safariNav)).toBeLessThanOrEqual(1);
    expect(Math.abs(gsaNav - gsaPad)).toBeLessThanOrEqual(1);

    const safariSign = signY.get(`safari:${phone.width}`) ?? 0;
    const chromeSign = signY.get(`chrome:${phone.width}`) ?? 0;
    const gsaSign = signY.get(`gsa:${phone.width}`) ?? 0;
    expect(Math.abs(chromeSign - safariSign)).toBeLessThanOrEqual(1);
    expect(Math.abs(gsaSign - safariSign - gsaPad)).toBeLessThanOrEqual(2);
  }
});

test("lobby Sign Out stays fully below the Google app bar and matches Safari in Chrome iOS", async ({ browser }) => {
  test.setTimeout(180_000);
  const signY = new Map<string, number>();
  const pad = new Map<string, number>();

  for (const agent of BROWSERS) {
    const page = await openPhone(browser, agent.ua, PHONES[0]);
    await signUpAndSetupProfile(page, `${agent.name}-overlay@test.com`, "password123", `${agent.name}overlay`);
    for (const phone of PHONES) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      const signOut = page.getByRole("button", { name: "Sign Out" });
      await expect(signOut).toBeVisible();
      // The lobby tour scrolls its anchor into view. On the Google app the
      // extra top padding makes that scroll non-zero, which would hide the
      // header the same way a real scroll does. Measure at rest, tour closed.
      const tour = page.locator('[data-testid="tutorial-overlay"]');
      await tour.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      await dismissBottomOverlays(page);
      await expect(tour).toHaveCount(0);
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(0, 0);
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const metrics = await page.evaluate(() => {
        const signOutButton = Array.from(document.querySelectorAll("button")).find(
          (el) => el.textContent?.trim() === "Sign Out",
        );
        const header = signOutButton?.closest(".pt-safe") ?? signOutButton;
        const buttonBox = signOutButton?.getBoundingClientRect();
        const headerBox = header?.getBoundingClientRect();
        return {
          buttonY: buttonBox?.top ?? -1,
          buttonBottom: buttonBox?.bottom ?? -1,
          headerTop: headerBox?.top ?? -1,
          pad: parseFloat(getComputedStyle(document.body).paddingTop) || 0,
          found: Boolean(signOutButton),
        };
      });
      expect(metrics.found).toBe(true);
      expect(metrics.headerTop).toBeGreaterThanOrEqual(metrics.pad - 1);
      expect(metrics.buttonY).toBeGreaterThanOrEqual(metrics.headerTop - 1);
      expect(metrics.buttonBottom).toBeLessThanOrEqual(phone.height);
      const key = `${agent.name}:${phone.width}`;
      signY.set(key, metrics.headerTop);
      pad.set(key, metrics.pad);
    }
    await page.context().close();
  }

  for (const phone of PHONES) {
    const gsaPad = expectGsaOnlyPad(pad, phone.width);

    const safariY = signY.get(`safari:${phone.width}`) ?? 0;
    const chromeY = signY.get(`chrome:${phone.width}`) ?? 0;
    const gsaY = signY.get(`gsa:${phone.width}`) ?? 0;
    expect(Math.abs(chromeY - safariY)).toBeLessThanOrEqual(1);
    expect(Math.abs(gsaY - safariY - gsaPad)).toBeLessThanOrEqual(2);
    expect(gsaY).toBeGreaterThan(safariY + 40);
  }
});
