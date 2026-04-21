/**
 * E2E for the map → S.K.A.T.E. challenge wiring.
 *
 * Charter-compliant: this test seeds the spot data directly into the
 * Firestore emulator (via the named "skatehubba" database) instead of
 * stubbing an HTTP API. There is no apps/api server — the map talks
 * to Firestore exclusively, and so does this test.
 *
 * Auth-agnostic: the /map route is in PUBLIC_SCREENS, so we exercise
 * the full marker → preview card → "Challenge from here" flow without
 * touching Firebase Auth. The "Challenge from here" click as an
 * unauthenticated user lets us also assert the auth-bounce stash
 * (sessionStorage `skate.pendingChallengeSpot`) added to NavigationContext.
 */

import { test, expect, type Page } from "@playwright/test";
import { clearAll, createSpot } from "./helpers/emulator";

const SPOT_ID = "11111111-2222-3333-4444-555555555555";
const SPOT_NAME = "Test Ledge";

test.beforeEach(async () => {
  await clearAll();
  // Seed one spot in the LA viewport so the SpotMap bounds query finds
  // exactly one marker. The default lat/lng in createSpot match the map's
  // initial center (34.0522, -118.2437).
  await createSpot(SPOT_ID, "seed-user", { name: SPOT_NAME });
});

/**
 * Stub Mapbox network endpoints so GL JS can initialize without reaching
 * api.mapbox.com / *.tiles.mapbox.com. The map renders an empty basemap;
 * markers still mount as DOM overlays so the click flow works.
 */
/**
 * Strip the meta-tag CSP from the served HTML so headless Chromium can
 * reach the localhost emulators (port 8080 etc) from the page's context.
 * The production CSP blocks `http://localhost:*` because `'self'` is
 * strict same-origin (5173 ≠ 8080), and there's no dev-time relaxation.
 *
 * Test-only — production builds keep the full CSP unchanged.
 */
async function relaxCspForEmulators(page: Page): Promise<void> {
  // Vite serves index.html for any unknown SPA route. Intercept the exact
  // /map navigation (and any other top-level page request) and strip the
  // CSP meta tag from the body before it reaches the document.
  await page.route(
    /http:\/\/localhost:5173\/(map|spots|challenge|lobby|profile|game|gameover|player|auth|privacy|terms|data-deletion|404|$)/,
    async (route) => {
      const response = await route.fetch();
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("text/html")) {
        await route.fulfill({ response });
        return;
      }
      const body = await response.text();
      const stripped = body.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/i, "");
      await route.fulfill({
        response,
        body: stripped,
      });
    },
  );
}

async function stubMapbox(page: Page): Promise<void> {
  // The sprite/glyph URLs MUST point at api.mapbox.com because the CSP
  // (vercel.json) only allows api.mapbox.com / *.tiles.mapbox.com /
  // events.mapbox.com for connect-src. Anything else is blocked at the
  // browser level before page.route can intercept it.
  const emptyStyle = {
    version: 8,
    name: "e2e-stub",
    sources: {},
    layers: [],
    sprite: "https://api.mapbox.com/sprite",
    glyphs: "https://api.mapbox.com/fonts/{fontstack}/{range}.pbf",
  };
  await page.route(/api\.mapbox\.com\/styles\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyStyle) }),
  );
  // Catch the sprite + glyph URLs the empty style references plus any
  // ancillary GET to api.mapbox.com that GL JS makes during init.
  await page.route(/api\.mapbox\.com\/(events|v4|fonts|sprites|sprite)/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(/api\.mapbox\.com\/sprite/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(/\.tiles\.mapbox\.com/, (route) => route.fulfill({ status: 204, body: "" }));
}

test.describe("Map → challenge wiring", () => {
  test("Challenge from here forwards the spot id and stashes it across auth", async ({ page }) => {
    await relaxCspForEmulators(page);
    await stubMapbox(page);

    // Surface page errors / browser console for actionable CI failures —
    // the MapErrorBoundary otherwise swallows mapbox-gl crashes silently.
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      consoleMessages.push(`[pageerror] ${err.message}`);
    });

    // Capture every URL change. The auth router will bounce an
    // unauthenticated user off /challenge, so we need to assert the
    // intermediate /challenge?spot=<id> URL existed before the bounce.
    const navigatedUrls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigatedUrls.push(frame.url());
    });

    await page.goto("/map");

    // Wait for the seeded spot's marker to appear. The marker carries a
    // data-testid attached in SpotMap.createMarkerEl.
    const marker = page.locator(`[data-testid="spot-marker-${SPOT_ID}"]`);
    try {
      await expect(marker).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      console.error("[e2e] Captured browser console output:\n" + consoleMessages.join("\n"));
      throw e;
    }

    // Tap the marker to open the SpotPreviewCard.
    await marker.click();
    await expect(page.getByRole("dialog", { name: `Spot: ${SPOT_NAME}` })).toBeVisible();

    // "Challenge from here" is the primary (orange) button on the card.
    await page.getByRole("button", { name: "Challenge from here" }).click();

    // The intermediate URL must have included ?spot=<id>. Poll the captured
    // list so we don't race the auth router's bounce.
    await expect
      .poll(() => navigatedUrls.some((u) => u.includes(`/challenge?spot=${SPOT_ID}`)), {
        timeout: 5_000,
      })
      .toBe(true);

    // The auth-bounce polish stashes the spot in sessionStorage so a
    // post-login restore can reapply it. Verifying the stash survived the
    // bounce is what makes shared /challenge?spot= links work for
    // logged-out recipients.
    const stashed = await page.evaluate(() => window.sessionStorage.getItem("skate.pendingChallengeSpot"));
    expect(stashed).toBe(SPOT_ID);
  });
});
