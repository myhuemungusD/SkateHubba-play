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
 *
 * The signed-in block runs at 320 (iPhone SE 1st gen / zoomed display) and
 * 390 (iPhone 12-15): Lobby game cards, the game scoreboard and the profile
 * game history all carry two LetterPips rows, which used to push the page
 * sideways at 320.
 */
import { test, expect, type Page } from "@playwright/test";
import { clearAll, createGame, createProfile, createUser } from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";
import { dismissBottomOverlays, openActiveGameFromLobby } from "./helpers/lobby-nav";

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

const NARROW_PHONES = [
  { name: "320", width: 320, height: 640 },
  { name: "390", width: 390, height: 844 },
] as const;

/** Optional: SHOTS_DIR=/some/dir writes one screenshot per screen and width. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  // One frame for layout to settle after data lands.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(widths.innerWidth);

  // The document is not the only scroller. overflow-y:auto forces overflow-x
  // to auto (CSS Overflow 3), so a too-wide child of a screen root such as the
  // profile's is clipped and dragged sideways *inside* that div while the
  // document stays phone-wide. Any element that scrolls on x must fit, unless
  // it is a rail built to scroll sideways and says so with data-scroll-x.
  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.hasAttribute("data-scroll-x")) continue;
      const { overflowX } = getComputedStyle(el);
      if (overflowX !== "auto" && overflowX !== "scroll") continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const cls = typeof el.className === "string" ? el.className.slice(0, 120) : "";
      out.push(
        `<${el.tagName.toLowerCase()} class="${cls}"> scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
      );
    }
    return out;
  });
  expect(offenders, `${where} has an element that scrolls sideways`).toEqual([]);
}

/** Longest handles the username rules allow, so truncation and wrapping are exercised. */
async function seedLetterRows(): Promise<{ rivalUid: string }> {
  const me = await createUser("fit-me@test.com", "password123");
  const rival = await createUser("fit-rival@test.com", "password123");
  const other = await createUser("fit-other@test.com", "password123");
  await createProfile(me.uid, "fitcheckskater", me.email, true, false);
  await createProfile(rival.uid, "longhandleskater20", rival.email, true, false);
  await createProfile(other.uid, "anotherlonghandle1", other.email, true, false);

  // My turn, both sides carrying letters: the widest Lobby card.
  await createGame("fit-mine", me.uid, "fitcheckskater", rival.uid, "longhandleskater20", {
    p1Letters: 3,
    p2Letters: 4,
  });
  // Their turn, so the "waiting on them" group is populated too.
  await createGame("fit-theirs", other.uid, "anotherlonghandle1", me.uid, "fitcheckskater", {
    currentTurn: other.uid,
    currentSetter: other.uid,
    p1Letters: 2,
    p2Letters: 1,
  });
  // A finished game for the profile history row.
  await createGame("fit-done", me.uid, "fitcheckskater", rival.uid, "longhandleskater20", {
    status: "complete",
    winner: me.uid,
    p1Letters: 4,
    p2Letters: 5,
  });
  return { rivalUid: rival.uid };
}

async function signInToLobby(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await signInViaUI(page, "fit-me@test.com", "password123");
  await dismissBottomOverlays(page);
  await expect(page.getByText("@longhandleskater20").first()).toBeVisible({ timeout: 15_000 });
}

// One test per screen, so each screen's check fails on its own instead of
// hiding behind the first failure.
test.describe("signed-in letter rows", () => {
  let rivalUid = "";
  test.beforeEach(async () => {
    await clearAll();
    ({ rivalUid } = await seedLetterRows());
  });

  for (const phone of NARROW_PHONES) {
    test(`lobby fits at ${phone.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      await signInToLobby(page, phone.width, phone.height);
      await expectNoSidewaysScroll(page, "Lobby");
      await shot(page, `lobby-${phone.name}`);
    });

    test(`game fits at ${phone.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      await signInToLobby(page, phone.width, phone.height);
      await openActiveGameFromLobby(page, "longhandleskater20");
      await expect(page).toHaveURL(/\/game/, { timeout: 15_000 });
      await expect(page.getByText("YOUR MOVE")).toBeVisible({ timeout: 15_000 });
      await expectNoSidewaysScroll(page, "Game");
      await shot(page, `game-${phone.name}`);
    });

    test(`profile fits at ${phone.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      await signInToLobby(page, phone.width, phone.height);
      await page.goto(`/player/${rivalUid}`);
      await expect(page.getByRole("heading", { level: 1, name: /longhandleskater20/ })).toBeVisible({
        timeout: 15_000,
      });
      await dismissBottomOverlays(page);
      await expectNoSidewaysScroll(page, "Profile");
      await shot(page, `profile-${phone.name}`);

      // The history row carries the second pair of pip rows (MF-B1); bring
      // it on screen so the shot shows it and the check runs with it laid out.
      const historyRow = page.locator("button[aria-expanded]", { hasText: "fitcheckskater" }).first();
      await historyRow.scrollIntoViewIfNeeded();
      await expect(page.getByRole("img", { name: /^You: / }).first()).toBeVisible({ timeout: 15_000 });
      await expectNoSidewaysScroll(page, "Profile history");
      await shot(page, `profile-history-${phone.name}`);
    });
  }
});
