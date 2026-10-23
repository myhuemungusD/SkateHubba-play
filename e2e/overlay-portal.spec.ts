/**
 * Full-screen overlays must cover the screen, not the box they were opened
 * from. A `fixed inset-0` overlay is laid out against its nearest ancestor
 * with a backdrop-filter, transform (or translate / scale / rotate), filter, perspective, contain or
 * will-change, if there is one: the .glass profile header (blur) squeezed
 * the ••• Report dialog into its ~60px strip at 320 (hesher MF-C2), and a
 * forwards `animate-fade-in` leaves `transform: translateY(0)` on its box for
 * good. These overlays portal to <body>; this spec checks it in a browser.
 *
 * SHOTS_DIR=/some/dir saves a screenshot of each open overlay.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { clearAll, createProfile, createUser } from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";
import { dismissBottomOverlays } from "./helpers/lobby-nav";

async function expectCoversViewport(page: Page, dialog: Locator, name: string): Promise<void> {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp, `${name}: no box`).toBeTruthy();
  const share = (box!.width * box!.height) / (vp!.width * vp!.height);
  expect(share, `${name} covers ${(share * 100).toFixed(0)}% of the viewport`).toBeGreaterThanOrEqual(0.9);
  const traps = await dialog.evaluate((el) => {
    const found: string[] = [];
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const hit =
        (s.backdropFilter && s.backdropFilter !== "none") ||
        s.transform !== "none" ||
        s.translate !== "none" ||
        s.scale !== "none" ||
        s.rotate !== "none" ||
        s.filter !== "none" ||
        s.perspective !== "none" ||
        /paint|layout|strict|content/.test(s.contain) ||
        /transform|filter|perspective/.test(s.willChange);
      if (hit) found.push(`${a.tagName.toLowerCase()}.${String(a.className).split(" ").slice(0, 4).join(".")}`);
    }
    return found;
  });
  expect(traps, `${name} sits inside containing-block ancestors`).toEqual([]);
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test.describe("full-screen overlays at 320", () => {
  test.beforeEach(async ({ page }) => {
    await clearAll();
    await page.setViewportSize({ width: 320, height: 640 });
  });

  test("••• → Report on someone's profile covers the screen (App Review 1.2)", async ({ page }) => {
    const me = await createUser("portal-me@test.com", "password123");
    const rival = await createUser("portal-rival@test.com", "password123");
    await createProfile(me.uid, "portalme", me.email, true, false);
    await createProfile(rival.uid, "longhandleskater20", rival.email, true, false);
    await signInViaUI(page, "portal-me@test.com", "password123");
    await dismissBottomOverlays(page);
    await page.goto(`/player/${rival.uid}`);
    await expect(page.getByRole("heading", { level: 1, name: /longhandleskater20/ })).toBeVisible({ timeout: 15_000 });
    await dismissBottomOverlays(page);

    const more = page.getByRole("button", { name: "More options for @longhandleskater20" });
    await more.click();
    await page.getByRole("dialog").getByRole("button", { name: "Report", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Report @longhandleskater20" });
    await expect(report.getByLabel("Reason")).toBeVisible();
    await expectCoversViewport(page, report, "player-report-320");

    await report.getByRole("button", { name: "Cancel" }).click();
    await expect(report).toBeHidden();
    await expect(more).toBeFocused();
  });

  test("the avatar picker on your own profile covers the screen", async ({ page }) => {
    const me = await createUser("portal-own@test.com", "password123");
    await createProfile(me.uid, "portalown", me.email, true, false);
    await signInViaUI(page, "portal-own@test.com", "password123");
    await dismissBottomOverlays(page);
    await page.goto(`/player/${me.uid}`);
    await dismissBottomOverlays(page);
    await page.getByRole("button", { name: "Edit profile picture" }).click();
    await expectCoversViewport(page, page.getByRole("dialog", { name: "Choose profile picture" }), "avatar-picker-320");
  });
});
