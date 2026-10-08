/**
 * Phone-layout guards for the issues in the Oct 2026 mobile review.
 *
 * Viewports match the review: iPhone SE, iPhone 15, Pro Max, a narrow Android
 * phone, and one landscape phone. Consent is left unanswered on the public
 * pages so the banner is actually on screen.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { clearAll, createProfile, createUser, writeDoc } from "./helpers/emulator";
import { signInViaUI, signUpAndSetupProfile } from "./helpers/auth-flow";
import { DICE_ENABLED } from "./helpers/feature-flags";
import { openSetterSession } from "./helpers/game-flow";
import { dismissBottomOverlays } from "./helpers/lobby-nav";

const PHONES = [
  { name: "se", width: 375, height: 667 },
  { name: "iphone15", width: 393, height: 852 },
  { name: "promax", width: 430, height: 932 },
  { name: "android", width: 360, height: 740 },
  { name: "landscape", width: 852, height: 393 },
] as const;

test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.documentElement;
    // Compare to innerWidth, not clientWidth. Mobile emulation keeps a few
    // pixels of scrollbar gutter in clientWidth while fixed bars size to the
    // window, which is not a sideways overflow.
    const delta = root.scrollWidth - window.innerWidth;
    let offender = "";
    if (delta > 1) {
      const nodes = document.querySelectorAll("body *");
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el) continue;
        const box = el.getBoundingClientRect();
        if (box.right > root.clientWidth + 1 || box.left < -1) {
          const cls = typeof el.className === "string" ? el.className.slice(0, 80) : "";
          offender = `${el.tagName.toLowerCase()} ${cls} left=${Math.round(box.left)} right=${Math.round(box.right)}`;
          break;
        }
      }
    }
    return { delta, offender };
  });
  expect(report.delta, report.offender).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.beforeEach(async () => {
  await clearAll();
});

test("public pages do not overflow sideways on phone widths", async ({ page }) => {
  for (const phone of PHONES) {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /skatehubba/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("landscape landing keeps Free to play under the header and sign-in above the cookie banner", async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await page.goto("/");
  const header = page.getByRole("navigation", { name: "Primary" });
  const pill = page.getByText("Free to play");
  await expect(pill).toBeVisible();
  await expect
    .poll(async () => {
      const headerBox = await header.boundingBox();
      const pillBox = await pill.boundingBox();
      if (!headerBox || !pillBox) return -1;
      return pillBox.y - (headerBox.y + headerBox.height);
    })
    .toBeGreaterThanOrEqual(-1);

  const banner = page.getByRole("region", { name: "Cookie and analytics notice" });
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.scrollIntoViewIfNeeded();
  const signBox = await signIn.boundingBox();
  const bannerBox = await banner.boundingBox();
  expect(signBox).not.toBeNull();
  expect(bannerBox).not.toBeNull();
  expect(signBox!.y + signBox!.height).toBeLessThanOrEqual(bannerBox!.y + 1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/mobile-phone-layout/after/landing-landscape.png" });
});

test("iPhone SE signup can scroll the date of birth clear of the cookie banner", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  const month = page.getByLabel("Birth month");
  await month.scrollIntoViewIfNeeded();
  const monthBox = await month.boundingBox();
  const bannerBox = await page.getByRole("region", { name: "Cookie and analytics notice" }).boundingBox();
  expect(monthBox).not.toBeNull();
  expect(bannerBox).not.toBeNull();
  expect(monthBox!.y + monthBox!.height).toBeLessThanOrEqual(bannerBox!.y + 1);
  await page.screenshot({ path: "docs/mobile-phone-layout/after/signup-se.png" });
});

test("route changes reset scroll to the top", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeLessThan(8);
});

test("the notifications panel stays inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await signUpAndSetupProfile(page, "bell@test.com", "password123", "bellskater");
  await dismissBottomOverlays(page);
  const bell = page.getByRole("button", { name: "Notifications" });
  await bell.click();
  const panel = page.getByTestId("notification-panel");
  for (const phone of PHONES) {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await expectInsideViewport(page, panel);
    await expectNoHorizontalOverflow(page);
    if (phone.name === "iphone15") {
      await page.screenshot({ path: "docs/mobile-phone-layout/after/notifications-393.png" });
    }
  }
});

test("land and miss stay on screen after a take on a short phone", async ({ browser }) => {
  const setter = { email: "setter-mobile@test.com", password: "password123", username: "settermobile" };
  const opponent = { email: "opp-mobile@test.com", password: "password123", username: "oppmobile" };
  const { ctx, page } = await openSetterSession(browser, setter, opponent);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByPlaceholder("Name your trick").fill("Kickflip");
  const open = page.getByRole("button", { name: /Open Camera/i });
  await expectInsideViewport(page, open);
  await open.click();
  await page.getByRole("button", { name: /Record —/i }).click();
  // The fake recorder's real chunk lands 50ms after start. Stopping sooner
  // yields a 15-byte blob the app rejects as too small.
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await expect(page.getByText("✓ Recorded")).toBeVisible({ timeout: 5_000 });
  const landed = page.getByRole("button", { name: "✓ Landed" });
  const missed = page.getByRole("button", { name: "✗ Missed" });
  for (const phone of [
    { width: 375, height: 667 },
    { width: 393, height: 852 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(phone);
    await expectInsideViewport(page, landed);
    await expectInsideViewport(page, missed);
    if (phone.width === 375) {
      await page.screenshot({ path: "docs/mobile-phone-layout/after/land-miss-375.png" });
    }
  }
  await expectNoHorizontalOverflow(page);
  await ctx.close();
});

test("roll dice hub, picker, and table fit a phone", async ({ page }) => {
  test.skip(!DICE_ENABLED, "Roll Dice is off unless VITE_FEATURE_DICE_ENABLED=true");
  const player = await createUser("dice-mobile@test.com", "password123");
  const opponent = await createUser("dice-opp@test.com", "password123");
  await createProfile(player.uid, "dicemobile", player.email, true);
  await createProfile(opponent.uid, "diceopp", opponent.email, true);
  await writeDoc("diceGames", "dice-layout", {
    player1Uid: player.uid,
    player2Uid: opponent.uid,
    player1Username: "dicemobile",
    player2Username: "diceopp",
    playerUids: [player.uid, opponent.uid],
    status: "active",
    currentTurn: player.uid,
    round: 1,
    roundsWon: { [player.uid]: 0, [opponent.uid]: 0 },
    rollCount: 0,
    winner: null,
    endReason: null,
    updatedAt: Date.now(),
    turnDeadline: Date.now() + 60_000,
    lastRoll: null,
  });

  await signInViaUI(page, "dice-mobile@test.com", "password123");
  for (const phone of PHONES) {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await page.goto("/dice");
    await expect(page.getByRole("heading", { name: "Roll Dice" })).toBeVisible();
    await expectInsideViewport(page, page.getByRole("button", { name: "Roll someone" }));
    await expectNoHorizontalOverflow(page);

    await page.goto("/dice/new");
    await expect(page.getByRole("heading", { name: "Roll someone" })).toBeVisible();
    await expectInsideViewport(page, page.getByRole("button", { name: "Back" }));
    await expectNoHorizontalOverflow(page);

    await page.goto("/dice/dice-layout");
    await expect(page.getByRole("button", { name: "ROLL" })).toBeVisible({ timeout: 10_000 });
    await expectInsideViewport(page, page.getByRole("button", { name: "ROLL" }));
    await expectInsideViewport(page, page.getByRole("button", { name: "Leave the match" }));
    await expectNoHorizontalOverflow(page);
    if (phone.name === "se") {
      await page.screenshot({ path: "docs/mobile-phone-layout/after/dice-se.png" });
    }
    if (phone.name === "landscape") {
      await page.screenshot({ path: "docs/mobile-phone-layout/after/dice-landscape.png" });
    }
  }
});
